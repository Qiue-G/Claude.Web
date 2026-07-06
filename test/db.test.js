import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, existsSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initDb } from '../src/server/db.js';

/** Create a clean temp workspace dir and automatically clean up */
function withWorkspace(fn) {
  const dir = join(tmpdir(), 'db-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  return fn(dir);
}

test('initDb creates a new database file in non-existing directory', async () => {
  await withWorkspace(async (dir) => {
    const { db, saveDb, close } = await initDb(dir);
    assert.ok(db);
    assert.equal(typeof saveDb, 'function');
    assert.equal(typeof close, 'function');

    // saveDb must be called to write the file to disk
    await saveDb();

    // Verify DB file was created
    const dbPath = join(dir, '_data.db');
    assert.equal(existsSync(dbPath), true);
    close();
  });
});

test('initDb creates sessions and messages tables with correct schema', async () => {
  await withWorkspace(async (dir) => {
    const { db, close } = await initDb(dir);

    // Check sessions columns
    const sessionCols = db.exec('PRAGMA table_info(sessions)');
    const sessionColNames = sessionCols[0].values.map(r => r[1]);
    assert.ok(sessionColNames.includes('id'));
    assert.ok(sessionColNames.includes('token'));
    assert.ok(sessionColNames.includes('csrfToken'));
    assert.ok(sessionColNames.includes('apiKey'));
    assert.ok(sessionColNames.includes('model'));
    assert.ok(sessionColNames.includes('provider'));
    assert.ok(sessionColNames.includes('dir'));
    assert.ok(sessionColNames.includes('createdAt'));
    assert.ok(sessionColNames.includes('lastActivity'));
    assert.ok(sessionColNames.includes('currentModel'));
    assert.ok(sessionColNames.includes('modelHealth'));

    // Check messages columns
    const msgCols = db.exec('PRAGMA table_info(messages)');
    const msgColNames = msgCols[0].values.map(r => r[1]);
    assert.ok(msgColNames.includes('id'));
    assert.ok(msgColNames.includes('sessionId'));
    assert.ok(msgColNames.includes('role'));
    assert.ok(msgColNames.includes('content'));
    assert.ok(msgColNames.includes('timestamp'));
    assert.ok(msgColNames.includes('files'));

    close();
  });
});

test('initDb loads existing database file', async () => {
  await withWorkspace(async (dir) => {
    // First call creates
    const { db, saveDb, close } = await initDb(dir);
    // Insert a row
    db.run("INSERT INTO sessions (id, token, csrfToken, apiKey, dir, createdAt, lastActivity) VALUES ('test-id', 'tk', 'ct', 'ak', '/tmp', 1000, 1000)");
    await saveDb();
    await close();

    // Second call loads
    const { db: db2, close: close2 } = await initDb(dir);
    const rows = db2.exec("SELECT id FROM sessions WHERE id = 'test-id'");
    assert.equal(rows[0].values[0][0], 'test-id');
    close2();
  });
});

test('initDb creates index on messages(sessionId, timestamp)', async () => {
  await withWorkspace(async (dir) => {
    const { db, close } = await initDb(dir);
    const indexes = db.exec("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='messages'");
    const indexNames = indexes[0].values.map(r => r[0]);
    assert.ok(indexNames.some(n => n.includes('idx_messages_session')));
    close();
  });
});

test('saveDb persists database to disk', async () => {
  await withWorkspace(async (dir) => {
    const { db, saveDb, close } = await initDb(dir);
    db.run("INSERT INTO sessions (id, token, csrfToken, apiKey, dir, createdAt, lastActivity) VALUES ('s1', 'tk1', 'ct1', 'ak1', '/tmp', 1000, 1000)");
    await saveDb();

    // Read the file directly and verify content
    const dbPath = join(dir, '_data.db');
    const fileContent = readFileSync(dbPath);
    assert.ok(fileContent.length > 0);

    // Reopen and verify
    const SQL = (await import('sql.js')).default;
    const SQLModule = await SQL();
    const db2 = new SQLModule.Database(fileContent);
    const rows = db2.exec("SELECT id FROM sessions WHERE id = 's1'");
    assert.equal(rows[0].values[0][0], 's1');
    db2.close();
    close();
  });
});

// ====================================================================
// Parameter binding via monitor.exec (sql.js exec() 不支持参数绑定)
// ====================================================================

test('monitor.exec supports parameter binding with ? placeholders', async () => {
  await withWorkspace(async (dir) => {
    const { monitor, saveDb, close } = await initDb(dir);

    // Insert test data via raw db.run
    monitor.run("INSERT INTO sessions (id, token, csrfToken, apiKey, dir, createdAt, lastActivity) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ['param-test-id', 'tk-p', 'ct-p', 'ak-p', '/tmp', 2000, 2000]);
    monitor.run("INSERT INTO sessions (id, token, csrfToken, apiKey, dir, createdAt, lastActivity) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ['param-test-id-2', 'tk-p2', 'ct-p2', 'ak-p2', '/tmp', 2001, 2001]);

    // Query with parameter binding
    const rows = monitor.exec('SELECT id, token FROM sessions WHERE id = ?', ['param-test-id']);
    assert.ok(rows.length > 0, 'Should return results');
    assert.equal(rows[0].columns.length, 2);
    assert.equal(rows[0].values[0][0], 'param-test-id');
    assert.equal(rows[0].values[0][1], 'tk-p');

    // Query with multiple parameters
    const rows2 = monitor.exec('SELECT id FROM sessions WHERE createdAt > ? AND createdAt < ?', [1999, 3000]);
    assert.equal(rows2[0].values.length, 2);

    // Query with no params behaves like normal exec
    const allRows = monitor.exec('SELECT id FROM sessions ORDER BY id');
    assert.ok(allRows[0].values.length >= 2);

    // Query returning no results with params
    const empty = monitor.exec('SELECT id FROM sessions WHERE id = ?', ['nonexistent']);
    assert.equal(empty.length, 0);

    close();
  });
});
