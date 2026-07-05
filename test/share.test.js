/**
 * Share & Collaborator API tests
 * 测试会话分享、协作者管理功能
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { randomUUID } from 'crypto';

// 测试用 JWT_SECRET
process.env.JWT_SECRET = 'test-jwt-secret-for-testing-only-32chars!';

import { createSessionRouter } from '../src/server/routes/sessionRoutes.js';
import { signToken } from '../src/server/auth/authMiddleware.js';

// ---- Helper: start a server on a random port ----
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

// ---- Build a share-aware test app ----
function buildShareApp() {
  // Mock SQLite db with exec and run
  const dbRows = {};
  const db = {
    exec: (sql, params) => {
      // Return mock user data when querying users
      if (sql.includes('FROM users') && sql.includes('WHERE username')) {
        const username = params?.[0];
        if (username === 'alice') {
          return [{ columns: ['id', 'username'], values: [['user-alice-id', 'alice']] }];
        }
        if (username === 'bob') {
          return [{ columns: ['id', 'username'], values: [['user-bob-id', 'bob']] }];
        }
        return [];
      }
      if (sql.includes('FROM sessions') && sql.includes('share_token')) {
        const token = params?.[0];
        const sessionData = dbRows[token];
        if (sessionData) {
          return [{ columns: ['id'], values: [[sessionData.id]] }];
        }
        return [];
      }
      return [];
    },
    run: (sql, params) => {
      // Capture share_token for later lookups
      if (sql.includes('UPDATE sessions SET share_token')) {
        const shareToken = params[0];
        const sessionId = params[2];
        if (shareToken && sessionId) {
          dbRows[shareToken] = { id: sessionId };
        }
        if (shareToken === null && sessionId) {
          // Clear the captured token
          for (const key of Object.keys(dbRows)) {
            if (dbRows[key].id === sessionId) {
              delete dbRows[key];
            }
          }
        }
      }
      return {};
    }
  };

  const sessions = new Map();
  const sessionProcesses = new Map();
  const sessionProxies = new Map();
  const messageStore = { deleteSessionMessages: async () => {} };
  const checkRateLimit = () => true;

  // Pre-create a session for testing
  const testSession = {
    id: 'share-test-session-1',
    token: 'test-token-1',
    csrfToken: 'test-csrf-1',
    apiKey: 'sk-test',
    model: 'gpt-4',
    provider: 'openai',
    dir: '/tmp/share-test',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    currentModel: 'gpt-4',
    modelHealth: 'ok',
    owner_id: 'user-alice-id',
    role: 'owner',
    status: 'private',
    share_token: null,
    coauthors: '[]'
  };
  sessions.set(testSession.id, testSession);

  // Token for authenticated users
  const aliceToken = signToken({ id: 'user-alice-id', username: 'alice', role: 'user' });
  const bobToken = signToken({ id: 'user-bob-id', username: 'bob', role: 'user' });

  const app = express();
  app.use(express.json());
  app.use('/api/session', createSessionRouter({
    createSession: async () => testSession,
    getSession: (id, token) => {
      const s = sessions.get(id);
      if (s && token && s.token !== token) return null;
      if (s) s.lastActivity = Date.now();
      return s;
    },
    deleteSession: async () => { sessions.delete(testSession.id); },
    sessions,
    sessionProcesses,
    sessionProxies,
    messageStore,
    checkRateLimit,
    RATE_WINDOW: 60000,
    RATE_MAX_CREATE: 100,
    MAX_SESSIONS: 10,
    DEFAULTS: { provider: 'openai', model: 'gpt-4' },
    db
  }));
  app.use((err, req, res, next) => {
    if (err.status) {
      return res.status(err.status).json(err.toJSON ? err.toJSON() : { error: err.message });
    }
    res.status(500).json({ error: err.message });
  });

  return { app, sessions, testSession, aliceToken, bobToken, dbRows };
}

// ====================================================================
// Share API Tests
// ====================================================================

test('POST /api/session/:id/share generates share link', async () => {
  const { app, aliceToken } = buildShareApp();
  const srv = await withApp(app);
  try {
    const res = await fetch(srv.url + '/api/session/share-test-session-1/share', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': 'test-token-1',
        'x-csrf-token': 'test-csrf-1',
        Authorization: `Bearer ${aliceToken}`
      }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.shareToken);
    assert.equal(data.status, 'shared');
    assert.ok(data.shareUrl);
  } finally { await srv.close(); }
});

test('POST /api/session/:id/share requires authentication', async () => {
  const { app } = buildShareApp();
  const srv = await withApp(app);
  try {
    const res = await fetch(srv.url + '/api/session/share-test-session-1/share', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': 'test-token-1'
      }
    });
    assert.equal(res.status, 401);
  } finally { await srv.close(); }
});

test('DELETE /api/session/:id/share revokes share link', async () => {
  const { app, aliceToken } = buildShareApp();
  const srv = await withApp(app);
  try {
    // First share
    const shareRes = await fetch(srv.url + '/api/session/share-test-session-1/share', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': 'test-token-1',
        'x-csrf-token': 'test-csrf-1',
        Authorization: `Bearer ${aliceToken}`
      }
    });
    assert.equal(shareRes.status, 200);

    // Then unshare
    const unshareRes = await fetch(srv.url + '/api/session/share-test-session-1/share', {
      method: 'DELETE',
      headers: {
        'x-session-token': 'test-token-1',
        'x-csrf-token': 'test-csrf-1',
        Authorization: `Bearer ${aliceToken}`
      }
    });
    assert.equal(unshareRes.status, 200);
    const data = await unshareRes.json();
    assert.equal(data.status, 'private');
  } finally { await srv.close(); }
});

// ====================================================================
// Collaborator API Tests
// ====================================================================

test('POST /api/session/:id/collaborators adds a collaborator', async () => {
  const { app, aliceToken } = buildShareApp();
  const srv = await withApp(app);
  try {
    const res = await fetch(srv.url + '/api/session/share-test-session-1/collaborators', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': 'test-token-1',
        'x-csrf-token': 'test-csrf-1',
        Authorization: `Bearer ${aliceToken}`
      },
      body: JSON.stringify({ username: 'bob' })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(Array.isArray(data.collaborators));
    assert.equal(data.collaborators.length, 1);
    assert.equal(data.collaborators[0].username, 'bob');
  } finally { await srv.close(); }
});

test('POST /api/session/:id/collaborators rejects non-existent user', async () => {
  const { app, aliceToken } = buildShareApp();
  const srv = await withApp(app);
  try {
    const res = await fetch(srv.url + '/api/session/share-test-session-1/collaborators', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': 'test-token-1',
        'x-csrf-token': 'test-csrf-1',
        Authorization: `Bearer ${aliceToken}`
      },
      body: JSON.stringify({ username: 'nonexistent' })
    });
    assert.equal(res.status, 404);
  } finally { await srv.close(); }
});

test('GET /api/session/:id/collaborators returns collaborator list', async () => {
  const { app, aliceToken } = buildShareApp();
  const srv = await withApp(app);
  try {
    // First add a collaborator
    await fetch(srv.url + '/api/session/share-test-session-1/collaborators', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': 'test-token-1',
        'x-csrf-token': 'test-csrf-1',
        Authorization: `Bearer ${aliceToken}`
      },
      body: JSON.stringify({ username: 'bob' })
    });

    // Then get the list
    const res = await fetch(srv.url + '/api/session/share-test-session-1/collaborators', {
      headers: {
        'x-session-token': 'test-token-1',
        Authorization: `Bearer ${aliceToken}`
      }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.collaborators));
    assert.equal(data.collaborators.length, 1);
    assert.equal(data.collaborators[0].username, 'bob');
  } finally { await srv.close(); }
});

test('DELETE /api/session/:id/collaborators/:username removes a collaborator', async () => {
  const { app, aliceToken } = buildShareApp();
  const srv = await withApp(app);
  try {
    // First add
    await fetch(srv.url + '/api/session/share-test-session-1/collaborators', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': 'test-token-1',
        'x-csrf-token': 'test-csrf-1',
        Authorization: `Bearer ${aliceToken}`
      },
      body: JSON.stringify({ username: 'bob' })
    });

    // Then remove
    const res = await fetch(srv.url + '/api/session/share-test-session-1/collaborators/bob', {
      method: 'DELETE',
      headers: {
        'x-session-token': 'test-token-1',
        'x-csrf-token': 'test-csrf-1',
        Authorization: `Bearer ${aliceToken}`
      }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.collaborators.length, 0);
  } finally { await srv.close(); }
});

test('GET /api/session/:id returns owner/coauthors/status fields', async () => {
  const { app } = buildShareApp();
  const srv = await withApp(app);
  try {
    const res = await fetch(srv.url + '/api/session/share-test-session-1', {
      headers: { 'x-session-token': 'test-token-1' }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.sessionId, 'share-test-session-1');
    assert.ok('owner_id' in data);
    assert.ok('coauthors' in data);
    assert.ok('status' in data);
    assert.ok(Array.isArray(data.coauthors));
  } finally { await srv.close(); }
});

test('POST /api/session/join/:token rejects invalid share token', async () => {
  const { app, bobToken } = buildShareApp();
  const srv = await withApp(app);
  try {
    const res = await fetch(srv.url + '/api/session/join/invalid-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bobToken}`
      }
    });
    assert.equal(res.status, 404);
  } finally { await srv.close(); }
});
