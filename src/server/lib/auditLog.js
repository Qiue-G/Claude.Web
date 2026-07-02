/**
 * Audit Log - records key operations for security and compliance.
 *
 * Operations tracked:
 * - Session create/delete
 * - RAG document ingest/delete
 * - Tool calls (approve/reject)
 * - Model switch
 * - Admin actions
 *
 * Storage: SQLite `audit_log` table
 * Retention: configurable via AUDIT_LOG_RETENTION_DAYS (default: 7)
 */

export function createAuditLog(db) {
  // Create table
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      action TEXT NOT NULL,
      resource TEXT,
      resourceId TEXT,
      sessionId TEXT,
      userId TEXT,
      details TEXT,
      ip TEXT
    )
  `);

  // Create index for faster queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
    CREATE INDEX IF NOT EXISTS idx_audit_log_session ON audit_log(sessionId);
  `);

  const RETENTION_DAYS = parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || '7');

  function log(action, { resource, resourceId, sessionId, userId, details, ip } = {}) {
    const stmt = db.prepare(`
      INSERT INTO audit_log (timestamp, action, resource, resourceId, sessionId, userId, details, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      new Date().toISOString(),
      action,
      resource || null,
      resourceId || null,
      sessionId || null,
      userId || null,
      details ? JSON.stringify(details) : null,
      ip || null
    );
  }

  function getLogs({ limit = 100, offset = 0, action, sessionId, startDate, endDate } = {}) {
    let query = 'SELECT * FROM audit_log WHERE 1=1';
    const params = [];

    if (action) {
      query += ' AND action = ?';
      params.push(action);
    }
    if (sessionId) {
      query += ' AND sessionId = ?';
      params.push(sessionId);
    }
    if (startDate) {
      query += ' AND timestamp >= ?';
      params.push(startDate);
    }
    if (endDate) {
      query += ' AND timestamp <= ?';
      params.push(endDate);
    }

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const stmt = db.prepare(query);
    const rows = stmt.all(...params);

    // Parse details JSON
    return rows.map(row => ({
      ...row,
      details: row.details ? JSON.parse(row.details) : null
    }));
  }

  function cleanup() {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const stmt = db.prepare('DELETE FROM audit_log WHERE timestamp < ?');
    const result = stmt.run(cutoff);
    return result.changes;
  }

  return { log, getLogs, cleanup };
}
