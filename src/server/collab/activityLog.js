/**
 * 活动时间线记录器 — 记录会话中的关键操作。
 *
 * 记录类型：
 * - user_join / user_leave
 * - message_send / message_delete
 * - file_edit
 * - snapshot_created / snapshot_rollback
 *
 * 存储方式：内存 Map，按 sessionId 分组，每 session 最多保留 200 条。
 * 可选持久化到 SQLite（通过 deps.db）。
 *
 * @class ActivityLog
 */
import { logger } from '../lib/logger.js';

const MAX_ENTRIES_PER_SESSION = 200;

export class ActivityLog {
  /**
   * @param {object} [deps]
   * @param {import('sql.js').Database} [deps.db] — 可选 SQLite 数据库实例
   */
  constructor(deps = {}) {
    /** @type {Map<string, Array<ActivityEntry>>} */
    this._logs = new Map();
    this._db = deps.db || null;

    // 如果有数据库，尝试创建表
    if (this._db) {
      this._initDb();
    }
  }

  /**
   * 初始化数据库表。
   */
  _initDb() {
    try {
      this._db.run(`
        CREATE TABLE IF NOT EXISTS activity_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          type TEXT NOT NULL,
          actor TEXT,
          detail TEXT,
          timestamp TEXT DEFAULT (datetime('now'))
        )
      `);
      this._db.run(`
        CREATE INDEX IF NOT EXISTS idx_activity_session
        ON activity_log (session_id, timestamp)
      `);
      logger.info('[ActivityLog] database table initialized');
    } catch (e) {
      logger.error('[ActivityLog] db init failed', { error: e.message });
    }
  }

  /**
   * 记录一条活动。
   * @param {string} sessionId
   * @param {string} type — 活动类型
   * @param {object} [detail] — 附加信息
   * @param {string} [detail.actor] — 操作者
   * @param {string} [detail.target] — 操作目标
   * @param {string} [detail.message] — 描述
   */
  log(sessionId, type, detail = {}) {
    if (!sessionId || !type) return;

    const entry = {
      type,
      actor: detail.actor || 'system',
      target: detail.target || '',
      message: detail.message || '',
      timestamp: new Date().toISOString()
    };

    // 内存存储
    if (!this._logs.has(sessionId)) {
      this._logs.set(sessionId, []);
    }
    const log = this._logs.get(sessionId);
    log.push(entry);
    // 限制条数
    if (log.length > MAX_ENTRIES_PER_SESSION) {
      log.splice(0, log.length - MAX_ENTRIES_PER_SESSION);
    }

    // 持久化到数据库
    if (this._db) {
      this._persistEntry(sessionId, entry);
    }

    logger.debug('[ActivityLog] logged', { sessionId, type, actor: entry.actor });
  }

  /**
   * 持久化单条记录到 SQLite。
   * @param {string} sessionId
   * @param {ActivityEntry} entry
   */
  _persistEntry(sessionId, entry) {
    try {
      this._db.run(
        'INSERT INTO activity_log (session_id, type, actor, detail) VALUES (?, ?, ?, ?)',
        [sessionId, entry.type, entry.actor, JSON.stringify({
          target: entry.target,
          message: entry.message
        })]
      );
    } catch (e) {
      logger.error('[ActivityLog] persist failed', { error: e.message });
    }
  }

  /**
   * 获取某个 session 的活动记录。
   * @param {string} sessionId
   * @param {number} [limit=50]
   * @returns {Array<ActivityEntry>}
   */
  getSessionActivity(sessionId, limit = 50) {
    // 优先从内存读取
    const memLog = this._logs.get(sessionId);
    if (memLog && memLog.length > 0) {
      return memLog.slice(-limit).reverse();
    }

    // 回退到数据库
    if (this._db) {
      return this._queryFromDb(sessionId, limit);
    }

    return [];
  }

  /**
   * 从数据库查询活动记录。
   * @param {string} sessionId
   * @param {number} limit
   * @returns {Array<ActivityEntry>}
   */
  _queryFromDb(sessionId, limit) {
    try {
      const result = this._db.exec(
        'SELECT type, actor, detail, timestamp FROM activity_log WHERE session_id = ? ORDER BY id DESC LIMIT ?',
        [sessionId, limit]
      );
      if (!result?.[0]?.values) return [];

      return result[0].values.map(([type, actor, detail, timestamp]) => {
        let parsed = {};
        try { parsed = JSON.parse(detail); } catch (_) {}
        return { type, actor, ...parsed, timestamp };
      });
    } catch (e) {
      logger.error('[ActivityLog] query failed', { error: e.message });
      return [];
    }
  }

  /**
   * 清除某个 session 的内存记录（不影响数据库）。
   * @param {string} sessionId
   */
  clearSession(sessionId) {
    this._logs.delete(sessionId);
  }

  /**
   * 获取所有活跃 session 的 ID 列表。
   * @returns {string[]}
   */
  getActiveSessionIds() {
    return Array.from(this._logs.keys());
  }
}

/**
 * @typedef {Object} ActivityEntry
 * @property {string} type
 * @property {string} actor
 * @property {string} [target]
 * @property {string} [message]
 * @property {string} timestamp
 */
