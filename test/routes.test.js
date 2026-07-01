import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createRateLimiter } from '../src/server/lib/rateLimiter.js';
import { createModelStats } from '../src/server/lib/modelStats.js';
import { createSessionRouter } from '../src/server/routes/sessionRoutes.js';
import { createHealthRouter } from '../src/server/routes/healthRoutes.js';
import { createModelRouter } from '../src/server/routes/modelRoutes.js';
import { createConfigRouter } from '../src/server/routes/configRoutes.js';
import { createRagRouter } from '../src/server/routes/ragRoutes.js';
import { validateUrl, validateUrlReachable } from '../src/server/lib/urlValidator.js';

// ---- Helper: start a server on a random port, return { url, close } ----
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

// ====================================================================
// URL validator
// ====================================================================

test('validateUrl rejects IPv6 private and link-local literals', () => {
  assert.equal(validateUrl('http://[fc00::1]/').valid, false);
  assert.equal(validateUrl('http://[fe80::1]/').valid, false);
});

test('validateUrlReachable rejects DNS results resolving to private addresses', async () => {
  const result = await validateUrlReachable('https://example.com', {
    lookup: async () => [{ address: '127.0.0.1', family: 4 }]
  });
  assert.equal(result.valid, false);
  assert.match(result.error, /private|internal|reserved/i);
});

// ====================================================================
// rateLimiter
// ====================================================================

test('checkRateLimit allows requests within limit', () => {
  const rl = createRateLimiter(60000);
  assert.equal(rl.check('r:1', 3), true);
  assert.equal(rl.check('r:1', 3), true);
  assert.equal(rl.check('r:1', 3), true);
  assert.equal(rl.check('r:1', 3), false);
});

test('checkRateLimit resets after window expires', () => {
  const rl = createRateLimiter(100);
  assert.equal(rl.check('win:1', 2), true);
  assert.equal(rl.check('win:1', 2), true);
  assert.equal(rl.check('win:1', 2), false);
  return new Promise((r) => setTimeout(() => { assert.equal(rl.check('win:1', 2), true); r(); }, 150));
});

test('remaining returns correct count', () => {
  const rl = createRateLimiter(60000);
  assert.equal(rl.remaining('rem:1', 5), 5);
  rl.check('rem:1', 5);
  assert.equal(rl.remaining('rem:1', 5), 4);
  rl.check('rem:1', 5);
  rl.check('rem:1', 5);
  assert.equal(rl.remaining('rem:1', 5), 2);
  rl.check('rem:1', 5);
  rl.check('rem:1', 5);
  assert.equal(rl.remaining('rem:1', 5), 0);
});

test('snapshot returns rate limit entries', () => {
  const rl = createRateLimiter(60000);
  rl.check('snap:a', 10);
  rl.check('snap:a', 10);
  rl.check('snap:b', 10);
  const s = rl.snapshot(10);
  assert.equal(s.length, 2);
  assert.equal(s.find(e => e.key === 'snap:a').count, 2);
  assert.equal(s.find(e => e.key === 'snap:a').remaining, 8);
});

test('multiple rate limiter keys do not interfere', () => {
  const rl = createRateLimiter(60000);
  for (let i = 0; i < 100; i++) rl.check('a', 100);
  assert.equal(rl.check('b', 1), true);
  assert.equal(rl.check('b', 1), false);
});

// ====================================================================
// modelStats
// ====================================================================

test('recordSuccess creates and updates model stats', () => {
  const ms = createModelStats();
  ms.recordSuccess('gpt-4');
  ms.recordSuccess('gpt-4');
  const all = ms.getAll();
  assert.equal(all.find(x => x.id === 'gpt-4').total, 2);
  assert.equal(all.find(x => x.id === 'gpt-4').successRate, 100);
});

test('recordFail accumulates failures', () => {
  const ms = createModelStats();
  ms.recordFail('claude-3', 'timeout');
  ms.recordFail('claude-3', 'rate_limit');
  const m = ms.getAll().find(x => x.id === 'claude-3');
  assert.equal(m.total, 2);
  assert.equal(m.fail, 2);
  assert.equal(m.lastError, 'rate_limit');
});

