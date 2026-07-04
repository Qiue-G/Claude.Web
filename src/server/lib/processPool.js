/**
 * ProcessPool — 可复用的子进程池
 *
 * 管理 CLI 子进程的创建、复用和回收。
 * 进程保存最近 N 分钟的状态上下文，超时后自动回收。
 */
import { spawn } from 'child_process';

class ProcessPool {
  /**
   * @param {object} options
   * @param {number} options.maxSize       池中最大进程数 (默认 8)
   * @param {number} options.idleTimeout   空闲进程超时回收时间 ms (默认 300000 = 5min)
   * @param {number} options.maxPerSession 每个会话最多进程数 (默认 2)
   */
  constructor(options = {}) {
    this.maxSize = options.maxSize || 8;
    this.idleTimeout = options.idleTimeout || 300000;
    this.maxPerSession = options.maxPerSession || 2;

    /** @type {Map<string, { proc, sessionId, lastUsed, createdAt, busy: boolean }>} */
    this.pool = new Map();   // processId → processInfo
    this.active = new Map(); // sessionId → [processId]
    this._id = 0;
    this._cleanupTimer = setInterval(() => this._cleanup(), 60000);
  }

  /**
   * 获取或创建进程
   * @param {string} sessionId
   * @param {Function} spawnFn  () => ChildProcess
   * @returns {Promise<{ id: string, proc: ChildProcess }>}
   */
  async acquire(sessionId, spawnFn) {
    // 1. 尝试复用该 session 的空闲进程
    const sessionProcessIds = this.active.get(sessionId) || [];
    for (const pid of sessionProcessIds) {
      const entry = this.pool.get(pid);
      if (entry && !entry.busy) {
        entry.busy = true;
        entry.lastUsed = Date.now();
        return { id: pid, proc: entry.proc };
      }
    }

    // 2. 检查会话级限制
    const busyCount = sessionProcessIds.filter(pid => {
      const e = this.pool.get(pid);
      return e && e.busy;
    }).length;
    if (busyCount >= this.maxPerSession) {
      throw new Error(`Session ${sessionId} has reached max processes (${this.maxPerSession})`);
    }

    // 3. 检查全局限制
    if (this.pool.size >= this.maxSize) {
      // 淘汰最久未使用的空闲进程
      this._evictIdle();
    }

    // 4. 创建新进程
    const proc = spawnFn();
    const id = `proc_${++this._id}`;

    const entry = {
      id,
      proc,
      sessionId,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      busy: true
    };

    // 进程退出时自动清理
    proc.on('exit', () => {
      this.pool.delete(id);
      this._removeFromActive(sessionId, id);
    });

    this.pool.set(id, entry);
    if (!this.active.has(sessionId)) this.active.set(sessionId, []);
    this.active.get(sessionId).push(id);

    return { id, proc };
  }

  /**
   * 归还进程到池中
   */
  release(sessionId, processId) {
    const entry = this.pool.get(processId);
    if (entry) {
      entry.busy = false;
      entry.lastUsed = Date.now();
    }
  }

  /**
   * 释放会话的所有进程
   */
  releaseAll(sessionId) {
    const processIds = this.active.get(sessionId) || [];
    for (const pid of processIds) {
      const entry = this.pool.get(pid);
      if (entry) {
        try { entry.proc.kill(); } catch (_) {}
        this.pool.delete(pid);
      }
    }
    this.active.delete(sessionId);
  }

  /**
   * 获取统计信息
   */
  stats() {
    let busy = 0;
    let idle = 0;
    for (const entry of this.pool.values()) {
      if (entry.busy) busy++; else idle++;
    }
    return {
      total: this.pool.size,
      busy,
      idle,
      activeSessions: this.active.size,
      maxSize: this.maxSize
    };
  }

  /**
   * 销毁进程池（清理所有进程）
   */
  async destroy() {
    clearInterval(this._cleanupTimer);
    for (const [id, entry] of this.pool) {
      try { entry.proc.kill(); } catch (e) { /* ignore */ }
      this.pool.delete(id);
    }
    this.active.clear();
  }

  /** 回收空闲超时的进程 */
  _cleanup() {
    const now = Date.now();
    for (const [id, entry] of this.pool) {
      if (!entry.busy && (now - entry.lastUsed) > this.idleTimeout) {
        try { entry.proc.kill(); } catch (e) { /* ignore */ }
        this.pool.delete(id);
        this._removeFromActive(entry.sessionId, id);
      }
    }
  }

  /** 淘汰最久未使用的空闲进程 */
  _evictIdle() {
    let oldest = null;
    let oldestId = null;
    for (const [id, entry] of this.pool) {
      if (!entry.busy && (!oldest || entry.lastUsed < oldest)) {
        oldest = entry.lastUsed;
        oldestId = id;
      }
    }
    if (oldestId) {
      const entry = this.pool.get(oldestId);
      try { entry.proc.kill(); } catch (e) { /* ignore */ }
      this.pool.delete(oldestId);
      this._removeFromActive(entry.sessionId, oldestId);
    }
  }

  _removeFromActive(sessionId, processId) {
    const list = this.active.get(sessionId);
    if (list) {
      const idx = list.indexOf(processId);
      if (idx >= 0) list.splice(idx, 1);
      if (list.length === 0) this.active.delete(sessionId);
    }
  }
}

export { ProcessPool };
