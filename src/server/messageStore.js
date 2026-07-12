/**
 * Message store backed by SQLite.
 *
 * Messages are stored in the `messages` table with a sessionId foreign key.
 * Interface matches the original JSON file store for drop-in replacement.
 *
 * E4: + 分页使用 SQL LIMIT/OFFSET, + saveMessagesBatch() 批量写入
 *
 * @param {object} deps
 * @param {import('sql.js').Database} deps.db
 * @param {object} deps.monitor     — createSlowQueryMonitor 返回的 { run, exec }
 * @param {Function} deps.saveDb
 * @returns {{ loadMessages: Function, loadMessagesPaginated: Function, saveMessage: Function, saveMessagesBatch: Function, appendToLastMessage: Function, deleteSessionMessages: Function, save: Function }}
 */
import { randomUUID } from 'crypto';
export function createMessageStore({ db, monitor, saveDb }) {
  const PAGE_SIZE = 20;

  // 使用 monitor 包装的 run/exec（如果提供了 monitor）
  const run = monitor?.run || ((sql, p) => db.run(sql, p));
  const exec = monitor?.exec || ((sql, p) => db.exec(sql, p));

  function rowToMessage(row) {
    return {
      id: row.id,
      role: row.role,
      content: row.content,
      timestamp: row.timestamp,
      files: row.files ? JSON.parse(row.files) : null
    };
  }

  function rowsToMessages(rows) {
    if (rows.length === 0 || !rows[0].values) return [];
    const cols = rows[0].columns;
    return rows[0].values.map(row => {
      const obj = {};
      cols.forEach((col, i) => { obj[col] = row[i]; });
      return rowToMessage(obj);
    });
  }

  /**
   * Load all messages for a session (oldest first).
   */
  async function loadMessages(sessionId) {
    try {
      const rows = exec(
        'SELECT id, role, content, timestamp, files FROM messages WHERE sessionId = ? ORDER BY timestamp ASC',
        [sessionId]
      );
      return rowsToMessages(rows);
    } catch (e) {
      console.error('[MESSAGE] load failed for ' + sessionId + ': ' + e.message);
      return [];
    }
  }

  /**
   * Load messages with pagination (newest last).
   * E4: 使用 SQL LIMIT/OFFSET 代替加载全部后切片
   */
  async function loadMessagesPaginated(sessionId, page = 0) {
    try {
      // 先查总数（用于计算总页数）
      const countRows = exec(
        'SELECT COUNT(*) as cnt FROM messages WHERE sessionId = ?',
        [sessionId]
      );
      const total = countRows?.[0]?.values?.[0]?.[0] || 0;
      const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

      // 超出页数范围，返回空
      if (page >= totalPages) {
        return { messages: [], page, totalPages, hasMore: false };
      }

      // 分页查询：0-indexed，最新消息在最后（ASC 排序）
      // 复制旧版 JS 切片逻辑的等价 SQL：all.slice(startIdx, endIdx)
      const startIdx = Math.max(0, total - (page + 1) * PAGE_SIZE);
      const endIdx = Math.max(0, total - page * PAGE_SIZE);
      const limit = endIdx - startIdx;
      const offset = startIdx;

      const rows = exec(
        'SELECT id, role, content, timestamp, files FROM messages WHERE sessionId = ? ORDER BY timestamp ASC LIMIT ? OFFSET ?',
        [sessionId, limit, offset]
      );
      const messages = rowsToMessages(rows);
      return { messages, page, totalPages, hasMore: page + 1 < totalPages };
    } catch (e) {
      console.error('[MESSAGE] loadMessagesPaginated failed: ' + e.message);
      return { messages: [], page: 0, totalPages: 1, hasMore: false };
    }
  }

  /**
   * Save a single message.
   * E4: 不再每次都 await saveDb() — 由 save() 或批写入统一持久化
   */
  async function saveMessage(sessionId, msg) {
    const id = msg.id || randomUUID();
    const timestamp = Date.now();
    const files = msg.files ? JSON.stringify(msg.files) : null;

    try {
      run(
        `INSERT INTO messages (id, sessionId, role, content, timestamp, files)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, sessionId, msg.role || 'user', msg.content || '', timestamp, files]
      );
    } catch (e) {
      console.error('[MESSAGE] save failed:', e.message);
    }

    return { id, role: msg.role || 'user', content: msg.content || '', timestamp, files: msg.files || null };
  }

  /**
   * E4: 批量保存多条消息（事务内执行）
   * @param {string} sessionId
   * @param {Array<{ role: string, content: string, files?: object, id?: string }>} messages
   * @returns {Promise<Array>}
   */
  async function saveMessagesBatch(sessionId, messages) {
    if (!messages || messages.length === 0) return [];

    const timestamp = Date.now();
    const saved = [];

    try {
      run('BEGIN TRANSACTION');
      for (const msg of messages) {
        const id = msg.id || randomUUID();
        const files = msg.files ? JSON.stringify(msg.files) : null;
        run(
          `INSERT INTO messages (id, sessionId, role, content, timestamp, files)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [id, sessionId, msg.role || 'user', msg.content || '', timestamp, files]
        );
        saved.push({ id, role: msg.role || 'user', content: msg.content || '', timestamp, files: msg.files || null });
      }
      run('COMMIT');
    } catch (e) {
      run('ROLLBACK');
      console.error('[MESSAGE] batch save failed:', e.message);
    }

    return saved;
  }

  /**
   * Append text to the last assistant message (for streaming).
   */
  async function appendToLastMessage(sessionId, text) {
    try {
      const rows = exec(
        'SELECT id, content FROM messages WHERE sessionId = ? AND role = ? ORDER BY timestamp DESC LIMIT 1',
        [sessionId, 'assistant']
      );
      if (rows.length === 0 || !rows[0].values || rows[0].values.length === 0) return;
      const lastId = rows[0].values[0][0];
      const lastContent = rows[0].values[0][1];
      run('UPDATE messages SET content = ? WHERE id = ?', [lastContent + text, lastId]);
    } catch (e) {
      console.error('[MESSAGE] append failed:', e.message);
    }
  }

  /**
   * Delete all messages for a session.
   */
  async function deleteSessionMessages(sessionId) {
    try {
      run('DELETE FROM messages WHERE sessionId = ?', [sessionId]);
      await saveDb();
    } catch (e) {
      console.error('[MESSAGE] delete failed:', e.message);
    }
  }

  async function save() {
    await saveDb();
  }

  return { loadMessages, loadMessagesPaginated, saveMessage, saveMessagesBatch, appendToLastMessage, deleteSessionMessages, save };
}
