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
    this.port = null;
    this.targetId = null;
    this.targetMonitor = null;
    this.knownTargetIds = new Set();
  }

  /**
   * Starts a CDP screencast for the first available page target on the given port.
   *
   * @param {number} port - Active Chromium CDP port.
   * @returns {Promise<void>}
   */
  async start(port) {
    try {
      this.port = port;
      let page = null;
      for (let i = 0; i < 30; i++) {
        const resp =
          await fetch(`http://127.0.0.1:${port}/json`);

        const targets = await resp.json();

        page = targets.find(t => t.type === 'page');

        if (page) {
          break;
        }

        await new Promise(r => setTimeout(r, 500));
      }

      if (!page) {
        this.log.warn('No page target');
        return;
      }

      const targets = await this.getPageTargets();
      this.knownTargetIds = new Set(targets.map(target => target.id));
      await this.attachToPage(page);
      this.targetMonitor = setInterval(() => {
        this.syncPageTarget().catch(err => {
          this.log.warn(`Failed to switch screencast target: ${err.message}`);
        });
      }, 500);

      this.log.success('Screencast started');
    } catch (err) {
      this.log.warn(
        `Failed to start screencast: ${err.message}`
      );
    }
  }

  async getPageTargets() {
    const response = await fetch(`http://127.0.0.1:${this.port}/json`);
    const targets = await response.json();
    return targets.filter(target => target.type === 'page' && target.webSocketDebuggerUrl);
  }

  async syncPageTarget() {
    const targets = await this.getPageTargets();
    const targetIds = new Set(targets.map(target => target.id));
    const currentTarget = targets.find(target => target.id === this.targetId);
    const newTarget = targets.find(target => !this.knownTargetIds.has(target.id));
    const nextTarget = newTarget || (currentTarget ? null : targets.at(-1));

    if (nextTarget && nextTarget.id !== this.targetId) {
      await this.attachToPage(nextTarget);
    }

    this.knownTargetIds = targetIds;
  }

  async attachToPage(page) {
    const wsUrl = page.webSocketDebuggerUrl;
    if (!wsUrl) return;

    await this.closeSocket();
    const socket = new WebSocket(wsUrl);

      await new Promise((res, rej) => {
      socket.on('open', res);
      socket.on('error', rej);
      });

      let msgId = 1;

    socket.send(JSON.stringify({
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

    this.socket = socket;
    this.targetId = page.id;
      this.active = true;

    socket.on('message', raw => {
      const msg = JSON.parse(raw.toString());

      if (msg.method === 'Page.screencastFrame') {
        socket.send(JSON.stringify({
          id: msgId++,
          method: 'Page.screencastFrameAck',
          params: {
            sessionId: msg.params.sessionId
          }
        }));

        if (socket === this.socket) {
          process.stdout.write(
            `__SCREENCAST_FRAME__${msg.params.data}\n`
          );
        }
      }
    });
  }

  async closeSocket() {
    if (!this.socket) return;

    const socket = this.socket;
    this.socket = null;
    this.active = false;
    try {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          id: 9999,
          method: 'Page.stopScreencast'
        }));
      }
      socket.close();
    } catch {}
  }

  /**
   * Stops the active CDP screencast and closes the WebSocket connection.
   *
   * @returns {Promise<void>}
   */
  async stop() {
    if (this.targetMonitor) {
      clearInterval(this.targetMonitor);
      this.targetMonitor = null;
    }
    await this.closeSocket();
    this.targetId = null;
    this.port = null;
    this.knownTargetIds.clear();
    this.active = false;
  }
}
