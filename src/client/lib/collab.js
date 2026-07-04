/**
 * 前端协作客户端 — 手动集成 Yjs sync protocol 到现有的 WebSocket 通道。
 *
 * 设计原则：
 * - 不依赖 y-websocket 的自动连接，而是通过现有 ws 通道发送 yjs_sync / yjs_update 消息
 * - 接收已有的 ws 连接实例（不是自己创建新连接）
 * - 在 ws 上监听协作消息类型，将 Yjs 的 update 事件通过 ws 发送
 * - 用 cursor_update / presence 实现 Awareness（光标位置、在线状态）
 *
 * @class CollabClient
 */
import * as Y from 'yjs';

// ── 浏览器环境下的 Uint8Array ↔ base64 工具函数 ──

/**
 * Uint8Array → base64 字符串
 * @param {Uint8Array} uint8array
 * @returns {string}
 */
function uint8ArrayToBase64(uint8array) {
  let binary = '';
  for (let i = 0; i < uint8array.length; i++) {
    binary += String.fromCharCode(uint8array[i]);
  }
  try {
    return btoa(binary);
  } catch (e) {
    // btoa 在极端情况下可能失败，降级返回空
    console.error('[Collab] base64 encode failed:', e.message);
    return '';
  }
}

/**
 * base64 字符串 → Uint8Array
 * @param {string} base64
 * @returns {Uint8Array}
 */
function base64ToUint8Array(base64) {
  try {
    const binary = atob(base64);
    const uint8array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      uint8array[i] = binary.charCodeAt(i);
    }
    return uint8array;
  } catch (e) {
    console.error('[Collab] base64 decode failed:', e.message);
    return new Uint8Array(0);
  }
}

/**
 * 生成唯一客户端 ID。
 * @returns {string}
 */
function generateClientId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

/**
 * 从预设中选取一个光标颜色。
 * @returns {string}
 */
