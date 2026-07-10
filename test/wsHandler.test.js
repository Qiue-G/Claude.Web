import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { createWsHandler } from '../src/server/routes/wsHandler.js';
import { applyPreToolUseHook, getRagSearchCollection } from '../src/server/routes/wsHandlers/messageHandlers.js';

/** Helper: start a WS server on a random port, return { url, close } */
function withWsServer(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    const wss = new WebSocketServer({ server });
    wss.on('connection', handler);
    server.listen(0, () => {
      const port = server.address().port;
      resolve({
        url: 'ws://127.0.0.1:' + port,
        close: () => new Promise((r) => { wss.close(); server.close(() => r()); })
      });
    });
    server.on('error', reject);
  });
}

/** Helper: connect a WS client, return ws after open */
function connectClient(url, origin, token) {
  return new Promise((resolve, reject) => {
    const opts = origin ? { origin } : { origin: 'http://localhost:5173' };
    const wsUrl = token ? `${url}?token=${encodeURIComponent(token)}` : url;
    const ws = new WebSocket(wsUrl, opts);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('Connection timeout')), 3000);
  });
}

function makeMockDeps(overrides = {}) {
  const sessions = new Map();
  const sessionClients = new Map();

  // Minimal ReadableStream for callModelWithTools mock
  function makeMockReadableStream() {
    const encoder = new TextEncoder();
    let controller;
    const stream = new ReadableStream({
      start(c) { controller = c; },
      pull() {
        controller.enqueue(encoder.encode('data: {"type":"message_stop"}\n\n'));
        controller.close();
      }
    });
    return stream;
  }

  return {
    sessions,
    sessionClients,
    getSession: (sid, token) => sessions.get(sid) || null,
    sessionProcesses: new Map(),
    sessionProxies: new Map(),
    wsProcCount: new Map(),
    broadcastToSession: () => {},
    spawnCli: async () => ({
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (ev, cb) => { if (ev === 'close') setTimeout(() => cb(0), 10); },
      kill: () => {}
    }),
    callModelWithTools: async () => ({
      response: { body: makeMockReadableStream() },
      releaseProcessSlot: () => {}
    }),
    callModelWithMessages: async () => ({
      response: { body: makeMockReadableStream() },
      releaseProcessSlot: () => {}
    }),
    maskSensitive: (s) => s,
    stripAnsi: (s) => s,
    checkRateLimit: () => true,
    ALLOWED_ORIGINS: ['http://localhost:5173'],
    RATE_WINDOW: 60000,
    RATE_MAX_INPUT: 20,
    messageStore: null,
    mcpManager: null,
    db: {
      exec: () => [],
      run: () => {}
    },
    ...overrides
  };
}

function addSession(deps, id, overrides = {}) {
  deps.sessions.set(id, {
    id,
    currentModel: 'test-model',
    modelHealth: { status: 'ok' },
    apiKey: 'sk-test',
    token: 'valid-token',
    provider: 'openai',
    model: 'gpt-4',
    dir: process.cwd(),
    ...overrides
  });
}

// ====================================================================
// Test: origin validation — reject invalid origin
// ====================================================================

test('wsHandler rejects connection with invalid origin', async () => {
  const handler = createWsHandler(makeMockDeps());
  const { url, close } = await withWsServer(handler);

  try {
    const ws = await connectClient(url, 'http://evil.com', 'test-token');
    // Server should close the connection after sending error
    const closeCode = await new Promise((resolve) => {
      ws.on('close', (code) => resolve(code));
      setTimeout(() => resolve('timeout'), 2000);
    });
    assert.notEqual(closeCode, 'timeout', 'Connection should have been closed');
    ws.close();
  } finally {
    await close();
  }
});

// ====================================================================
// Test: reject invalid session
// ====================================================================

test('wsHandler rejects init with invalid session', async () => {
  const handler = createWsHandler(makeMockDeps());
  const { url, close } = await withWsServer(handler);

  try {
    const ws = await connectClient(url, 'http://localhost:5173', 'valid-token');
    ws.send(JSON.stringify({ type: 'init', sessionId: 'bad', token: 'bad' }));

    // Should receive error and close
    const msg = await new Promise((resolve) => ws.once('message', (d) => resolve(JSON.parse(d.toString()))));
    assert.equal(msg.type, 'error');

    const closeCode = await new Promise((resolve) => {
      ws.on('close', (code) => resolve(code));
      setTimeout(() => resolve('timeout'), 2000);
    });
    assert.notEqual(closeCode, 'timeout');
    ws.close();
  } finally {
    await close();
  }
});

// ====================================================================
// Test: valid session → ready
// ====================================================================

