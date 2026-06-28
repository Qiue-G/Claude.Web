import test from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';

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

  return { db, SQL };
}

function makeStore(opts = {}) {
  const { createMessageStore } = require('../src/server/messageStore.js');
  return createMessageStore({
    db: opts.db,
    saveDb: opts.saveDb || (async () => {})
  });
}

// Use dynamic import for ESM
async function importStore() {
  const mod = await import('../src/server/messageStore.js');
  return mod.createMessageStore;
}

// ====================================================================
// saveMessage + loadMessages
// ====================================================================

test('saveMessage persists a message and returns it', async () => {
  const { db } = await createTestDb();
  const createMessageStore = await importStore();
  const store = createMessageStore({ db, saveDb: async () => {} });

  const msg = await store.saveMessage('session-1', {
    role: 'user',
    content: 'Hello, world!'
  });

  assert.ok(msg);
  assert.equal(msg.role, 'user');
  assert.equal(msg.content, 'Hello, world!');
  assert.ok(msg.id);
  assert.ok(msg.timestamp);
  assert.equal(msg.files, null);
  db.close();
});

test('loadMessages returns messages in chronological order', async () => {
  const { db } = await createTestDb();
  const createMessageStore = await importStore();
  const store = createMessageStore({ db, saveDb: async () => {} });

  await store.saveMessage('session-1', { role: 'user', content: 'First' });
  await store.saveMessage('session-1', { role: 'assistant', content: 'Second' });
  await store.saveMessage('session-1', { role: 'user', content: 'Third' });

  const messages = await store.loadMessages('session-1');
  assert.equal(messages.length, 3);
  assert.equal(messages[0].content, 'First');
  assert.equal(messages[1].content, 'Second');
  assert.equal(messages[2].content, 'Third');
  db.close();
});

test('loadMessages returns empty array for empty session', async () => {
  const { db } = await createTestDb();
  const createMessageStore = await importStore();
  const store = createMessageStore({ db, saveDb: async () => {} });

  const messages = await store.loadMessages('empty-session');
  assert.deepEqual(messages, []);
  db.close();
});

test('saveMessage persists files as JSON', async () => {
  const { db } = await createTestDb();
  const createMessageStore = await importStore();
  const store = createMessageStore({ db, saveDb: async () => {} });

  const files = [{ name: 'test.txt', content: 'data' }];
  await store.saveMessage('session-1', { role: 'user', content: 'With file', files });

  const messages = await store.loadMessages('session-1');
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].files, files);
  db.close();
});

// ====================================================================
// loadMessagesPaginated
// ====================================================================

test('loadMessagesPaginated returns page 0 with hasMore=false for < PAGE_SIZE', async () => {
  const { db } = await createTestDb();
  const createMessageStore = await importStore();
  const store = createMessageStore({ db, saveDb: async () => {} });

  for (let i = 0; i < 5; i++) {
    await store.saveMessage('session-1', { role: 'user', content: `Msg ${i}` });
  }

  const result = await store.loadMessagesPaginated('session-1', 0);
  assert.equal(result.messages.length, 5);
  assert.equal(result.page, 0);
  assert.equal(result.totalPages, 1);
  assert.equal(result.hasMore, false);
  db.close();
});

test('loadMessagesPaginated splits into pages of 20', async () => {
  const { db } = await createTestDb();
  const createMessageStore = await importStore();
  const store = createMessageStore({ db, saveDb: async () => {} });

  for (let i = 0; i < 25; i++) {
    await store.saveMessage('session-1', { role: 'user', content: `Msg ${i}` });
  }

  // Page 0: newest messages (5-24), 20 items
  const page0 = await store.loadMessagesPaginated('session-1', 0);
  assert.equal(page0.messages.length, 20);
  assert.equal(page0.hasMore, true);
  assert.equal(page0.totalPages, 2);

  // Page 1: oldest messages (0-4), 5 items
  const page1 = await store.loadMessagesPaginated('session-1', 1);
  assert.equal(page1.messages.length, 5);
  assert.equal(page1.hasMore, false);

  // Verify order: page1 has oldest, page0 has newest
  assert.equal(page1.messages[0].content, 'Msg 0');
  assert.equal(page0.messages[0].content, 'Msg 5');
  db.close();
});

test('loadMessagesPaginated returns empty array for page beyond range', async () => {
  const { db } = await createTestDb();
  const createMessageStore = await importStore();
  const store = createMessageStore({ db, saveDb: async () => {} });

  for (let i = 0; i < 5; i++) {
    await store.saveMessage('session-1', { role: 'user', content: `Msg ${i}` });
  }

  const result = await store.loadMessagesPaginated('session-1', 99);
  assert.equal(result.messages.length, 0);
  assert.equal(result.page, 99);
  db.close();
});

// ====================================================================
// appendToLastMessage
// ====================================================================

test('appendToLastMessage appends text to the last assistant message', async () => {
  const { db } = await createTestDb();
  const createMessageStore = await importStore();
  const store = createMessageStore({ db, saveDb: async () => {} });

  await store.saveMessage('session-1', { role: 'user', content: 'Hello' });
  await store.saveMessage('session-1', { role: 'assistant', content: 'Hi' });

  await store.appendToLastMessage('session-1', ' there');

  const messages = await store.loadMessages('session-1');
  assert.equal(messages.length, 2);
  assert.equal(messages[1].role, 'assistant');
  assert.equal(messages[1].content, 'Hi there');
  db.close();
});

test('appendToLastMessage does nothing when no assistant messages exist', async () => {
  const { db } = await createTestDb();
  const createMessageStore = await importStore();
  const store = createMessageStore({ db, saveDb: async () => {} });

  await store.saveMessage('session-1', { role: 'user', content: 'Hello' });

  // Should not throw
  await store.appendToLastMessage('session-1', ' appended');
  db.close();
});

test('appendToLastMessage appends to only the most recent assistant message', async () => {
  const { db } = await createTestDb();
  const createMessageStore = await importStore();
  const store = createMessageStore({ db, saveDb: async () => {} });

  await store.saveMessage('session-1', { role: 'assistant', content: 'First response' });
  await store.saveMessage('session-1', { role: 'user', content: 'Follow up' });
  await store.saveMessage('session-1', { role: 'assistant', content: 'Second response' });

  await store.appendToLastMessage('session-1', ' (continued)');

  const messages = await store.loadMessages('session-1');
  assert.equal(messages[0].content, 'First response');
  assert.equal(messages[2].content, 'Second response (continued)');
  db.close();
});

// ====================================================================
// deleteSessionMessages
// ====================================================================

test('deleteSessionMessages removes all messages for a session', async () => {
  const { db } = await createTestDb();
  const createMessageStore = await importStore();
  const store = createMessageStore({ db, saveDb: async () => {} });

  await store.saveMessage('session-1', { role: 'user', content: 'Hello' });
  await store.saveMessage('session-1', { role: 'assistant', content: 'Hi' });
  await store.saveMessage('session-2', { role: 'user', content: 'Other session' });

  await store.deleteSessionMessages('session-1');

  const session1Msgs = await store.loadMessages('session-1');
  assert.equal(session1Msgs.length, 0);

  // Other session unaffected
  const session2Msgs = await store.loadMessages('session-2');
  assert.equal(session2Msgs.length, 1);
  db.close();
});

test('deleteSessionMessages is safe for non-existent session', async () => {
  const { db } = await createTestDb();
  const createMessageStore = await importStore();
  const store = createMessageStore({ db, saveDb: async () => {} });

  await store.deleteSessionMessages('nonexistent'); // Should not throw
  db.close();
});
