/**
 * In-Memory Mock WebSocket Harness for Steampunk Tactical Shooter
 * High-speed in-memory communication channel simulating WebSocket interactions
 * without TCP network overhead or port binding conflicts.
 */
import { EventEmitter } from 'node:events';

export class MockSocketEndpoint extends EventEmitter {
  constructor(name = 'endpoint') {
    super();
    this.name = name;
    this.peer = null;
    this.readyState = 1; // 1 = OPEN
    this.messageHistory = [];
    this._onmessage = null;
    this._onclose = null;
    this._onopen = null;
    this._onerror = null;

    // Attach internal dispatch to support property listeners (e.g. ws.onmessage = ...)
    this.on('message', (raw) => {
      if (typeof this._onmessage === 'function') {
        this._onmessage({ data: raw });
      }
    });

    this.on('close', (event) => {
      if (typeof this._onclose === 'function') {
        this._onclose(event || { code: 1000, reason: 'Normal Closure' });
      }
    });

    this.on('error', (err) => {
      if (typeof this._onerror === 'function') {
        this._onerror(err);
      }
    });
  }

  get onmessage() { return this._onmessage; }
  set onmessage(fn) { this._onmessage = fn; }

  get onclose() { return this._onclose; }
  set onclose(fn) { this._onclose = fn; }

  get onopen() { return this._onopen; }
  set onopen(fn) { this._onopen = fn; }

  get onerror() { return this._onerror; }
  set onerror(fn) { this._onerror = fn; }

  /**
   * Sends data across the mock wire to the connected peer endpoint.
   * @param {string|Object} data
   */
  send(data) {
    if (this.readyState !== 1) {
      throw new Error(`Socket not open. readyState is ${this.readyState}`);
    }
    const serialized = typeof data === 'string' ? data : JSON.stringify(data);
    queueMicrotask(() => {
      if (this.peer && this.peer.readyState === 1) {
        this.peer.messageHistory.push(serialized);
        // Emit 'message' with serialized string (matching ws library behavior)
        this.peer.emit('message', serialized, false);
      }
    });
  }

  /**
   * Waits for a message with a specific type to arrive on this endpoint.
   * @param {string} expectedType
   * @param {number} [timeoutMs=1500]
   * @returns {Promise<Object>}
   */
  async waitFor(expectedType, timeoutMs = 1500) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener('message', listener);
        reject(new Error(`Timeout waiting for message type "${expectedType}" after ${timeoutMs}ms on ${this.name}`));
      }, timeoutMs);

      const listener = (raw) => {
        try {
          const str = typeof raw === 'string' ? raw : (raw?.toString?.() || String(raw));
          const msg = JSON.parse(str);
          if (msg.type === expectedType || msg.action === expectedType) {
            clearTimeout(timer);
            this.removeListener('message', listener);
            resolve(msg);
          }
        } catch (_) {
          // Ignore non-matching or unparseable messages
        }
      };

      this.on('message', listener);
    });
  }

  /**
   * Closes the socket and notifies the peer.
   */
  close(code = 1000, reason = 'Normal Closure') {
    if (this.readyState === 3) return; // Already closed
    this.readyState = 3; // CLOSED
    this.emit('close', { code, reason });
    if (this.peer && this.peer.readyState !== 3) {
      this.peer.readyState = 3;
      this.peer.emit('close', { code, reason });
    }
  }
}

export class MockWebSocketPair {
  constructor() {
    this.clientSide = new MockSocketEndpoint('client');
    this.serverSide = new MockSocketEndpoint('server');
    this.clientSide.peer = this.serverSide;
    this.serverSide.peer = this.clientSide;
  }
}

export class MockSwarm {
  constructor(serverInstance) {
    this.server = serverInstance;
    this.clients = [];
  }

  /**
   * Connects a new client into the server instance.
   * @param {string} clientId
   * @returns {MockSocketEndpoint} client-side socket
   */
  connectClient(clientId) {
    const pair = new MockWebSocketPair();
    if (this.server && typeof this.server.handleConnection === 'function') {
      this.server.handleConnection(pair.serverSide, { id: clientId, headers: {} });
    } else if (this.server && typeof this.server.onConnection === 'function') {
      this.server.onConnection(pair.serverSide, { id: clientId });
    }
    this.clients.push({ id: clientId, socket: pair.clientSide, serverSocket: pair.serverSide });
    return pair.clientSide;
  }

  /**
   * Sends a message from a connected client.
   * @param {string} clientId
   * @param {string} type
   * @param {Object} payload
   */
  broadcastFromClient(clientId, type, payload) {
    const client = this.clients.find(c => c.id === clientId);
    if (!client) throw new Error(`Client "${clientId}" not found in swarm`);
    client.socket.send({ type, payload });
  }

  /**
   * Waits for all connected clients to receive a specific message type.
   * @param {string} expectedType
   * @param {number} [timeoutMs=1500]
   * @returns {Promise<Object[]>}
   */
  async waitForAll(expectedType, timeoutMs = 1500) {
    return Promise.all(
      this.clients.map(c => c.socket.waitFor(expectedType, timeoutMs))
    );
  }

  /**
   * Disconnects all clients and clears the swarm.
   */
  disconnectAll() {
    for (const c of this.clients) {
      c.socket.close();
    }
    this.clients = [];
  }
}