test('wsHandler init with valid session returns ready', async () => {
  const deps = makeMockDeps();
  addSession(deps, 'valid-session');
  const handler = createWsHandler(deps);
  const { url, close } = await withWsServer(handler);

  try {
    const ws = await connectClient(url, 'http://localhost:5173', 'valid-token');
    ws.send(JSON.stringify({ type: 'init', sessionId: 'valid-session', token: 'valid-token' }));

    const msg = await new Promise((resolve) => ws.once('message', (d) => resolve(JSON.parse(d.toString()))));
    assert.equal(msg.type, 'ready');
    assert.equal(msg.model, 'test-model');

    // Session client registered
    assert.ok(deps.sessionClients.has('valid-session'));
    ws.close();
  } finally {
    await close();
  }
});

// ====================================================================
// Test: valid session with messageStore → history
// ====================================================================

test('wsHandler init with messageStore returns history', async () => {
  const deps = makeMockDeps({
    messageStore: {
      loadMessages: async () => [
        { id: 'm1', role: 'user', content: 'Hello', timestamp: 1000, files: null },
        { id: 'm2', role: 'assistant', content: 'Hi!', timestamp: 1001, files: null }
      ],
      loadMessagesPaginated: async () => ({
        messages: [
          { id: 'm1', role: 'user', content: 'Hello', timestamp: 1000, files: null },
          { id: 'm2', role: 'assistant', content: 'Hi!', timestamp: 1001, files: null }
        ],
        page: 0, totalPages: 1, hasMore: false
      }),
      saveMessage: async () => {},
      deleteSessionMessages: async () => {}
    }
  });
  addSession(deps, 'history-session');
  const handler = createWsHandler(deps);
  const { url, close } = await withWsServer(handler);

  try {
    const ws = await connectClient(url, 'http://localhost:5173', 'valid-token');
    ws.send(JSON.stringify({ type: 'init', sessionId: 'history-session', token: 'valid-token' }));

    // Collect all messages (both ready and history)
    const messages = [];
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 500);
      ws.on('message', (d) => {
        messages.push(JSON.parse(d.toString()));
        if (messages.length >= 2) { clearTimeout(timer); resolve(); }
      });
    });

    const types = messages.map(m => m.type);
    assert.ok(types.includes('ready'));
    assert.ok(types.includes('history'));

    const history = messages.find(m => m.type === 'history');
    assert.equal(history.messages.length, 2);
    assert.equal(history.messages[0].content, 'Hello');
    ws.close();
  } finally {
    await close();
  }
});

// ====================================================================
// Test: load_more pagination
// ====================================================================

test('wsHandler handles load_more pagination', async () => {
  const deps = makeMockDeps({
    messageStore: {
      loadMessages: async () => [],
      loadMessagesPaginated: async (sid, page) => {
        if (page === 0) return { messages: Array.from({length: 20}, (_, i) => ({ id: `m${i}`, role: 'user', content: `Msg ${i}`, timestamp: 1000 + i, files: null })), page: 0, totalPages: 2, hasMore: true };
        return { messages: [{ id: 'm20', role: 'user', content: 'Old message', timestamp: 900, files: null }], page: 1, totalPages: 2, hasMore: false };
      },
      saveMessage: async () => {},
      deleteSessionMessages: async () => {}
    }
  });
  addSession(deps, 'page-session');
  const handler = createWsHandler(deps);
  const { url, close } = await withWsServer(handler);

  try {
    const ws = await connectClient(url, 'http://localhost:5173', 'valid-token');
    ws.send(JSON.stringify({ type: 'init', sessionId: 'page-session', token: 'valid-token' }));
    // Wait for history
    await new Promise((resolve) => {
      ws.once('message', (d) => { if (JSON.parse(d.toString()).type === 'ready') resolve(); });
    });

    ws.send(JSON.stringify({ type: 'load_more', page: 1 }));
    const msg = await new Promise((resolve) => ws.once('message', (d) => resolve(JSON.parse(d.toString()))));
    assert.equal(msg.type, 'history_page');
    assert.equal(msg.page, 1);
    assert.equal(msg.messages.length, 1);
    assert.equal(msg.messages[0].content, 'Old message');
    ws.close();
  } finally {
    await close();
  }
});

// ====================================================================
// Test: token validation on input
// ====================================================================