test('getAll sorts by total descending', () => {
  const ms = createModelStats();
  ms.recordSuccess('a');
  ms.recordSuccess('a');
  ms.recordSuccess('a');
  ms.recordSuccess('b');
  ms.recordSuccess('b');
  ms.recordSuccess('c');
  assert.equal(ms.getAll()[0].id, 'a');
  assert.equal(ms.getAll()[1].id, 'b');
  assert.equal(ms.getAll()[2].id, 'c');
});

test('empty modelStats returns empty array', () => {
  assert.deepEqual(createModelStats().getAll(), []);
});

// ====================================================================
// sessionRoutes integration
// ====================================================================

function buildSessionApp() {
  const rl = createRateLimiter(60000);
  const sessions = new Map();
  let nextId = 0;
  const createSession = async (apiKey, model, provider) => {
    const s = { id: 's-' + (++nextId), token: 't-' + nextId, csrfToken: 'c-' + nextId, apiKey, model, provider, dir: '/tmp/' + nextId, createdAt: Date.now(), lastActivity: Date.now(), currentModel: model, modelHealth: 'connecting' };
    sessions.set(s.id, s);
    return s;
  };
  const getSession = (id, token) => { const s = sessions.get(id); if (s && token && s.token !== token) return null; if (s) s.lastActivity = Date.now(); return s; };
  const deleteSession = async (id) => { sessions.delete(id); };
  const app = express();
  app.use(express.json());
  app.use('/api/session', createSessionRouter({
    createSession, getSession, deleteSession, sessions,
    sessionProcesses: new Map(), sessionProxies: new Map(),
    messageStore: { deleteSessionMessages: async () => {} },
    checkRateLimit: (k, m, w) => rl.check(k, m, w),
    RATE_WINDOW: 60000, RATE_MAX_CREATE: 100, MAX_SESSIONS: 10,
    DEFAULTS: { provider: 'openai', model: 'gpt-4' }
  }));
  // Centralized error handler (mirrors production setup)
  app.use((err, req, res, next) => {
    if (err.status) {
      return res.status(err.status).json(err.toJSON ? err.toJSON() : { error: err.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  });
  return { app, sessions };
}

test('POST /api/session creates session and returns credentials', async () => {
  const { app } = buildSessionApp();
  const srv = await withApp(app);
  try {
    const res = await fetch(srv.url + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: 'sk-test', model: 'gpt-4', provider: 'openai' }) });
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.ok(d.sessionId);
    assert.ok(d.token);
    assert.ok(d.csrfToken);
  } finally { await srv.close(); }
});

test('POST /api/session accepts OpenRouter free model IDs with colon suffix', async () => {
  const { app } = buildSessionApp();
  const srv = await withApp(app);
  try {
    const res = await fetch(srv.url + '/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: 'sk-test',
        model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        provider: 'openrouter'
      })
    });
    assert.equal(res.status, 200);
  } finally { await srv.close(); }
});

// ====================================================================
// searchRoutes integration
// ====================================================================

test('GET /api/search returns search results', async () => {
  const { createSearchRouter } = await import('../src/server/routes/searchRoutes.js');

  // Mock db with exec that returns data
  const mockDb = {
    exec: (sql, params) => {
      if (sql.includes('LIKE')) {
        return [{
          columns: ['sessionId', 'content', 'role', 'timestamp', 'sessionTitle'],
          values: [['s-1', 'Hello JavaScript world', 'user', 1000, 'First chat']]
        }];
      }
      return [];
    }
  };

  const app = express();
  app.use('/api/search', createSearchRouter({ db: mockDb }));
  const srv = await withApp(app);
  try {
    const res = await fetch(srv.url + '/api/search?q=JavaScript');
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.equal(d.total, 1);
    assert.equal(d.results[0].title, 'First chat');
    assert.ok(d.results[0].snippet.includes('JavaScript'));
  } finally { await srv.close(); }
});

