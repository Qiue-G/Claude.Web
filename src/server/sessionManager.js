import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname as pathDirname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = pathDirname(__filename);

/**
 * Creates a session manager with JSON file persistence.
 *
 * Sessions are persisted to `{workspaceDir}/_sessions.json`.
 * Runtime-only state (processes, proxies, clients) is NOT stored here.
 *
 * @param {string} workspaceDir - Directory for session data and workspace files
 * @returns {{ sessions: Map, createSession: Function, getSession: Function, deleteSession: Function, saveSessions: Function, loadSessions: Function }}
 */
export function createSessionManager(workspaceDir) {
  const sessions = new Map();
  const filePath = join(workspaceDir, '_sessions.json');

  /**
   * Load sessions from disk. Called once at startup.
   * Sets lastActivity to now so sessions don't expire immediately after restart.
   */
  async function loadSessions() {
    try {
      if (!existsSync(filePath)) {
        console.log('[SESSION] no saved sessions file found at ' + filePath);
        return;
      }
      const raw = await readFile(filePath, 'utf-8');
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return;
      const now = Date.now();
      for (const item of data) {
        item.lastActivity = now;
        sessions.set(item.id, item);
      }
      console.log('[SESSION] loaded ' + sessions.size + ' sessions from ' + filePath);
    } catch (e) {
      console.log('[SESSION] no saved sessions to load (' + e.message + ')');
    }
  }

  /**
   * Save all sessions to disk as JSON array.
   */
  async function saveSessions() {
    try {
      const dir = pathDirname(filePath);
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });
      const data = JSON.stringify(Array.from(sessions.values()));
      await writeFile(filePath, data, 'utf-8');
    } catch (e) {
      console.error('[SESSION] save failed:', e.message);
    }
  }

  /**
   * Create a new session, persist it, and return it.
   * Returns null if maxSessions is reached.
   */
  async function createSession(apiKey, model, provider, maxSessions) {
    if (sessions.size >= maxSessions) return null;
    const sessionId = uuidv4();
    const sessionToken = uuidv4();
    const csrfToken = uuidv4();
    const sessionDir = join(workspaceDir, sessionId);
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(sessionDir, { recursive: true });
    const session = {
      id: sessionId,
      token: sessionToken,
      csrfToken,
      apiKey,
      model,
      provider,
      dir: sessionDir,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      currentModel: model,
      modelHealth: 'connecting'
    };
    sessions.set(sessionId, session);
    await saveSessions();
    return session;
  }

  /**
   * Get a session by ID. Validates token if provided.
   * Updates lastActivity in memory (does not trigger file write).
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
   * Delete a session and persist the change.
   */
  async function deleteSession(sessionId) {
    const existed = sessions.has(sessionId);
    sessions.delete(sessionId);
    if (existed) await saveSessions();
    return existed;
  }

  return { sessions, createSession, getSession, deleteSession, saveSessions, loadSessions };
}