test('wsHandler validates token on input', async () => {
  const deps = makeMockDeps({
    messageStore: {
      loadMessages: async () => [],
      loadMessagesPaginated: async () => ({ messages: [], page: 0, totalPages: 1, hasMore: false }),
      saveMessage: async () => {},
      deleteSessionMessages: async () => {}
    }
  });
  addSession(deps, 'token-session');
  const handler = createWsHandler(deps);
  const { url, close } = await withWsServer(handler);

  try {
    const ws = await connectClient(url, 'http://localhost:5173', 'valid-token');
    ws.send(JSON.stringify({ type: 'init', sessionId: 'token-session', token: 'valid-token' }));
    await new Promise((resolve) => ws.once('message', (d) => resolve()));

    // Send input with wrong token
    ws.send(JSON.stringify({ type: 'input', data: { text: 'Hello' }, token: 'wrong-token' }));
    const msg = await new Promise((resolve) => ws.once('message', (d) => resolve(JSON.parse(d.toString()))));
    assert.equal(msg.type, 'error');
    assert.match(msg.message, /token mismatch/i);
    ws.close();
  } finally {
    await close();
  }
});

// ====================================================================
// Test: rate limiting on input
// ====================================================================

test('wsHandler rate limits excessive input', async () => {
  let callCount = 0;
  const deps = makeMockDeps({
    checkRateLimit: () => {
      callCount++;
      return false; // always rate-limited
    },
    messageStore: {
      loadMessages: async () => [],
      loadMessagesPaginated: async () => ({ messages: [], page: 0, totalPages: 1, hasMore: false }),
      saveMessage: async () => {},
      deleteSessionMessages: async () => {}
    }
  });
  addSession(deps, 'rate-session', { currentModel: 'rate-model' });
  const handler = createWsHandler(deps);
  const { url, close } = await withWsServer(handler);

  try {
    const ws = await connectClient(url, 'http://localhost:5173', 'valid-token');
    ws.send(JSON.stringify({ type: 'init', sessionId: 'rate-session', token: 'valid-token' }));
    await new Promise((resolve) => ws.once('message', (d) => resolve()));

    // This input should be rate-limited
    ws.send(JSON.stringify({ type: 'input', data: { text: 'Hello' } }));
    const msg = await new Promise((resolve) => ws.once('message', (d) => resolve(JSON.parse(d.toString()))));
    assert.equal(msg.type, 'error');
    assert.match(msg.message, /Too many/i);
    ws.close();
  } finally {
    await close();
  }
});

test('getRagSearchCollection returns the active session id only', () => {
  assert.equal(getRagSearchCollection({ id: 'rag-session' }), 'rag-session');
  assert.throws(() => getRagSearchCollection(null), /Invalid session/);
});

test('wsHandler uses the active session id for automatic RAG search collection', async () => {
  let approvalId;
  const ragCalls = [];
  const deps = makeMockDeps({
    rag: {
      search: async (collection, query, options) => {
        ragCalls.push({ collection, query, options });
        return [];
      }
    },
    broadcastToSession: (sid, payload) => {
      if (payload.type === 'tool_approval_request') approvalId = payload.approvalId;
    },
    messageStore: {
      loadMessages: async () => [],
      loadMessagesPaginated: async () => ({ messages: [], page: 0, totalPages: 1, hasMore: false }),
      saveMessage: async () => {},
      deleteSessionMessages: async () => {}
    }
  });
  addSession(deps, 'rag-session');
  const handler = createWsHandler(deps);
  const { url, close } = await withWsServer(handler);

  try {
    const ws = await connectClient(url, 'http://localhost:5173', 'valid-token');
    ws.send(JSON.stringify({ type: 'init', sessionId: 'rag-session', token: 'valid-token' }));
    await new Promise((resolve) => ws.once('message', () => resolve()));

    ws.send(JSON.stringify({ type: 'input', data: { text: 'find docs', tools: ['rag_search'] } }));
    await new Promise((resolve) => {
      const timer = setInterval(() => {
        if (approvalId) {
          clearInterval(timer);
          resolve();
        }
      }, 5);
    });
    ws.send(JSON.stringify({ type: 'tool_approval_response', approvalId, approved: true }));

    await new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (ragCalls.length > 0) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - started > 1000) {
          clearInterval(timer);
          reject(new Error('RAG search was not called'));
        }
      }, 10);
    });

    assert.equal(ragCalls[0].collection, 'rag-session');
    ws.close();
  } finally {
    await close();
  }
});

test('applyPreToolUseHook adds hook instruction to tool arguments', () => {
  const pluginsConfig = {
    'tool-guard': {
      enabled: true,
      type: 'hook',
      hooks: {
        preToolUse: { matcher: 'mcp_demo_search', instruction: 'hook instruction' }
      }
    }
  };

  const result = applyPreToolUseHook('mcp_demo_search', { query: 'search this' }, pluginsConfig);

  assert.equal(result.query, 'search this');
  assert.equal(result._instruction, 'hook instruction');
});
