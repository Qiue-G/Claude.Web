/**
 * Yjs 文档管理器 — 用于多人实时协作同一会话。
 *
 * 职责：
 * - 按 sessionId 缓存 Y.Doc 实例
 * - 客户端注册/注销（含心跳检测，30 秒无活动自动清理）
 * - 定期持久化 Y.Doc 状态（每 30 秒）
 * - 广播 Yjs 增量更新
 *
 * @class YDocManager
 */
import * as Y from 'yjs';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../lib/logger.js';

export class YDocManager {
  /**
   * @param {object} [options]
   * @param {string} [options.docsDir='./ydocs']      — Y.Doc 快照持久化目录
   * @param {number} [options.heartbeatInterval=30000] — 心跳检查间隔 (ms)
   * @param {number} [options.persistInterval=30000]   — 自动持久化间隔 (ms)
   * @param {number} [options.inactiveTimeout=30000]   — 客户端无活动超时 (ms)
   */
  constructor(options = {}) {
    this.docsDir = options.docsDir || './ydocs';
    this.heartbeatInterval = options.heartbeatInterval ?? 30000;
    this.persistInterval = options.persistInterval ?? 30000;
    this.inactiveTimeout = options.inactiveTimeout ?? 30000;

    /** @type {Map<string, Y.Doc>} */
    this._docs = new Map();

    /** @type {Map<string, Set<string>>} */
    this._clients = new Map();

    /** @type {Map<string, number>} */
    this._clientActivity = new Map();

    /** @type {Map<string, Map<string, {username?: string, color?: string}>>} */
    this._clientInfo = new Map();

    /**
     * 每个 session 注册一个广播回调，由 wsHandler 在初始化时注入。
     * @type {Map<string, (update: Uint8Array) => void>}
     */
    this._broadcasters = new Map();

    // 定时持久化（使用 unref 避免阻止进程退出）
    if (this.persistInterval > 0) {
      this._persistTimer = setInterval(() => this._persistAll(), this.persistInterval);
      this._persistTimer.unref();
    }

    // 定时心跳检测（使用 unref 避免阻止进程退出）
    if (this.heartbeatInterval > 0) {
      this._heartbeatTimer = setInterval(() => this._checkHeartbeat(), this.heartbeatInterval);
      this._heartbeatTimer.unref();
    }

    logger.info('YDocManager initialized', {
      docsDir: this.docsDir,
      persistInterval: this.persistInterval,
      inactiveTimeout: this.inactiveTimeout
    });
  }

  // ===== 文档管理 =====

  /**
   * 获取或创建 Y.Doc，按 sessionId 缓存。
   * @param {string} sessionId
   * @returns {Y.Doc}
   */
  getOrCreateDoc(sessionId) {
    let doc = this._docs.get(sessionId);
    if (!doc) {
      doc = new Y.Doc();
      this._docs.set(sessionId, doc);
      logger.debug('YDoc created', { sessionId });
    }
    return doc;
  }

  /**
   * 广播 Yjs 增量更新到该 session 的所有客户端。
   * 先将 update apply 到本地 Y.Doc，再通过已注册的广播器分发。
   * @param {string} sessionId
   * @param {Uint8Array} update
   */
  broadcastUpdate(sessionId, update) {
    const doc = this.getOrCreateDoc(sessionId);
    Y.applyUpdate(doc, update);

    const broadcaster = this._broadcasters.get(sessionId);
    if (broadcaster) {
      broadcaster(update);
    }
  }

  /**
   * 为一个 session 注册广播回调。通常在第一个客户端加入时由 wsHandler 调用。
   * @param {string} sessionId
   * @param {(update: Uint8Array) => void} fn
   */
  registerBroadcaster(sessionId, fn) {
    this._broadcasters.set(sessionId, fn);
  }

  // ===== 客户端管理 =====

  /**
   * 注册一个客户端到 session。
   * @param {string} sessionId
   * @param {string} clientId
   * @param {{username?: string, color?: string}} [info]
   */
  addClient(sessionId, clientId, info = {}) {
    if (!this._clients.has(sessionId)) {
      this._clients.set(sessionId, new Set());
      this._clientInfo.set(sessionId, new Map());
    }
    this._clients.get(sessionId).add(clientId);
    this._clientActivity.set(clientId, Date.now());
    if (info.username || info.color) {
      this._clientInfo.get(sessionId).set(clientId, {
        username: info.username || '',
        color: info.color || ''
      });
    }
    // 确保 doc 存在
    this.getOrCreateDoc(sessionId);
    logger.debug('Client added', { sessionId, clientId });
  }

  /**
   * 从 session 移除一个客户端。如果该 session 没有更多客户端，自动清理资源。
   * @param {string} sessionId
   * @param {string} clientId
   */
  removeClient(sessionId, clientId) {
    const clients = this._clients.get(sessionId);
    if (clients) {
      clients.delete(clientId);
    }

    const infoMap = this._clientInfo.get(sessionId);
    if (infoMap) {
      infoMap.delete(clientId);
    }

    this._clientActivity.delete(clientId);
    logger.debug('Client removed', { sessionId, clientId });

    // 如果该 session 没有更多客户端，清理文档资源
    if (!clients || clients.size === 0) {
      this.cleanup(sessionId);
    }
  }

  /**
   * 获取某个 session 的所有活跃客户端列表。
   * @param {string} sessionId
   * @returns {Array<{clientId: string, username?: string, color?: string, lastActivity: number}>}
   */
  getActiveClients(sessionId) {
    const clients = this._clients.get(sessionId);
    if (!clients) return [];

    const infoMap = this._clientInfo.get(sessionId) || new Map();
    return Array.from(clients).map(clientId => ({
      clientId,
      username: infoMap.get(clientId)?.username || '',
      color: infoMap.get(clientId)?.color || '',
      lastActivity: this._clientActivity.get(clientId) || 0
    }));
  }

