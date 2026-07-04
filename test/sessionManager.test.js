import test from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createSessionManager } from '../src/server/sessionManager.js';

/** Create an in-memory SQLite database with the schema from db.js */
async function createTestDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

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
      modelHealth TEXT DEFAULT 'connecting',
      owner_id TEXT,
      role TEXT DEFAULT 'owner',
      status TEXT DEFAULT 'private',
      share_token TEXT UNIQUE,
      coauthors TEXT DEFAULT '[]'
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

  return { db, SQL };
}

function makeSessionManager(opts = {}) {
  const { db, SQL } = opts;
  return createSessionManager({
    db,
    saveDb: async () => {},
    workspaceDir: opts.workspaceDir || join(tmpdir(), 'session-test-' + Date.now()),
    ...opts
  });
}

// ====================================================================
// createSession
// ====================================================================

test('createSession creates a new session with valid properties', async () => {
  const { db } = await createTestDb();
  const sm = makeSessionManager({ db });

  const session = await sm.createSession('sk-test', 'gpt-4', 'openai', 100);

  assert.ok(session);
  assert.equal(session.apiKey, 'sk-test');
  assert.equal(session.model, 'gpt-4');
  assert.equal(session.provider, 'openai');
  assert.equal(session.modelHealth, 'connecting');
  assert.ok(session.id);
  assert.ok(session.token);
  assert.ok(session.csrfToken);
  assert.ok(session.dir);
  assert.equal(typeof session.createdAt, 'number');
  assert.equal(typeof session.lastActivity, 'number');
  assert.equal(session.currentModel, 'gpt-4');

  // Verify it was added to the in-memory map
  assert.ok(sm.sessions.has(session.id));
  db.close();
});

test('createSession returns null when maxSessions is reached', async () => {
  const { db } = await createTestDb();
  const sm = makeSessionManager({ db });

  // Fill to capacity (0)
  const first = await sm.createSession('sk-1', 'gpt-4', 'openai', 1);
  assert.ok(first);

  const second = await sm.createSession('sk-2', 'gpt-4', 'openai', 1);
  assert.equal(second, null);
  db.close();
});

test('createSession generates unique IDs and tokens', async () => {
  const { db } = await createTestDb();
  const sm = makeSessionManager({ db });

  const s1 = await sm.createSession('sk-1', 'gpt-4', 'openai', 10);
  const s2 = await sm.createSession('sk-2', 'claude-3', 'anthropic', 10);

  assert.notEqual(s1.id, s2.id);
  assert.notEqual(s1.token, s2.token);
  assert.notEqual(s1.csrfToken, s2.csrfToken);
  db.close();
});

// ====================================================================
// getSession
// ====================================================================

test('getSession returns session by ID', async () => {
  const { db } = await createTestDb();
  const sm = makeSessionManager({ db });

  await sm.createSession('sk-test', 'gpt-4', 'openai', 10);
  const sessionId = [...sm.sessions.keys()][0];

  const found = sm.getSession(sessionId);
  assert.ok(found);
  assert.equal(found.apiKey, 'sk-test');
  db.close();
});

test('getSession returns undefined for non-existent session', async () => {
  const { db } = await createTestDb();
  const sm = makeSessionManager({ db });

  assert.equal(sm.getSession('nonexistent'), undefined);
  db.close();
});

test('getSession validates token when provided', async () => {
  const { db } = await createTestDb();
  const sm = makeSessionManager({ db });

  await sm.createSession('sk-test', 'gpt-4', 'openai', 10);
  const sessionId = [...sm.sessions.keys()][0];
  const actualToken = sm.sessions.get(sessionId).token;

  // Valid token
  assert.ok(sm.getSession(sessionId, actualToken));

  // Invalid token
  assert.equal(sm.getSession(sessionId, 'wrong-token'), null);
  db.close();
});

test('getSession updates lastActivity on access', async () => {
  const { db } = await createTestDb();
  const sm = makeSessionManager({ db });

  await sm.createSession('sk-test', 'gpt-4', 'openai', 10);
  const sessionId = [...sm.sessions.keys()][0];
  const oldActivity = sm.sessions.get(sessionId).lastActivity;

  // Small delay so timestamps differ
  await new Promise(r => setTimeout(r, 5));
  sm.getSession(sessionId);

  assert.ok(sm.sessions.get(sessionId).lastActivity >= oldActivity);
  db.close();
});

// ====================================================================
// deleteSession
// ====================================================================

test('deleteSession removes session from memory and returns true', async () => {
  const { db } = await createTestDb();
  const sm = makeSessionManager({ db });

  await sm.createSession('sk-test', 'gpt-4', 'openai', 10);
  const sessionId = [...sm.sessions.keys()][0];

  const deleted = await sm.deleteSession(sessionId);
  assert.equal(deleted, true);
  assert.equal(sm.sessions.has(sessionId), false);
  assert.equal(sm.getSession(sessionId), undefined);
  db.close();
});

test('deleteSession returns false for non-existent session', async () => {
  const { db } = await createTestDb();
  const sm = makeSessionManager({ db });

  const deleted = await sm.deleteSession('nonexistent');
  assert.equal(deleted, false);
  db.close();
});

// ====================================================================
// saveSessions / loadSessions
// ====================================================================

test('saveSessions persists sessions to SQLite', async () => {
  let saveCalled = false;
  const { db } = await createTestDb();
  const sm = makeSessionManager({
    db,
    saveDb: async () => { saveCalled = true; }
  });

  await sm.createSession('sk-test', 'gpt-4', 'openai', 10);
  await sm.saveSessions();
  assert.equal(saveCalled, true);

  // Verify data is in SQLite
  const rows = db.exec('SELECT COUNT(*) as cnt FROM sessions');
  assert.equal(rows[0].values[0][0], 1);
  db.close();
});

test('loadSessions restores sessions from SQLite into memory', async () => {
  const { db } = await createTestDb();
  const sm1 = makeSessionManager({ db });

  await sm1.createSession('sk-test', 'gpt-4', 'openai', 10);
  await sm1.saveSessions();

  // Create a new manager instance that loads from the same db
  const sm2 = makeSessionManager({ db });

  // Before load: empty
  assert.equal(sm2.sessions.size, 0);

  await sm2.loadSessions();
  assert.equal(sm2.sessions.size, 1);

  const restored = sm2.getSession([...sm2.sessions.keys()][0]);
  assert.equal(restored.apiKey, 'sk-test');
  assert.equal(restored.model, 'gpt-4');
  assert.equal(restored.provider, 'openai');
  assert.ok(restored.token);
  assert.ok(restored.csrfToken);
  db.close();
});

test('loadSessions handles empty database gracefully', async () => {
  const { db } = await createTestDb();
  const sm = makeSessionManager({ db });

  await sm.loadSessions(); // Should not throw
  assert.equal(sm.sessions.size, 0);
  db.close();
});

test('saveSessions does not throw when sessions map is empty', async () => {
  const { db } = await createTestDb();
  const sm = makeSessionManager({ db });

  await sm.saveSessions(); // Should not throw
  const rows = db.exec('SELECT COUNT(*) as cnt FROM sessions');
  assert.equal(rows[0].values[0][0], 0);
  db.close();
});
