import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { findFreePort } from "./port.util.js";

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
    this.chromiumTempDirsBeforeRun = new Set();
    this.exitCleanupHandler = null;
  }

  /**
   * Launches Chromium with remote debugging enabled and waits for CDP readiness.
   *
   * @param {string} chromiumPath - Absolute path to the Chromium executable.
   * @returns {Promise<number>} The allocated CDP port.
   */
  async launch(chromiumPath) {
    await this.cleanupStaleChromiumTempDirs();
    this.chromiumTempDirsBeforeRun = new Set(await this.listChromiumTempDirs());
    this.exitCleanupHandler = () => this.cleanupOnProcessExit();
    process.once('exit', this.exitCleanupHandler);
    const port = await findFreePort();
    this.cdpPort = port;
    this.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'playwright-mcp-chromium-'));

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
    });

    try {
      await this.waitForCDPReady(port);
    } catch (error) {
      await this.stop();
      throw error;
    }

    return port;
  }

  async cleanupStaleChromiumTempDirs() {
    const envMaxAge = Number(process.env.PLAYWRIGHT_CHROMIUM_TMP_MAX_AGE_MS);
    const maxAgeMs = Number.isFinite(envMaxAge) && envMaxAge >= 0 ? envMaxAge : 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;

    let profilePaths = [];
    try {
      profilePaths = await this.listChromiumTempDirs();
    } catch (error) {
      this.log.warn(`Failed to list Chromium temp profiles: ${error.message}`);
    }

    // Handle each dir independently so one failure (e.g. ENOENT from a dir
    // that vanished mid-scan) doesn't abort the sweep of the remaining dirs.
    for (const profilePath of profilePaths) {
      try {
        const stats = await fs.promises.stat(profilePath);
        if (stats.mtimeMs >= cutoff) continue;

        await fs.promises.rm(profilePath, { recursive: true, force: true, maxRetries: 2, retryDelay: 200 });
        removed++;
      } catch (error) {
        this.log.warn(`Failed to clean stale Chromium temp profile ${profilePath}: ${error.message}`);
      }
    }

    if (removed > 0) {
      this.log.info(`Removed ${removed} stale Chromium temp profile(s)`);
    }
  }

  async listChromiumTempDirs() {
    const prefixes = ['org.chromium.Chromium.', '.org.chromium.Chromium.'];
    const entries = await fs.promises.readdir(os.tmpdir(), { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory() && prefixes.some(prefix => entry.name.startsWith(prefix)))
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
    const userDataDir = this.userDataDir;
    this.browserProcess = null;
    this.userDataDir = null;

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

    if (userDataDir) {
      try {
        await fs.promises.rm(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      } catch (error) {
        this.log.warn(`Failed to remove Chromium profile ${userDataDir}: ${error.message}`);
      }
    }

    try {
      const currentTempDirs = await this.listChromiumTempDirs();
      const newTempDirs = currentTempDirs.filter(tempDir => !this.chromiumTempDirsBeforeRun.has(tempDir));
      await Promise.all(newTempDirs.map(tempDir =>
        fs.promises.rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
      ));
      if (newTempDirs.length > 0) {
        this.log.info(`Removed ${newTempDirs.length} Chromium temp profile(s) created during the run`);
      }
    } catch (error) {
      this.log.warn(`Failed to remove Chromium temp profiles created during the run: ${error.message}`);
    }

    if (this.exitCleanupHandler) {
      process.removeListener('exit', this.exitCleanupHandler);
      this.exitCleanupHandler = null;
    }
  }

  cleanupOnProcessExit() {
    const browserProcess = this.browserProcess;
    const userDataDir = this.userDataDir;

    if (browserProcess && browserProcess.exitCode === null && !browserProcess.killed) {
      try {
        if (process.platform === 'win32') {
          browserProcess.kill('SIGKILL');
        } else {
          process.kill(-browserProcess.pid, 'SIGKILL');
        }
      } catch {}
    }

    if (userDataDir) {
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      } catch {}
    }

    try {
      const entries = fs.readdirSync(os.tmpdir(), { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!entry.name.startsWith('org.chromium.Chromium.')) continue;

        const tempDir = path.join(os.tmpdir(), entry.name);
        if (this.chromiumTempDirsBeforeRun.has(tempDir)) continue;
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {}
      }
    } catch {}
  }
}
