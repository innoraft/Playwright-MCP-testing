import WebSocket from 'ws';

/**
 * Handles CDP screencast setup, frame streaming, and teardown over WebSocket.
 */
export class ScreencastService {
  /**
   * Creates a screencast service with runtime configuration and logging.
   *
   * @param {object} config - Runtime configuration object.
   * @param {object} log - Logger instance for screencast events.
   */
  constructor(config, log) {
    this.config = config;
    this.log = log;

    this.socket = null;
    this.active = false;
  }

  /**
   * Starts a CDP screencast for the first available page target on the given port.
   *
   * @param {number} port - Active Chromium CDP port.
   * @returns {Promise<void>}
   */
  async start(port) {
    try {
      let wsUrl = null;

      for (let i = 0; i < 30; i++) {
        const resp =
          await fetch(`http://127.0.0.1:${port}/json`);

        const targets = await resp.json();

        const page =
          targets.find(t => t.type === 'page');

        if (page) {
          wsUrl = page.webSocketDebuggerUrl;
          break;
        }

        await new Promise(r => setTimeout(r, 500));
      }

      if (!wsUrl) {
        this.log.warn('No page target');
        return;
      }

      this.socket = new WebSocket(wsUrl);

      await new Promise((res, rej) => {
        this.socket.on('open', res);
        this.socket.on('error', rej);
      });

      let msgId = 1;

      this.socket.send(JSON.stringify({
        id: msgId++,
        method: 'Page.startScreencast',
        params: {
          format: 'jpeg',
          quality: 40,
          maxWidth: this.config.viewport.width,
          maxHeight: this.config.viewport.height,
          everyNthFrame: 2
        }
      }));

      this.active = true;

      this.socket.on('message', raw => {
        const msg = JSON.parse(raw.toString());

        if (msg.method === 'Page.screencastFrame') {
          this.socket.send(JSON.stringify({
            id: msgId++,
            method: 'Page.screencastFrameAck',
            params: {
              sessionId: msg.params.sessionId
            }
          }));

          process.stdout.write(
            `__SCREENCAST_FRAME__${msg.params.data}\n`
          );
        }
      });

      this.log.success('Screencast started');

    } catch (err) {
      this.log.warn(
        `Failed to start screencast: ${err.message}`
      );
    }
  }

  /**
   * Stops the active CDP screencast and closes the WebSocket connection.
   *
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.socket) return;

    try {
      this.socket.send(JSON.stringify({
        id: 9999,
        method: 'Page.stopScreencast'
      }));

      this.socket.close();

    } catch {}

    this.socket = null;
    this.active = false;
  }
}