test('GET /api/search returns empty for blank query', async () => {
  const { createSearchRouter } = await import('../src/server/routes/searchRoutes.js');
  const app = express();
  app.use('/api/search', createSearchRouter({ db: { exec: () => [] } }));
  const srv = await withApp(app);
  try {
    const res = await fetch(srv.url + '/api/search?q=');
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).results, []);
  } finally { await srv.close(); }
});

// ====================================================================
// ragRoutes integration
// ====================================================================

function buildRagApp() {
  const sessions = new Map();
  sessions.set('sid-1', {
    id: 'sid-1',
    token: 'tok-1',
    csrfToken: 'csrf-1',
    createdAt: Date.now(),
    lastActivity: Date.now()
  });

  const calls = [];
  const rag = {
    totalDocs: 0,
    ingest: async (collection, input) => { calls.push({ type: 'ingest', collection, input }); return 1; },
    search: async (collection, query, options) => {
      calls.push({ type: 'search', collection, query, options });
      return [];
    },
    metrics: {
      getSearchStats: () => ({ count: 0, avgLatencyMs: 0 }),
      getEmbedStats: () => ({ totalCalls: 0, successRate: 100, cacheHitRate: 0 }),
      getIngestStats: () => ({ totalIngestCalls: 0, totalChunksIngested: 0 })
    },
    embedder: { model: 'test', dimensions: 4 }
  };

  const app = express();
  app.use(express.json());
  app.use('/api/rag', createRagRouter({ rag, sessions }));
  app.use((err, req, res, next) => {
    if (err.status) return res.status(err.status).json(err.toJSON ? err.toJSON() : { error: err.message });
    res.status(500).json({ error: err.message });
  });
  return { app, calls };
}

test('RAG search namespaces caller-supplied collection under the current session', async () => {
  const { app, calls } = buildRagApp();
  const srv = await withApp(app);
  try {
    const res = await fetch(srv.url + '/api/rag/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-session-id': 'sid-1',
        'x-session-token': 'tok-1',
        'x-csrf-token': 'csrf-1'
      },
      body: JSON.stringify({ query: 'hello', collection: 'sid-2' })
    });
    assert.equal(res.status, 200);
    assert.equal(calls[0].collection, 'sid-1:sid-2');
  } finally { await srv.close(); }
});

test('RAG ingest namespaces custom collections under the current session', async () => {
  const { app, calls } = buildRagApp();
  const srv = await withApp(app);
  try {
    const res = await fetch(srv.url + '/api/rag/ingest', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-session-id': 'sid-1',
        'x-session-token': 'tok-1'
      },
      body: JSON.stringify({ text: 'hello', collection: 'notes' })
    });
    assert.equal(res.status, 200);
    assert.equal(calls[0].collection, 'sid-1:notes');
  } finally { await srv.close(); }
});

test('POST /api/session rejects missing API key', async () => {
  const { app } = buildSessionApp();
  const srv = await withApp(app);
  try {
    const res = await fetch(srv.url + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Invalid API key/i);
  } finally { await srv.close(); }
});

test('POST /api/session rejects invalid provider', async () => {
  const { app } = buildSessionApp();
  const srv = await withApp(app);
  try {
    const res = await fetch(srv.url + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: 'sk-test', provider: 'unknown' }) });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Invalid provider/i);
  } finally { await srv.close(); }
});

test('GET /api/session/:id returns session info', async () => {
  const { app, sessions } = buildSessionApp();
  sessions.set('sid-1', { id: 'sid-1', token: 'tok-1', csrfToken: 'csrf-1', apiKey: 'sk', model: 'gpt-4', provider: 'openai', dir: '/tmp', createdAt: Date.now(), lastActivity: Date.now(), currentModel: 'gpt-4', modelHealth: 'ok' });
  const srv = await withApp(app);
  try {
    const res = await fetch(srv.url + '/api/session/sid-1', { headers: { 'x-session-token': 'tok-1' } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).sessionId, 'sid-1');
  } finally { await srv.close(); }
});

