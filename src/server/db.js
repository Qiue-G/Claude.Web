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

  /** 包装 db.exec，自动计时
   *  NOTE: sql.js 的 Database.exec() 不支持参数绑定（第二个参数被静默忽略）。
   *  当传入 params 时，改用 db.prepare() + getAsObject() 实现参数化查询。
   *  返回格式与 db.exec() 一致: [{ columns: [...], values: [[...], ...] }]
   */
  function exec(sql, params) {
    const start = Date.now();
    try {
      if (params && params.length > 0) {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        const rows = [];
        let columns = [];
        let first = true;
        while (stmt.step()) {
          const obj = stmt.getAsObject();
          if (first) {
            columns = Object.keys(obj);
            first = false;
          }
          rows.push(columns.map(c => obj[c]));
        }
        stmt.free();
        return rows.length > 0 ? [{ columns, values: rows }] : [];
      }
      return db.exec(sql);
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

  // sql.js 是 WASM 内存数据库，以下 PRAGMA 仅有内存级效果：
  // - cache_size: 影响内存页缓存，对 export 速度有间接帮助
  // - temp_store=MEMORY: 临时表存储在内存中
  // 注意: WAL/mmap/synchronous 等磁盘 I/O 相关 PRAGMA 对 sql.js 无效，
  //       数据库持久化通过 db.export() + writeFile() 实现
  db.run('PRAGMA cache_size=-8000');     // 8MB 内存页缓存
  db.run('PRAGMA temp_store=MEMORY');    // 临时表在内存中

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

  // 兼容旧数据：使用 PRAGMA 检测列是否存在，避免每次 ALTER TABLE
  function ensureColumns(table, columns) {
    const existing = db.exec(`PRAGMA table_info(${table})`);
    const existingCols = existing[0]?.values?.map(v => v[1]) || [];
    for (const col of columns) {
      if (!existingCols.includes(col.name)) {
        const def = col.type + (col.default ? ` DEFAULT ${col.default}` : '');
        try {
          db.run(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${def}`);
        } catch (e) {
          console.warn(`[DB] Failed to add column ${col.name}: ${e.message}`);
        }
      }
    }
  }
  ensureColumns('sessions', [
    { name: 'owner_id', type: 'TEXT' },
    { name: 'role', type: 'TEXT', default: "'owner'" },
    { name: 'status', type: 'TEXT', default: "'private'" },
    { name: 'share_token', type: 'TEXT' },
    { name: 'coauthors', type: 'TEXT', default: "'[]'" }
  ]);

  db.run(`
    CREATE TABLE IF NOT EXISTS share_sessions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      inviter_id TEXT NOT NULL,
      invitee_id TEXT NOT NULL,
      permission TEXT DEFAULT 'read',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_share_sessions_session ON share_sessions(session_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_share_sessions_invitee ON share_sessions(invitee_id)');

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

  // ── Message Versions (T5) ──
  db.run(`
    CREATE TABLE IF NOT EXISTS message_versions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      content TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_message_versions_session ON message_versions(session_id, message_id, version)');

  // ── Users ──
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user')),
      created_at TEXT DEFAULT (datetime('now')),
      last_login TEXT
    )
  `);

  // 兼容旧数据：添加 userId 列（如果不存在），复用 ensureColumns
  ensureColumns('sessions', [
    { name: 'userId', type: 'TEXT REFERENCES users(id)' }
  ]);

  console.log('[DB] schema initialized');

  // ── 慢查询监控 (E4) ──
  const monitor = createSlowQueryMonitor(db);

  // ── Throttled save: debounce disk writes to avoid excessive I/O ──
  let saveTimer = null;
  let pendingSave = false;
  const SAVE_DEBOUNCE_MS = 5000;

  /** Persist the database to disk (throttled with retry). */
  const SAVE_RETRIES = 3;
  async function saveDb() {
    if (saveTimer) {
      pendingSave = true;
      return;
    }
    try {
      const data = db.export();
      let lastError = null;
      for (let i = 0; i < SAVE_RETRIES; i++) {
        try {
          await writeFile(filePath, Buffer.from(data));
          lastError = null;
          break;
        } catch (e) {
          lastError = e;
          if (i < SAVE_RETRIES - 1) await new Promise(r => setTimeout(r, 100 * Math.pow(2, i)));
        }
      }
      if (lastError) console.error('[DB] save failed after retries:', lastError.message);
    } catch (e) {
      console.error('[DB] export failed:', e.message);
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