function getRandomColor() {
  const colors = [
    '#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff',
    '#9b59b6', '#e67e22', '#1abc9c', '#e74c3c',
    '#3498db', '#2ecc71', '#f39c12', '#8e44ad'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

export class CollabClient {
  /**
   * @param {WebSocket} ws       — 已连接的自定义 WebSocket 实例
   * @param {string} sessionId   — 当前会话 ID
   * @param {string} [token]     — 会话令牌（可选）
   * @param {string} [username]  — 显示名称
   */
  constructor(ws, sessionId, token, username) {
    if (!ws) throw new Error('[Collab] WebSocket instance is required');
    if (!sessionId) throw new Error('[Collab] sessionId is required');

    /** @type {WebSocket} */
    this.ws = ws;
    this.sessionId = sessionId;
    this.token = token || '';
    this.username = username || 'anonymous';

    /** @type {string} */
    this.clientId = generateClientId();
    this.color = getRandomColor();

    /** @type {Y.Doc|null} */
    this.doc = null;

    /** @type {boolean} */
    this._connected = false;

    /** @type {Function|null} */
    this._wsMessageHandler = null;

    /** @type {Function|null} */
    this._onAwarenessChange = null;

    /** @type {Function|null} */
    this._onConnectionChange = null;

    /** @type {object} */
    this._awarenessState = {};

    /** @type {boolean} */
    this._destroyed = false;
  }

  // ===== 公共 API =====

  /**
   * 连接到协作会话。
   * 创建本地 Y.Doc、在 ws 上注册监听、发起同步请求。
   */
  connect() {
    if (this._destroyed) return;
    if (this.doc) this.disconnect();

    this.doc = new Y.Doc();

    // 监听 ws 上协作相关的消息类型
    this._wsMessageHandler = (event) => {
      if (this._destroyed) return;
      try {
        const msg = JSON.parse(event.data);
        this._handleCollabMessage(msg);
      } catch (_) {
        // 非 JSON 消息（如原始终端输出），忽略
      }
    };
    this.ws.addEventListener('message', this._wsMessageHandler);

    // 监听 Yjs 本地修改事件
    this.doc.on('update', (update, origin) => {
      if (this._destroyed) return;
      // origin === 'remote' 表示这是从远端收到的更新，不需要回传
      if (origin === 'remote') return;
      this._sendUpdate(update);
    });

    // 发起同步请求
    this._sendSyncRequest();
  }

  /**
   * 断开协作会话。
   * 销毁 Y.Doc、移除 ws 监听。
   */
  disconnect() {
    this._connected = false;

    if (this._wsMessageHandler && this.ws) {
      this.ws.removeEventListener('message', this._wsMessageHandler);
      this._wsMessageHandler = null;
    }

    if (this.doc) {
      this.doc.destroy();
      this.doc = null;
    }

    this._onConnectionChange?.(false);
  }

  /**
   * 销毁实例，释放所有资源。
   */
  destroy() {
    this._destroyed = true;
    this._onAwarenessChange = null;
    this._onConnectionChange = null;
    this.disconnect();
  }

  /**
   * 设置 Awareness 字段（光标位置、选中范围等）。
   * @param {string} field
   * @param {*} value
   */
  setAwarenessField(field, value) {
    this._awarenessState[field] = value;
  }

  /**
   * 获取指定名称的共享 Y.Text 类型。
   * @param {string} name
   * @returns {Y.Text|null}
   */
  getSharedText(name) {
    if (!this.doc) return null;
    return this.doc.getText(name);
  }

  /**
   * 注册 Awareness（在线用户列表）变化回调。
   * @param {function} callback
   */
  onAwarenessChange(callback) {
    this._onAwarenessChange = callback;
  }

  /**
   * 注册连接状态变化回调。
   * @param {function(boolean): void} callback
   */
  onConnectionChange(callback) {
    this._onConnectionChange = callback;
  }

  /**
   * 发送光标位置更新。
   * @param {{line: number, ch: number}|null} position
   * @param {{start: object, end: object}|null} [selection]
   */
  sendCursorPosition(position, selection) {
    if (!this._connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(JSON.stringify({
      type: 'cursor_update',
      sessionId: this.sessionId,
      clientId: this.clientId,
      username: this.username,
      color: this.color,
      position,
      selection
    }));
  }

  // ===== 内部方法 =====

  /** 发起 Yjs 完整同步请求。 */
  _sendSyncRequest() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(JSON.stringify({
      type: 'yjs_sync',
      sessionId: this.sessionId,
      clientId: this.clientId,
      username: this.username,
      color: this.color,
      token: this.token
    }));
  }

  /** 发送 Yjs 增量更新。 */
  _sendUpdate(update) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const encoded = uint8ArrayToBase64(update);
    if (!encoded) return;

    this.ws.send(JSON.stringify({
      type: 'yjs_update',
      sessionId: this.sessionId,
      clientId: this.clientId,
      update: encoded,
      token: this.token
    }));
  }

  /**
   * 处理从 ws 收到的协作消息。
   * @param {object} msg
   */
  _handleCollabMessage(msg) {
    switch (msg.type) {
      case 'yjs_sync':
        // 服务端返回完整 Y.Doc 状态
        if (msg.state && this.doc) {
          const state = base64ToUint8Array(msg.state);
          if (state.length > 0) {
            Y.applyUpdate(this.doc, state, 'remote');
          }
          this._connected = true;
          this._onConnectionChange?.(true);
        }
        break;

      case 'yjs_update':
        // 来自其他客户端的增量更新
        if (msg.update && msg.senderId !== this.clientId && this.doc) {
          const update = base64ToUint8Array(msg.update);
          if (update.length > 0) {
            Y.applyUpdate(this.doc, update, 'remote');
          }
        }
        break;

      case 'cursor_update':
        // 其他客户端的光标位置
        if (msg.clientId !== this.clientId) {
          window.dispatchEvent(new CustomEvent('collab-cursor', {
            detail: {
              clientId: msg.clientId,
              username: msg.username,
              color: msg.color,
              position: msg.position,
              selection: msg.selection
            }
          }));
        }
        break;

      case 'presence':
        // 在线用户列表更新
        if (this._onAwarenessChange && Array.isArray(msg.clients)) {
          this._onAwarenessChange(msg.clients);
        }
        break;
    }
  }
}
