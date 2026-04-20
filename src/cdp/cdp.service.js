import { ChromiumLauncher }
  from './chromium.launcher.js';

import { StealthInjector }
  from './stealth.injector.js';

import { ScreencastService }
  from './screencast.service.js';

/**
 * Coordinates Chromium launch, stealth patching, and screencast lifecycle
 * through a single CDP-focused service.
 */
export class CDPService {
  /**
   * Creates a CDP service instance with required collaborators.
   *
   * @param {object} config - Runtime configuration for Chromium and screencast services.
   * @param {object} log - Logger instance used for operational logging.
   */
  constructor(config, log) {
    this.config = config;
    this.log = log;

    this.launcher =
      new ChromiumLauncher(config, log);

    this.stealth =
      new StealthInjector(log);

    this.screencast =
      new ScreencastService(config, log);

    this.port = null;
  }

  /**
   * Launches Chromium, applies stealth injection, and stores the active CDP port.
   *
   * @param {string} [chromiumPath] - Optional executable path for Chromium.
   * @returns {Promise<number>} The active remote debugging port.
   */
  async initialize(chromiumPath) {
    this.port =
      await this.launcher.launch(chromiumPath);

    await this.stealth.inject(this.port);

    return this.port;
  }

  /**
   * Starts the screencast stream for the currently connected CDP target.
   *
   * @returns {Promise<void>}
   */
  async startScreencast() {
    await this.screencast.start(this.port);
  }

  /**
   * Stops any active screencast stream.
   *
   * @returns {Promise<void>}
   */
  async stopScreencast() {
    await this.screencast.stop();
  }

  /**
   * Gracefully stops screencasting and terminates the Chromium process.
   *
   * @returns {Promise<void>}
   */
  async shutdown() {
    await this.stopScreencast();
    await this.launcher.stop();
  }
}
