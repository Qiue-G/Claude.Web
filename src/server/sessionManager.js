import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { encrypt, decrypt } from './lib/crypto.js';

/**
 * Creates a session manager backed by SQLite.
 *
 * @param {object} deps
 * @param {import('sql.js').Database} deps.db - SQLite database handle
 * @param {Function} deps.saveDb - Callback to persist the DB to disk
 * @param {string} deps.workspaceDir - Directory for session workspace folders
 * @param {object} [deps.auditLog] - Audit log instance for recording operations
 * @returns {{ sessions: Map, createSession: Function, getSession: Function, deleteSession: Function, saveSessions: Function, loadSessions: Function }}
 */
export function createSessionManager({ db, saveDb, workspaceDir, auditLog }) {
  // Keep an in-memory Map mirror for O(1) lookups and runtime state
  const sessions = new Map();

  function rowToSession(row) {
    return {
      id: row.id,
      token: row.token,
      csrfToken: row.csrfToken,
      apiKey: decrypt(row.apiKey),  // 解密后存入内存，消费者无需感知
      model: row.model,
      provider: row.provider,
      dir: row.dir,
      createdAt: row.createdAt,
      lastActivity: row.lastActivity,
      currentModel: row.currentModel,
      modelHealth: row.modelHealth,
      owner_id: row.owner_id || null,
      role: row.role || 'owner',
      status: row.status || 'private',
      share_token: row.share_token || null,
      coauthors: row.coauthors || '[]'
    };
  }

  /**
   * Load all sessions from SQLite into memory.
   */
  async function loadSessions() {
    try {
      const rows = db.exec('SELECT * FROM sessions');
      if (rows.length === 0 || !rows[0].values) return;
      const cols = rows[0].columns;
      const now = Date.now();
      for (const row of rows[0].values) {
        const obj = {};
        cols.forEach((col, i) => { obj[col] = row[i]; });
        obj.lastActivity = now;
        const session = rowToSession(obj);
        sessions.set(session.id, session);
      }
      console.log('[SESSION] loaded ' + sessions.size + ' sessions from SQLite');
    } catch (e) {
      console.log('[SESSION] no saved sessions to load (' + e.message + ')');
    }
  }

  /**
   * Save all in-memory sessions to SQLite (upsert).
   */
  async function saveSessions() {
    try {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO sessions (id, token, csrfToken, apiKey, model, provider, dir, createdAt, lastActivity, currentModel, modelHealth, owner_id, role, status, share_token, coauthors)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const session of sessions.values()) {
        stmt.run([
          session.id, session.token, session.csrfToken, encrypt(session.apiKey),
          session.model, session.provider, session.dir, session.createdAt,
          session.lastActivity, session.currentModel, session.modelHealth,
          session.owner_id || null, session.role || 'owner', session.status || 'private',
          session.share_token || null, session.coauthors || '[]'
        ]);
      }
      stmt.free();
      await saveDb();
    } catch (e) {
      console.error('[SESSION] save failed:', e.message);
    }
  }

  /**
   * Create a new session, persist to SQLite, and return it.
   */
  async function createSession(apiKey, model, provider, maxSessions) {
    if (sessions.size >= maxSessions) return null;

    const sessionId = uuidv4();
    const sessionToken = uuidv4();
    const csrfToken = uuidv4();
    const sessionDir = join(workspaceDir, sessionId);
    if (!existsSync(workspaceDir)) await mkdir(workspaceDir, { recursive: true });
    if (!existsSync(sessionDir)) await mkdir(sessionDir, { recursive: true });

    const now = Date.now();
    const session = {
      id: sessionId,
      token: sessionToken,
      csrfToken,
      apiKey,
      model,
      provider,
      dir: sessionDir,
      createdAt: now,
      lastActivity: now,
      currentModel: model,
      modelHealth: 'connecting',
      owner_id: null,
      role: 'owner',
      status: 'private',
      share_token: null,
      coauthors: '[]'
    };

    sessions.set(sessionId, session);

    try {
      db.run(
        `INSERT INTO sessions (id, token, csrfToken, apiKey, model, provider, dir, createdAt, lastActivity, currentModel, modelHealth, owner_id, role, status, share_token, coauthors)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [sessionId, sessionToken, csrfToken, encrypt(apiKey), model, provider, sessionDir, now, now, model, 'connecting', null, 'owner', 'private', null, '[]']
      );
      await saveDb();
      if (auditLog) auditLog.log('session.create', { resource: 'session', resourceId: sessionId, details: { model, provider } });
    } catch (e) {
      console.error('[SESSION] create failed:', e.message);
    }

    return session;
  }

  /**
   * Get a session by ID. Validates token if provided.
   * Updates lastActivity in memory (does not immediately write to DB).
   */
  function getSession(sessionId, token) {
    const session = sessions.get(sessionId);
    if (session) {
      if (token && session.token !== token) return null;
      session.lastActivity = Date.now();
    }
    return session;
  }

  /**
   * Delete a session from SQLite and memory.
   */
  async function deleteSession(sessionId) {
    const existed = sessions.has(sessionId);
    sessions.delete(sessionId);
    try {
      db.run('DELETE FROM messages WHERE sessionId = ?', [sessionId]);
      db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
      await saveDb();
      if (existed && auditLog) auditLog.log('session.delete', { resource: 'session', resourceId: sessionId });
    } catch (e) {
      console.error('[SESSION] delete failed:', e.message);
    }
    return existed;
  }

  return { sessions, createSession, getSession, deleteSession, saveSessions, loadSessions };
}