  /**
   * 更新客户端的活动时间戳（心跳）。
   * @param {string} clientId
   */
  updateActivity(clientId) {
    this._clientActivity.set(clientId, Date.now());
  }

  // ===== 持久化 =====

  /**
   * 持久化某个 session 的 Y.Doc 状态到磁盘。
   * @param {string} sessionId
   */
  async persistDoc(sessionId) {
    const doc = this._docs.get(sessionId);
    if (!doc) return;

    try {
      if (!existsSync(this.docsDir)) {
        await mkdir(this.docsDir, { recursive: true });
      }
      const state = Y.encodeStateAsUpdate(doc);
      const filePath = join(this.docsDir, `${sessionId}.ydoc`);
      await writeFile(filePath, Buffer.from(state));
      logger.debug('YDoc persisted', { sessionId, bytes: state.length });
    } catch (e) {
      logger.error('YDoc persist failed', { sessionId, error: e.message });
    }
  }

  /**
   * 从磁盘加载 Y.Doc 状态（用于服务重启后恢复）。
   * @param {string} sessionId
   * @returns {Promise<Y.Doc>}
   */
  async loadDoc(sessionId) {
    const filePath = join(this.docsDir, `${sessionId}.ydoc`);
    try {
      if (existsSync(filePath)) {
        const data = await readFile(filePath);
        const doc = new Y.Doc();
        Y.applyUpdate(doc, new Uint8Array(data));
        this._docs.set(sessionId, doc);
        logger.debug('YDoc loaded from disk', { sessionId, bytes: data.length });
        return doc;
      }
    } catch (e) {
      logger.error('YDoc load failed', { sessionId, error: e.message });
    }
    return this.getOrCreateDoc(sessionId);
  }

  // ===== 资源清理 =====

  /**
   * 清理某个 session 的所有文档资源（包括内存中的 Y.Doc）。
   * @param {string} sessionId
   */
  cleanup(sessionId) {
    const doc = this._docs.get(sessionId);
    if (doc) {
      doc.destroy();
      this._docs.delete(sessionId);
    }
    this._clients.delete(sessionId);
    this._clientInfo.delete(sessionId);
    this._broadcasters.delete(sessionId);
    logger.info('YDoc cleaned up', { sessionId });
  }

  // ===== 版本戳追踪 (T5) =====

  /**
   * 获取某个 session 的 Y.Doc 当前版本号。
   * 每次 applyUpdate 时自动递增版本戳。
   * @param {string} sessionId
   * @returns {number}
   */
  getDocVersion(sessionId) {
    const doc = this._docs.get(sessionId);
    if (!doc) return 0;
    // Yjs 的 clock 机制：通过 state vector 获取当前文档的操作数
    const sv = Y.encodeStateVector(doc);
    // 用 sv 长度作为粗略的变更计数
    return sv.length;
  }

  /**
   * 获取某个 session 的 Y.Doc 状态向量（用于冲突检测）。
   * @param {string} sessionId
   * @returns {Uint8Array}
   */
  getStateVector(sessionId) {
    const doc = this._docs.get(sessionId);
    if (!doc) return new Uint8Array(0);
    return Y.encodeStateVector(doc);
  }

  /**
   * 对比两个 session 的文档状态是否一致。
   * @param {string} sessionIdA
   * @param {string} sessionIdB
   * @returns {boolean}
   */
  isDocInSync(sessionIdA, sessionIdB) {
    const docA = this._docs.get(sessionIdA);
    const docB = this._docs.get(sessionIdB);
    if (!docA || !docB) return false;
    const svA = Y.encodeStateVector(docA);
    const svB = Y.encodeStateVector(docB);
    // 比较 state vector 是否相同
    if (svA.length !== svB.length) return false;
    for (let i = 0; i < svA.length; i++) {
      if (svA[i] !== svB[i]) return false;
    }
    return true;
  }

  /**
   * 销毁整个管理器（清理定时器 + 所有文档）。
   */
  destroy() {
    if (this._persistTimer) {
      clearInterval(this._persistTimer);
      this._persistTimer = null;
    }
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }

    // 收集所有 sessionId 再迭代，避免在迭代中修改 Map
    const allSessions = Array.from(this._docs.keys());
    for (const sessionId of allSessions) {
      this.persistDoc(sessionId);
      this.cleanup(sessionId);
    }

    // 清理客户端级状态（不在 session 级 cleanup 范围内）
    this._clientActivity.clear();
    logger.info('YDocManager destroyed');
  }

  // ===== 内部方法 =====

  /** 持久化所有活跃的文档。 */
  _persistAll() {
    for (const sessionId of this._docs.keys()) {
      this.persistDoc(sessionId);
    }
  }

  /** 心跳检测：移除超时客户端。 */
  _checkHeartbeat() {
    const now = Date.now();
    const staleClients = [];

    for (const [clientId, lastActivity] of this._clientActivity) {
      if (now - lastActivity > this.inactiveTimeout) {
        staleClients.push(clientId);
      }
    }

    for (const clientId of staleClients) {
      // 查找此客户端所属的 session
      for (const [sessionId, clients] of this._clients) {
        if (clients.has(clientId)) {
          logger.info('Client heartbeat timeout, removing', { clientId, sessionId });
          this.removeClient(sessionId, clientId);
          break;
        }
      }
    }
  }
}
