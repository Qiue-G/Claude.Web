/**
 * SQLite database layer powered by sql.js (pure WASM, zero native deps).
 *
 * Provides a central connection and schema initialization.
 * sessionManager and messageStore receive the db handle via DI.
 *
 * E4: + 慢查询监控 + WAL 模式
 */
import initSqlJs from 'sql.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';

const DB_FILENAME = '_data.db';

/** 慢查询阈值 (ms) — 超过此值的查询会被记录警告 */
const SLOW_QUERY_THRESHOLD_MS = 200;

/**
 * 创建慢查询监控（包装 db.run / db.exec）
 * @param {import('sql.js').Database} db
 * @returns {{ run: Function, exec: Function, getSlowQueries: Function, clearSlowQueries: Function }}
 */
function createSlowQueryMonitor(db) {
  const slowQueries = []; // 环形缓冲区，保留最近 100 条
  const MAX_SLOW_LOG = 100;

  /** 包装 db.run，自动计时 */
  function run(sql, params) {
    const start = Date.now();
    try {
      return db.run(sql, params);
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed > SLOW_QUERY_THRESHOLD_MS) {
        const entry = { sql: sql.slice(0, 200), elapsed: `${elapsed}ms`, time: new Date().toISOString() };
        slowQueries.push(entry);
        if (slowQueries.length > MAX_SLOW_LOG) slowQueries.shift();
        console.warn(`[DB SLOW] ${elapsed}ms — ${sql.slice(0, 150)}`);
      }
    }
  }

  /** 包装 db.exec，自动计时 */
  function exec(sql, params) {
    const start = Date.now();
    try {
      return db.exec(sql, params);
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed > SLOW_QUERY_THRESHOLD_MS) {
        const entry = { sql: sql.slice(0, 200), elapsed: `${elapsed}ms`, time: new Date().toISOString() };
        slowQueries.push(entry);
        if (slowQueries.length > MAX_SLOW_LOG) slowQueries.shift();
        console.warn(`[DB SLOW] ${elapsed}ms — ${sql.slice(0, 150)}`);
      }
    }
  }

  function getSlowQueries() {
    return [...slowQueries];
  }

  function clearSlowQueries() {
    slowQueries.length = 0;
  }

  return { run, exec, getSlowQueries, clearSlowQueries };
}

/**
 * Initialize (or load) the SQLite database at {workspaceDir}/_data.db.
 * Creates tables if they don't exist.
 *
 * @param {string} workspaceDir
 * @returns {Promise<{ db: any, monitor: object, saveDb: Function, close: Function, saveDbImmediate: Function }>}
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

  // E4: WAL mode for concurrent read perf; MEMORY journal for write speed
  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA synchronous=NORMAL');
  db.run('PRAGMA cache_size=-8000'); // 8MB cache
  db.run('PRAGMA temp_store=MEMORY');
  db.run('PRAGMA mmap_size=268435456'); // 256MB mmap

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
  db.run('CREATE INDEX IF NOT EXISTS idx_messages_session_role ON messages(sessionId, role, timestamp)');

  // ── File Versions ──
  db.run(`
    CREATE TABLE IF NOT EXISTS file_versions (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      filePath TEXT NOT NULL,
      content TEXT NOT NULL,
      hash TEXT NOT NULL,
      size INTEGER NOT NULL,
      createdAt INTEGER NOT NULL,
      action TEXT NOT NULL DEFAULT 'save',
      FOREIGN KEY (sessionId) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_file_versions_session ON file_versions(sessionId, filePath, createdAt)');
  db.run('CREATE INDEX IF NOT EXISTS idx_file_versions_hash ON file_versions(hash)');

  console.log('[DB] schema initialized');

  // ── 慢查询监控 (E4) ──
  const monitor = createSlowQueryMonitor(db);

  // ── Throttled save: debounce disk writes to avoid excessive I/O ──
  let saveTimer = null;
  let pendingSave = false;
  const SAVE_DEBOUNCE_MS = 2000;

  /** Persist the database to disk (throttled). */
  async function saveDb() {
    if (saveTimer) {
      pendingSave = true;
      return;
    }
    try {
      const data = db.export();
      await writeFile(filePath, Buffer.from(data));
    } catch (e) {
      console.error('[DB] save failed:', e.message);
    }
    // Schedule next save after debounce window
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (pendingSave) {
        pendingSave = false;
        saveDb();
      }
    }, SAVE_DEBOUNCE_MS);
  }

  /** Force immediate save (e.g., on shutdown). */
  async function saveDbImmediate() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
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

  return { db, monitor, saveDb, close, saveDbImmediate };
}
