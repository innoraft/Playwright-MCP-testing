import { spawn } from "child_process";
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
  }

  /**
   * Launches Chromium with remote debugging enabled and waits for CDP readiness.
   *
   * @param {string} chromiumPath - Absolute path to the Chromium executable.
   * @returns {Promise<number>} The allocated CDP port.
   */
  async launch(chromiumPath) {
    const port = await findFreePort();
    this.cdpPort = port;

    const args = [
      `--remote-debugging-port=${port}`,
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
    });

    await this.waitForCDPReady(port);

    return port;
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
    if (!this.browserProcess) return;

    try {
      this.browserProcess.kill("SIGTERM");

      await new Promise((r) => setTimeout(r, 2000));

      if (!this.browserProcess.killed) {
        this.browserProcess.kill("SIGKILL");
      }
    } catch {}

    this.browserProcess = null;
  }
}
