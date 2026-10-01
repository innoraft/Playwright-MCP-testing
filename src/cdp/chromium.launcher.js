import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { findFreePort } from "./port.util.js";

const OWNED_ROOT_PREFIX = 'playwright-mcp-chromium-run-';
const OWNER_PID_FILE = '.owner-pid';

/** Checks whether `pid` still refers to a live process (POSIX `kill -0` semantics). */
function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM'; // exists but owned by another user — treat as alive
  }
}

/**
 * Manages Chromium process lifecycle for CDP-based automation.
 */
export class ChromiumLauncher {
  /**
   * Creates a Chromium launcher with runtime configuration and logging.
   *
   * @param {object} config - Runtime configuration object.
   * @param {object} log - Logger instance for lifecycle events.
   */
  constructor(config, log) {
    this.config = config;
    this.log = log;

    this.browserProcess = null;
    this.cdpPort = null;
    this.userDataDir = null;
    this.ownedTempRoot = null;
    this.exitCleanupHandler = null;
  }

  /**
   * Launches Chromium with remote debugging enabled and waits for CDP readiness.
   *
   * @param {string} chromiumPath - Absolute path to the Chromium executable.
   * @returns {Promise<number>} The allocated CDP port.
   */
  async launch(chromiumPath) {
    await this.cleanupStaleOwnedTempRoots();
    this.exitCleanupHandler = () => this.cleanupOnProcessExit();
    process.once('exit', this.exitCleanupHandler);
    const port = await findFreePort();
    this.cdpPort = port;

    // Every launch gets its own private temp root (with an owner-pid marker) so
    // cleanup only ever removes dirs this instance created — never another
    // concurrently running test's Chromium temp files.
    this.ownedTempRoot = fs.mkdtempSync(path.join(os.tmpdir(), OWNED_ROOT_PREFIX));
    fs.writeFileSync(path.join(this.ownedTempRoot, OWNER_PID_FILE), String(process.pid));
    this.userDataDir = path.join(this.ownedTempRoot, 'profile');
    fs.mkdirSync(this.userDataDir, { recursive: true });

    const args = [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${this.userDataDir}`,
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      // Anti-bot-detection flags
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-infobars',
      `--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36`,
      `--window-size=${this.config.viewport.width},${this.config.viewport.height}`,
      'about:blank'
    ];

    this.log.info(`Launching Chromium with CDP on port ${port}`);

    this.browserProcess = spawn(chromiumPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== 'win32',
      // Relocates Chromium's --disable-dev-shm-usage shared-memory temp dirs
      // under our owned root instead of the shared global tmp dir.
      env: { ...process.env, TMPDIR: this.ownedTempRoot, TMP: this.ownedTempRoot, TEMP: this.ownedTempRoot },
    });

    try {
      await this.waitForCDPReady(port);
    } catch (error) {
      await this.stop();
      throw error;
    }

    return port;
  }

  /**
   * Removes owned temp roots left behind by a previous ungraceful kill. A root
   * is only ever removed once its recorded owner PID is no longer alive
   * (never based on age alone), so an active, still-running test is never touched.
   */
  async cleanupStaleOwnedTempRoots() {
    const envMaxAge = Number(process.env.PLAYWRIGHT_CHROMIUM_TMP_MAX_AGE_MS);
    const maxAgeMs = Number.isFinite(envMaxAge) && envMaxAge >= 0 ? envMaxAge : 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;

    let rootPaths = [];
    try {
      rootPaths = await this.listOwnedTempRoots();
    } catch (error) {
      this.log.warn(`Failed to list Chromium temp roots: ${error.message}`);
    }

    // Handle each root independently so one failure doesn't abort the rest.
    for (const rootPath of rootPaths) {
      try {
        const ownerPid = Number(
          await fs.promises.readFile(path.join(rootPath, OWNER_PID_FILE), 'utf8').catch(() => '')
        );
        if (isPidAlive(ownerPid)) continue; // still owned by a running test

        const stats = await fs.promises.stat(rootPath);
        if (stats.mtimeMs >= cutoff) continue;

        await fs.promises.rm(rootPath, { recursive: true, force: true, maxRetries: 2, retryDelay: 200 });
        removed++;
      } catch (error) {
        this.log.warn(`Failed to clean stale Chromium temp root ${rootPath}: ${error.message}`);
      }
    }

    if (removed > 0) {
      this.log.info(`Removed ${removed} stale Chromium temp root(s)`);
    }
  }

  async listOwnedTempRoots() {
    const entries = await fs.promises.readdir(os.tmpdir(), { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory() && entry.name.startsWith(OWNED_ROOT_PREFIX))
      .map(entry => path.join(os.tmpdir(), entry.name));
  }

  /**
   * Polls Chromium's CDP endpoint until it becomes available or times out.
   *
   * @param {number} port - CDP port to probe.
   * @returns {Promise<void>}
   * @throws {Error} When the CDP endpoint does not become ready in time.
   */
  async waitForCDPReady(port) {
    const timeout = 15000;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/json/version`);

        if (resp.ok) {
          this.log.success("Chromium CDP ready");
          return;
        }
      } catch {}

      await new Promise((r) => setTimeout(r, 300));
    }

    throw new Error("CDP not ready");
  }

  /**
   * Stops the running Chromium process gracefully, then force kills if needed.
   *
   * @returns {Promise<void>}
   */
  async stop() {
    const browserProcess = this.browserProcess;
    const ownedTempRoot = this.ownedTempRoot;
    this.browserProcess = null;
    this.userDataDir = null;
    this.ownedTempRoot = null;

    try {
      if (browserProcess && browserProcess.exitCode === null && !browserProcess.killed) {
        const signalProcessGroup = (signal) => {
          try {
            if (process.platform === 'win32') {
              browserProcess.kill(signal);
            } else {
              process.kill(-browserProcess.pid, signal);
            }
          } catch (error) {
            if (error.code !== 'ESRCH') throw error;
          }
        };

        signalProcessGroup("SIGTERM");
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 2000);
          browserProcess.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        });

        if (browserProcess.exitCode === null) {
          signalProcessGroup("SIGKILL");
          await new Promise((resolve) => browserProcess.once('exit', resolve));
        }
      }
    } catch (error) {
      this.log.warn(`Failed to stop Chromium cleanly: ${error.message}`);
    }

    if (ownedTempRoot) {
      try {
        await fs.promises.rm(ownedTempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      } catch (error) {
        this.log.warn(`Failed to remove Chromium temp root ${ownedTempRoot}: ${error.message}`);
      }
    }

    if (this.exitCleanupHandler) {
      process.removeListener('exit', this.exitCleanupHandler);
      this.exitCleanupHandler = null;
    }
  }

  cleanupOnProcessExit() {
    const browserProcess = this.browserProcess;
    const ownedTempRoot = this.ownedTempRoot;

    if (browserProcess && browserProcess.exitCode === null && !browserProcess.killed) {
      try {
        if (process.platform === 'win32') {
          browserProcess.kill('SIGKILL');
        } else {
          process.kill(-browserProcess.pid, 'SIGKILL');
        }
      } catch {}
    }

    if (ownedTempRoot) {
      try {
        fs.rmSync(ownedTempRoot, { recursive: true, force: true });
      } catch {}
    }
  }
}