test('GET /api/session/current validates stored credentials', async () => {
  const { app, sessions } = buildSessionApp();
  sessions.set('sid-1', { id: 'sid-1', token: 'tok-1', csrfToken: 'csrf-1', apiKey: 'sk', model: 'gpt-4', provider: 'openai', dir: '/tmp', createdAt: Date.now(), lastActivity: Date.now(), currentModel: 'gpt-4', modelHealth: 'ok' });
  const srv = await withApp(app);
  try {
    // Valid credentials
    const res1 = await fetch(srv.url + '/api/session/current', { headers: { 'x-session-id': 'sid-1', 'x-session-token': 'tok-1' } });
    assert.equal(res1.status, 200);
    const data = await res1.json();
    assert.equal(data.sessionId, 'sid-1');
    assert.equal(data.currentModel, 'gpt-4');

    // Missing credentials
    const res2 = await fetch(srv.url + '/api/session/current');
    assert.equal(res2.status, 400);

    // Invalid token
    const res3 = await fetch(srv.url + '/api/session/current', { headers: { 'x-session-id': 'sid-1', 'x-session-token': 'wrong' } });
    assert.equal(res3.status, 401);
  } finally { await srv.close(); }
});

test('DELETE /api/session/:id deletes with valid credentials', async () => {
  const { app, sessions } = buildSessionApp();
  sessions.set('del-1', { id: 'del-1', token: 'tok', csrfToken: 'csrf', apiKey: 'sk', model: 'gpt-4', provider: 'openai', dir: '/tmp', createdAt: Date.now(), lastActivity: Date.now(), currentModel: 'gpt-4', modelHealth: 'ok' });
  const srv = await withApp(app);
  try {
    const res = await fetch(srv.url + '/api/session/del-1', { method: 'DELETE', headers: { 'x-session-token': 'tok', 'x-csrf-token': 'csrf' }, body: JSON.stringify({ token: 'tok' }) });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).success, true);
    assert.equal(sessions.has('del-1'), false);
  } finally { await srv.close(); }
});

test('DELETE /api/session/:id rejects without CSRF', async () => {
  const { app, sessions } = buildSessionApp();
  sessions.set('csrf-1', { id: 'csrf-1', token: 'tok', csrfToken: 'csrf', apiKey: 'sk', model: 'gpt-4', provider: 'openai', dir: '/tmp', createdAt: Date.now(), lastActivity: Date.now(), currentModel: 'gpt-4', modelHealth: 'ok' });
  const srv = await withApp(app);
  try {
    const res = await fetch(srv.url + '/api/session/csrf-1', { method: 'DELETE', headers: { 'x-session-token': 'tok' }, body: JSON.stringify({ token: 'tok' }) });
    assert.equal(res.status, 403);
  } finally { await srv.close(); }
});

// ====================================================================
// healthRoutes integration
// ====================================================================

function buildHealthApp(options = {}) {
  const ms = createModelStats();
  const app = express();
  app.use('/api/health', createHealthRouter({
    sessions: new Map(), PROVIDERS: { openai: { models: [] } },
    DEFAULTS: { provider: 'openai', model: 'gpt-4' },
    MAX_SESSIONS: 10, sessionProxies: new Map(),
    modelStats: ms, rateLimits: { snapshot: () => [] },
    RATE_MAX_CREATE: 5, VERSION: 'test',
    allowDetailedHealth: options.allowDetailedHealth === true
  }));
  return app;
}

test('GET /api/health returns basic health info', async () => {
  const app = buildHealthApp();
  const srv = await withApp(app);
  try {
    const res = await fetch(srv.url + '/api/health');
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.equal(d.status, 'ok');
    assert.equal(d.version, 'test');
    assert.equal(d.maxSessions, 10);
    assert.ok(d.memory.heapUsedMB > 0);
  } finally { await srv.close(); }
});

