/**
 * Message store backed by SQLite.
 *
 * Messages are stored in the `messages` table with a sessionId foreign key.
 * Interface matches the original JSON file store for drop-in replacement.
 *
 * @param {object} deps
 * @param {import('sql.js').Database} deps.db
 * @param {Function} deps.saveDb
 * @returns {{ loadMessages: Function, loadMessagesPaginated: Function, saveMessage: Function, appendToLastMessage: Function, deleteSessionMessages: Function }}
 */
export function createMessageStore({ db, saveDb }) {
  const PAGE_SIZE = 20;

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
      const rows = db.exec(
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
   */
  async function loadMessagesPaginated(sessionId, page = 0) {
    const all = await loadMessages(sessionId);
    const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    const startIdx = Math.max(0, all.length - (page + 1) * PAGE_SIZE);
    const endIdx = all.length - page * PAGE_SIZE;
    const messages = all.slice(Math.max(0, startIdx), Math.max(0, endIdx));
    return { messages, page, totalPages, hasMore: page + 1 < totalPages };
  }

  /**
   * Save a single message.
   */
  async function saveMessage(sessionId, msg) {
    const id = msg.id || (Date.now() + '_' + Math.random().toString(36).slice(2, 8));
    const timestamp = Date.now();
    const files = msg.files ? JSON.stringify(msg.files) : null;

    try {
      db.run(
        `INSERT INTO messages (id, sessionId, role, content, timestamp, files)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, sessionId, msg.role || 'user', msg.content || '', timestamp, files]
      );
      await saveDb();
    } catch (e) {
      console.error('[MESSAGE] save failed:', e.message);
    }

    return { id, role: msg.role || 'user', content: msg.content || '', timestamp, files: msg.files || null };
  }

  /**
   * Append text to the last assistant message (for streaming).
   */
  async function appendToLastMessage(sessionId, text) {
    try {
      const rows = db.exec(
        'SELECT id, content FROM messages WHERE sessionId = ? AND role = ? ORDER BY timestamp DESC LIMIT 1',
        [sessionId, 'assistant']
      );
      if (rows.length === 0 || !rows[0].values || rows[0].values.length === 0) return;
      const lastId = rows[0].values[0][0];
      const lastContent = rows[0].values[0][1];
      db.run('UPDATE messages SET content = ? WHERE id = ?', [lastContent + text, lastId]);
      await saveDb();
    } catch (e) {
      console.error('[MESSAGE] append failed:', e.message);
    }
  }

  /**
   * Delete all messages for a session.
   */
  async function deleteSessionMessages(sessionId) {
    try {
      db.run('DELETE FROM messages WHERE sessionId = ?', [sessionId]);
      await saveDb();
    } catch (e) {
      console.error('[MESSAGE] delete failed:', e.message);
    }
  }

  return { loadMessages, loadMessagesPaginated, saveMessage, appendToLastMessage, deleteSessionMessages };
}
