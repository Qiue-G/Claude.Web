import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createFileRouter } from '../src/server/routes/fileRoutes.js';
import { createSessionManager } from '../src/server/sessionManager.js';
import initSqlJs from 'sql.js';

/** Helper: start a server on a random port */
function withApp(app) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      resolve({
        url: 'http://127.0.0.1:' + port,
        close: () => new Promise((r) => server.close(() => r()))
      });
    });
    server.on('error', reject);
  });
}

async function createTestEnv() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, token TEXT, csrfToken TEXT, apiKey TEXT, model TEXT, provider TEXT, dir TEXT, createdAt INTEGER, lastActivity INTEGER, currentModel TEXT, modelHealth TEXT)');

  const workDir = join(tmpdir(), 'file-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  mkdirSync(workDir, { recursive: true });

  const sm = createSessionManager({ db, saveDb: async () => {}, workspaceDir: workDir });
  const session = await sm.createSession('sk-test', 'gpt-4', 'openai', 100);

  // Create a real file in the session dir
  writeFileSync(join(session.dir, 'hello.txt'), 'Hello, World!');
  mkdirSync(join(session.dir, 'subdir'));
  writeFileSync(join(session.dir, 'subdir', 'nested.txt'), 'Nested file');

  const sessions = sm.sessions;

  const router = createFileRouter({
    getSession: (sid, token) => {
      const s = sessions.get(sid);
      if (s && token && s.token !== token) return null;
      return s || null;
    },
    sessions: sm.sessions,
    checkRateLimit: () => true,
    RATE_WINDOW: 60000,
    RATE_MAX_FILE: 100
  });

  const app = express();
  app.use(express.json());
  app.use('/api/files', router);
  // Centralized error handler (mirrors production setup)
  app.use((err, req, res, next) => {
    if (err.status) {
      return res.status(err.status).json(err.toJSON ? err.toJSON() : { error: err.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  });

  return { app, session, sessions, workDir, db, closeDb: () => db.close() };
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

// ====================================================================
// Auth / CSRF / Rate limit
// ====================================================================

test('file GET tree rejects invalid token', async () => {
  const { app, session, workDir, closeDb } = await createTestEnv();
  const { url, close } = await withApp(app);
  try {
    const res = await fetch(url + '/api/files/' + session.id, {
      headers: { 'x-session-token': 'bad-token' }
    });
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.match(data.error, /invalid session/i);
  } finally {
    await close(); closeDb(); cleanup(workDir);
  }
});

test('file POST write rejects missing CSRF', async () => {
  const { app, session, workDir, closeDb } = await createTestEnv();
  const { url, close } = await withApp(app);
  try {
    const res = await fetch(url + '/api/files/' + session.id + '/newfile.txt', {
      method: 'POST',
      headers: { 'x-session-token': session.token, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'test' })
    });
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.match(data.error, /CSRF/i);
  } finally {
    await close(); closeDb(); cleanup(workDir);
  }
});

// ====================================================================
// File Tree
// ====================================================================

test('file GET tree returns directory structure', async () => {
  const { app, session, workDir, closeDb } = await createTestEnv();
  const { url, close } = await withApp(app);
  try {
    const res = await fetch(url + '/api/files/' + session.id, {
      headers: { 'x-session-token': session.token }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.tree);
    assert.ok(Array.isArray(data.tree));
    // Should contain hello.txt
    const hello = data.tree.find(e => e.name === 'hello.txt');
    assert.ok(hello);
    assert.equal(hello.type, 'file');
    // Should contain subdir directory
    const subdir = data.tree.find(e => e.name === 'subdir');
    assert.ok(subdir);
    assert.equal(subdir.type, 'directory');
    assert.ok(Array.isArray(subdir.children));
  } finally {
    await close(); closeDb(); cleanup(workDir);
  }
});

// ====================================================================
// File Read
// ====================================================================

test('file GET content returns file content', async () => {
  const { app, session, workDir, closeDb } = await createTestEnv();
  const { url, close } = await withApp(app);
  try {
    const res = await fetch(url + '/api/files/' + session.id + '/hello.txt', {
      headers: { 'x-session-token': session.token }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.content, 'Hello, World!');
    assert.equal(data.path, 'hello.txt');
  } finally {
    await close(); closeDb(); cleanup(workDir);
  }
});

test('file GET reads nested file', async () => {
  const { app, session, workDir, closeDb } = await createTestEnv();
  const { url, close } = await withApp(app);
  try {
    const res = await fetch(url + '/api/files/' + session.id + '/subdir/nested.txt', {
      headers: { 'x-session-token': session.token }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.content, 'Nested file');
  } finally {
    await close(); closeDb(); cleanup(workDir);
  }
});

// ====================================================================
// File Write
// ====================================================================

test('file POST write creates new file', async () => {
  const { app, session, workDir, closeDb } = await createTestEnv();
  const { url, close } = await withApp(app);
  try {
    const res = await fetch(url + '/api/files/' + session.id + '/newfile.txt', {
      method: 'POST',
      headers: {
        'x-session-token': session.token,
        'x-csrf-token': session.csrfToken,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ content: 'New content' })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);

    // Verify on disk
    const fullPath = join(session.dir, 'newfile.txt');
    assert.equal(existsSync(fullPath), true);
    const { readFileSync } = await import('fs');
    assert.equal(readFileSync(fullPath, 'utf-8'), 'New content');
  } finally {
    await close(); closeDb(); cleanup(workDir);
  }
});

// ====================================================================
// File Delete
// ====================================================================

test('file DELETE removes a file', async () => {
  const { app, session, workDir, closeDb } = await createTestEnv();
  const { url, close } = await withApp(app);
  try {
    const res = await fetch(url + '/api/files/' + session.id + '/hello.txt', {
      method: 'DELETE',
      headers: {
        'x-session-token': session.token,
        'x-csrf-token': session.csrfToken
      }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);

    // Verify deleted
    const fullPath = join(session.dir, 'hello.txt');
    assert.equal(existsSync(fullPath), false);
  } finally {
    await close(); closeDb(); cleanup(workDir);
  }
});

// ====================================================================
// Path traversal protection
// ====================================================================

test('file GET rejects path traversal', async () => {
  const { app, session, workDir, closeDb } = await createTestEnv();
  const { url, close } = await withApp(app);
  try {
    // Use URL-encoded .. to prevent fetch from normalizing
    const res = await fetch(url + '/api/files/' + session.id + '/..%2f..%2fetc%2fpasswd', {
      headers: { 'x-session-token': session.token }
    });
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.match(data.error, /path traversal/i);
  } finally {
    await close(); closeDb(); cleanup(workDir);
  }
});

test('file GET rejects sibling directory prefix traversal', async () => {
  const { app, session, workDir, closeDb } = await createTestEnv();
  const { url, close } = await withApp(app);
  try {
    const siblingDir = session.dir + '-evil';
    mkdirSync(siblingDir, { recursive: true });
    writeFileSync(join(siblingDir, 'secret.txt'), 'secret');

    const res = await fetch(url + '/api/files/' + session.id + '/..%2f' + session.id + '-evil%2fsecret.txt', {
      headers: { 'x-session-token': session.token }
    });
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.match(data.error, /path traversal/i);
  } finally {
    await close(); closeDb(); cleanup(workDir); cleanup(session.dir + '-evil');
  }
});

test('file POST rejects path traversal', async () => {
  const { app, session, workDir, closeDb } = await createTestEnv();
  const { url, close } = await withApp(app);
  try {
    const res = await fetch(url + '/api/files/' + session.id + '/..%2fescape.txt', {
      method: 'POST',
      headers: {
        'x-session-token': session.token,
        'x-csrf-token': session.csrfToken,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ content: 'Should not write' })
    });
    assert.equal(res.status, 403);
  } finally {
    await close(); closeDb(); cleanup(workDir);
  }
});