test('GET /api/health/detailed is disabled by default', async () => {
  const app = buildHealthApp();
  const srv = await withApp(app);
  try {
    const res = await fetch(srv.url + '/api/health/detailed');
    assert.equal(res.status, 404);
  } finally { await srv.close(); }
});

test('GET /api/health/detailed returns structured data when explicitly enabled', async () => {
  const app = buildHealthApp({ allowDetailedHealth: true });
  const srv = await withApp(app);
  try {
    const res = await fetch(srv.url + '/api/health/detailed');
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.ok(Array.isArray(d.models));
    assert.ok(Array.isArray(d.sessions));
    assert.equal(d.config.defaults.provider, 'openai');
  } finally { await srv.close(); }
});

// ====================================================================
// modelRoutes integration
// ====================================================================

function buildModelApp() {
  const PROVIDERS = {
    openai: { models: [{ name: 'gpt-4', tier: 'pro' }, { name: 'gpt-3.5-turbo', tier: 'free' }, { name: 'gpt-4-turbo', tier: 'pro' }], fallbackModel: 'gpt-3.5-turbo', modelAliases: {} }
  };
  const DEFAULTS = { provider: 'openai', model: 'gpt-4' };
  const getProviderConfig = (p) => PROVIDERS[p] || PROVIDERS[DEFAULTS.provider] || { models: [] };
  const app = express();
  app.use('/api/models', createModelRouter({ getProviderConfig, DEFAULTS }));
  return app;
}

test('GET /api/models returns sorted models (free first)', async () => {
  const app = buildModelApp();
  const srv = await withApp(app);
  try {
    const res = await fetch(srv.url + '/api/models');
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.equal(d.provider, 'openai');
    assert.equal(d.models[0].name, 'gpt-3.5-turbo');
    assert.equal(d.fallback, 'gpt-3.5-turbo');
  } finally { await srv.close(); }
});

test('GET /api/models/:provider returns provider models', async () => {
  const app = buildModelApp();
  const srv = await withApp(app);
  try {
    const res = await fetch(srv.url + '/api/models/openai');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).models.length, 3);
  } finally { await srv.close(); }
});

test('GET /api/models/:provider falls back to default for unknown provider', async () => {
  const app = buildModelApp();
  const srv = await withApp(app);
  try {
    const res = await fetch(srv.url + '/api/models/unknown');
    assert.equal(res.status, 200);
    // Falls back to default provider's models
    const d = await res.json();
    assert.ok(d.models.length > 0);
    assert.equal(d.models[0].name, 'gpt-3.5-turbo');
  } finally { await srv.close(); }
});

// ====================================================================
// configRoutes integration
// ====================================================================

function buildConfigApp() {
  const PROVIDERS = {
    openai: { baseUrl: null, fallbackModel: null, models: [{ name: 'gpt-4' }], modelAliases: {} },
    anthropic: { baseUrl: 'https://api.anthropic.com', fallbackModel: null, models: [{ name: 'claude-3' }], modelAliases: { 'fast': 'claude-3-haiku' } }
  };
  const app = express();
  app.use('/api', createConfigRouter({
    getToolDefinitions: () => [{ id: 'web_search', name: 'Web Search' }],
    PROVIDERS, DEFAULTS: { provider: 'openai', model: 'gpt-4' },
    VERSION: 'test'
  }));
  return app;
}

test('GET /api/tools returns tool definitions', async () => {
  const app = buildConfigApp();
  const srv = await withApp(app);
  try {
    const res = await fetch(srv.url + '/api/tools');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).tools[0].id, 'web_search');
  } finally { await srv.close(); }
});

test('GET /api/config returns server configuration', async () => {
  const app = buildConfigApp();
  const srv = await withApp(app);
  try {
    const res = await fetch(srv.url + '/api/config');
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.equal(d.version, 'test');
    assert.equal(d.defaults.provider, 'openai');
    assert.equal(d.providers.anthropic.baseUrl, 'https://api.anthropic.com');
    assert.equal(d.providers.anthropic.aliasCount, 1);
  } finally { await srv.close(); }
});
