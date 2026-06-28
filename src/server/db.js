/**
 * SQLite database layer powered by sql.js (pure WASM, zero native deps).
 *
 * Provides a central connection and schema initialization.
 * sessionManager and messageStore receive the db handle via DI.
 */
import initSqlJs from 'sql.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';

const DB_FILENAME = '_data.db';

/**
 * Initialize (or load) the SQLite database at {workspaceDir}/_data.db.
 * Creates tables if they don't exist.
 *
 * @param {string} workspaceDir
 * @returns {Promise<{ db: any, saveDb: Function, close: Function }>}
 */
export async function initDb(workspaceDir) {
  const SQL = await initSqlJs();
  const filePath = join(workspaceDir, DB_FILENAME);

  let db;
  if (existsSync(filePath)) {
    const buffer = await readFile(filePath);
    db = new SQL.Database(buffer);
    console.log('[DB] loaded existing database from ' + filePath);
  } else {
    const dir = dirname(filePath);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    db = new SQL.Database();
    console.log('[DB] created new database at ' + filePath);
  }

  // Enable WAL-like durability (sql.js: export after writes)
  db.run('PRAGMA journal_mode=MEMORY');
  db.run('PRAGMA synchronous=NORMAL');

  // ── Schema ──
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      csrfToken TEXT NOT NULL,
      apiKey TEXT NOT NULL,
      model TEXT,
      provider TEXT,
      dir TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      lastActivity INTEGER NOT NULL,
      currentModel TEXT,
      modelHealth TEXT DEFAULT 'connecting'
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      files TEXT,
      FOREIGN KEY (sessionId) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(sessionId, timestamp)');

  console.log('[DB] schema initialized');

  /** Persist the database to disk. */
  async function saveDb() {
    try {
      const data = db.export();
      await writeFile(filePath, Buffer.from(data));
    } catch (e) {
      console.error('[DB] save failed:', e.message);
    }
  }

  function close() {
    db.close();
  }

  return { db, saveDb, close };
}
