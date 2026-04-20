import WebSocket from 'ws';

/**
 * Injects stealth-oriented scripts into Chromium page targets via CDP.
 */
export class StealthInjector {
  /**
   * Creates a stealth injector with logging support.
   *
   * @param {object} log - Logger instance used for status and error messages.
   */
  constructor(log) {
    this.log = log;
  }

  /**
   * Adds stealth script hooks to the first available page target.
   *
   * @param {number} port - Active Chromium CDP port.
   * @returns {Promise<void>}
   */
  async inject(port) {
    try {
      const targetsResp =
        await fetch(`http://127.0.0.1:${port}/json`);

      const targets = await targetsResp.json();

      const pageTarget =
        targets.find(t => t.type === 'page');

      if (!pageTarget) return;

      const ws =
        new WebSocket(pageTarget.webSocketDebuggerUrl);

      await new Promise((res, rej) => {
        ws.onopen = res;
        ws.onerror = rej;
      });

      ws.send(JSON.stringify({
        id: 1,
        method: 'Page.addScriptToEvaluateOnNewDocument',
        params: {
          source: `
Object.defineProperty(
  navigator,
  'webdriver',
  { get: () => undefined }
);
`
        }
      }));

      await new Promise(r => setTimeout(r, 200));

      ws.close();

      this.log.success('Stealth scripts injected');

    } catch (err) {
      this.log.warn(
        `Stealth injection failed: ${err.message}`
      );
    }
  }
}
