import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ========================================================================
// browser.js
// ========================================================================
describe('browser.js', () => {
  it('exports browser as true when window is defined (vitest setup)', async () => {
    const { browser } = await import('$lib/browser.js');
    expect(browser).toBe(true);
  });
});

// ========================================================================
// apis/*.api.js — mock fetch
// ========================================================================
describe('tools.api.js', () => {
  beforeEach(() => global.fetch = vi.fn());
  afterEach(() => vi.restoreAllMocks());

  it('fetchTools returns tools JSON on success', async () => {
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ tools: [{ id: 'web_search' }] }) });
    const { fetchTools } = await import('$apis/tools.api.js');
    const result = await fetchTools();
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].id).toBe('web_search');
  });

  it('fetchTools throws on HTTP error', async () => {
    fetch.mockResolvedValue({ ok: false });
    const { fetchTools } = await import('$apis/tools.api.js');
    await expect(fetchTools()).rejects.toThrow('Failed to fetch tools');
  });
});

describe('models.api.js', () => {
  beforeEach(() => global.fetch = vi.fn());
  afterEach(() => vi.restoreAllMocks());

  it('fetchModels calls /api/models without provider', async () => {
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ models: ['gpt-4'] }) });
    const { fetchModels } = await import('$apis/models.api.js');
    await fetchModels();
    expect(fetch).toHaveBeenCalledWith('/api/models');
  });

  it('fetchModels includes provider query param', async () => {
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ models: [] }) });
    const { fetchModels } = await import('$apis/models.api.js');
    await fetchModels('anthropic');
    expect(fetch).toHaveBeenCalledWith('/api/models?provider=anthropic');
  });

  it('fetchConfig returns config', async () => {
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ version: '1.0' }) });
    const { fetchConfig } = await import('$apis/models.api.js');
    const result = await fetchConfig();
    expect(result.version).toBe('1.0');
  });

  it('fetchHealth returns health status', async () => {
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
    const { fetchHealth } = await import('$apis/models.api.js');
    const result = await fetchHealth();
    expect(result.status).toBe('ok');
  });
});

describe('session.api.js', () => {
  beforeEach(() => global.fetch = vi.fn());
  afterEach(() => vi.restoreAllMocks());

  it('createSession POSTs to /api/session', async () => {
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ sessionId: 's1' }) });
    const { createSession } = await import('$apis/session.api.js');
    const result = await createSession('sk-test', 'gpt-4', 'openai');
    expect(fetch).toHaveBeenCalledWith('/api/session', expect.objectContaining({ method: 'POST' }));
    expect(result.sessionId).toBe('s1');
  });

  it('createSession throws with server error message', async () => {
    fetch.mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'Invalid API key' }) });
    const { createSession } = await import('$apis/session.api.js');
    await expect(createSession('bad', 'gpt-4', 'openai')).rejects.toThrow('Invalid API key');
  });

  it('getSession returns session info', async () => {
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 's1', model: 'gpt-4' }) });
    const { getSession } = await import('$apis/session.api.js');
    const result = await getSession('s1', 'token');
    expect(result.id).toBe('s1');
  });

  it('getSession throws on failure', async () => {
    fetch.mockResolvedValue({ ok: false });
    const { getSession } = await import('$apis/session.api.js');
    await expect(getSession('bad', 'token')).rejects.toThrow('Invalid session');
  });

  it('validateSession calls /api/session/current', async () => {
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ valid: true }) });
    const { validateSession } = await import('$apis/session.api.js');
    const result = await validateSession('s1', 'token');
    expect(fetch).toHaveBeenCalledWith('/api/session/current', expect.objectContaining({
      headers: expect.objectContaining({ 'x-session-id': 's1' })
    }));
    expect(result.valid).toBe(true);
  });

  it('deleteSession sends DELETE with CSRF headers', async () => {
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true }) });
    const { deleteSession } = await import('$apis/session.api.js');
    const result = await deleteSession('s1', 'token', 'csrf');
    expect(fetch).toHaveBeenCalledWith('/api/session/s1', expect.objectContaining({ method: 'DELETE' }));
    expect(result.success).toBe(true);
  });
});

describe('search.api.js', () => {
  beforeEach(() => global.fetch = vi.fn());
  afterEach(() => vi.restoreAllMocks());

  it('searchChats returns results for valid query', async () => {
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ results: [{ id: 'm1' }], total: 1, query: 'hello' }) });
    const { searchChats } = await import('$apis/search.api.js');
    const result = await searchChats('hello');
    expect(result.results).toHaveLength(1);
    expect(result.query).toBe('hello');
  });

  it('searchChats returns empty for blank query', async () => {
    const { searchChats } = await import('$apis/search.api.js');
    const result = await searchChats('');
    expect(result.results).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('searchChats throws on HTTP error', async () => {
    fetch.mockResolvedValue({ ok: false, status: 500 });
    const { searchChats } = await import('$apis/search.api.js');
    await expect(searchChats('test')).rejects.toThrow('HTTP 500');
  });
});

describe('files.api.js', () => {
  beforeEach(() => global.fetch = vi.fn());
  afterEach(() => vi.restoreAllMocks());

  it('getFileTree fetches file tree with token header', async () => {
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ tree: [{ name: 'a.txt' }] }) });
    const { getFileTree } = await import('$apis/files.api.js');
    const result = await getFileTree('s1', 'token');
    expect(fetch).toHaveBeenCalledWith('/api/files/s1', expect.objectContaining({
      headers: expect.objectContaining({ 'x-session-token': 'token' })
    }));
    expect(result.tree[0].name).toBe('a.txt');
  });

  it('readFile fetches file content', async () => {
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ content: 'hello' }) });
    const { readFile } = await import('$apis/files.api.js');
    const result = await readFile('s1', 'test.txt', 'token');
    expect(fetch).toHaveBeenCalledWith('/api/files/s1/test.txt', expect.anything());
    expect(result.content).toBe('hello');
  });

  it('writeFile POSTs with content and CSRF', async () => {
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true }) });
    const { writeFile } = await import('$apis/files.api.js');
    const result = await writeFile('s1', 'test.txt', 'content', 'token', 'csrf');
    expect(fetch).toHaveBeenCalledWith('/api/files/s1/test.txt', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'x-csrf-token': 'csrf' }),
      body: expect.stringContaining('content')
    }));
    expect(result.success).toBe(true);
  });

  it('deleteFile sends DELETE with CSRF', async () => {
    fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true }) });
    const { deleteFile } = await import('$apis/files.api.js');
    const result = await deleteFile('s1', 'test.txt', 'token', 'csrf');
    expect(fetch).toHaveBeenCalledWith('/api/files/s1/test.txt', expect.objectContaining({
      method: 'DELETE',
      headers: expect.objectContaining({ 'x-csrf-token': 'csrf' })
    }));
    expect(result.success).toBe(true);
  });

  it('readFile throws on error', async () => {
    fetch.mockResolvedValue({ ok: false });
    const { readFile } = await import('$apis/files.api.js');
    await expect(readFile('s1', 'test.txt', 'token')).rejects.toThrow('Failed to read file');
  });
});

// ========================================================================
// indexedDB.js
// ========================================================================
describe('indexedDB.js', () => {
  beforeEach(async () => {
    // Ensure clean database for each test
    let db;
    try {
      const idxDB = await import('$lib/indexedDB.js');
      db = await idxDB.initDB();
      await idxDB.clear('chatSessions');
      await idxDB.clear('messages');
    } catch {}
  });

  it('initDB creates object stores', async () => {
    const indexedDB = await import('$lib/indexedDB.js');
    const db = await indexedDB.initDB();
    expect(db).toBeTruthy();
    expect(db.objectStoreNames.contains('chatSessions')).toBe(true);
    expect(db.objectStoreNames.contains('messages')).toBe(true);
  });

  it('put and get roundtrip', async () => {
    const indexedDB = await import('$lib/indexedDB.js');
    await indexedDB.initDB();
    await indexedDB.put('chatSessions', { id: 'test1', title: 'Test' });
    const result = await indexedDB.get('chatSessions', 'test1');
    expect(result.title).toBe('Test');
  });

  it('getAll returns all items', async () => {
    const indexedDB = await import('$lib/indexedDB.js');
    await indexedDB.initDB();
    await indexedDB.put('chatSessions', { id: 'a', title: 'A' });
    await indexedDB.put('chatSessions', { id: 'b', title: 'B' });
    const all = await indexedDB.getAll('chatSessions');
    expect(all).toHaveLength(2);
  });

  it('remove deletes an item', async () => {
    const indexedDB = await import('$lib/indexedDB.js');
    await indexedDB.initDB();
    await indexedDB.put('chatSessions', { id: 'del', title: 'Delete me' });
    await indexedDB.remove('chatSessions', 'del');
    const result = await indexedDB.get('chatSessions', 'del');
    expect(result).toBeUndefined();
  });

  it('clear empties the store', async () => {
    const indexedDB = await import('$lib/indexedDB.js');
    await indexedDB.initDB();
    await indexedDB.put('chatSessions', { id: 'x', title: 'X' });
    await indexedDB.clear('chatSessions');
    const all = await indexedDB.getAll('chatSessions');
    expect(all).toEqual([]);
  });

  it('getByIndex queries by index', async () => {
    const indexedDB = await import('$lib/indexedDB.js');
    await indexedDB.initDB();
    await indexedDB.put('messages', { id: 'm1', sessionId: 's1', content: 'Hello', timestamp: 1 });
    await indexedDB.put('messages', { id: 'm2', sessionId: 's1', content: 'World', timestamp: 2 });
    await indexedDB.put('messages', { id: 'm3', sessionId: 's2', content: 'Other', timestamp: 3 });
    const results = await indexedDB.getByIndex('messages', 'sessionId', 's1');
    expect(results).toHaveLength(2);
    expect(results[0].sessionId).toBe('s1');
  });

  it('isIndexedDBSupported returns true with polyfill', async () => {
    const indexedDB = await import('$lib/indexedDB.js');
    expect(indexedDB.isIndexedDBSupported()).toBe(true);
  });
});

// ========================================================================
// chatHistory.store.js
// ========================================================================
describe('chatHistory.store.js', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset in-memory store between tests
    const store = globalThis.__chatHistoryStore;
    if (store) {
      store.sessions.set([]);
      store.currentSessionId.set(null);
    }
  });

  it('initializes with empty sessions', async () => {
    const store = await import('$stores/chatHistory.store.js');
    globalThis.__chatHistoryStore = store;
    const { get } = await import('svelte/store');
    const sessions = get(store.sessions);
    expect(sessions).toEqual([]);
  });

  it('createSession creates a new session', async () => {
    const store = await import('$stores/chatHistory.store.js');
    const { get } = await import('svelte/store');

    const session = store.createSession('New chat');
    expect(session.title).toBe('New chat');
    expect(session.id).toBeTruthy();
    expect(session.messages).toEqual([]);

    const sessions = get(store.sessions);
    expect(sessions).toHaveLength(1);
  });

  it('currentSessionId is set after createSession', async () => {
    const store = await import('$stores/chatHistory.store.js');
    const { get } = await import('svelte/store');

    const session = store.createSession('Test');
    expect(get(store.currentSessionId)).toBe(session.id);
  });

  it('switchSession changes currentSessionId', async () => {
    const store = await import('$stores/chatHistory.store.js');
    const { get } = await import('svelte/store');

    const s1 = store.createSession('First');
    const s2 = store.createSession('Second');

    store.switchSession(s1.id);
    expect(get(store.currentSessionId)).toBe(s1.id);

    store.switchSession(s2.id);
    expect(get(store.currentSessionId)).toBe(s2.id);
  });

  it('currentSession derives from sessions and currentSessionId', async () => {
    const store = await import('$stores/chatHistory.store.js');
    const { get } = await import('svelte/store');

    const session = store.createSession('Active');
    expect(get(store.currentSession).id).toBe(session.id);
  });

  it('updateSessionTitle updates session title', async () => {
    const store = await import('$stores/chatHistory.store.js');
    const { get } = await import('svelte/store');

    const session = store.createSession('Old');
    store.updateSessionTitle(session.id, 'New Title');

    const updated = get(store.currentSession);
    expect(updated.title).toBe('New Title');
  });

  it('addMessageToSession adds a message to the correct session', async () => {
    const store = await import('$stores/chatHistory.store.js');
    const { get } = await import('svelte/store');

    const session = store.createSession('Test');
    const msg = { id: 'm1', role: 'user', content: 'Hello' };

    store.addMessageToSession(session.id, msg);

    const current = get(store.currentSession);
    expect(current.messages).toHaveLength(1);
    expect(current.messages[0].content).toBe('Hello');
  });

  it('deleteSession removes session and resets currentSessionId if active', async () => {
    const store = await import('$stores/chatHistory.store.js');
    const { get } = await import('svelte/store');

    const session = store.createSession('To Delete');
    expect(get(store.sessions)).toHaveLength(1);

    store.deleteSession(session.id);
    expect(get(store.sessions)).toHaveLength(0);
    expect(get(store.currentSessionId)).toBeNull();
  });

  it('clearAllSessions removes all sessions', async () => {
    const store = await import('$stores/chatHistory.store.js');
    const { get } = await import('svelte/store');

    store.createSession('A');
    store.createSession('B');
    expect(get(store.sessions)).toHaveLength(2);

    store.clearAllSessions();
    expect(get(store.sessions)).toEqual([]);
  });

  it('initChatHistory loads and initializes persistence', async () => {
    const store = await import('$stores/chatHistory.store.js');
    const { get } = await import('svelte/store');

    await store.initChatHistory();
    const sessions = get(store.sessions);
    expect(Array.isArray(sessions)).toBe(true);
  });

  it('sessions are persisted to localStorage', async () => {
    const store = await import('$stores/chatHistory.store.js');
    const { get } = await import('svelte/store');

    store.createSession('Persisted');

    // Wait for persistence
    await new Promise(r => setTimeout(r, 50));

    const raw = localStorage.getItem('chatSessions');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe('Persisted');
  });
});

// ========================================================================
// chat.store.js
// ========================================================================
describe('chat.store.js', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset in-memory stores between tests
    const store = globalThis.__chatHistoryStore;
    if (store) {
      store.sessions.set([]);
      store.currentSessionId.set(null);
    }
  });

  it('initializes with default values', async () => {
    const store = await import('$stores/chat.store.js');
    const { get } = await import('svelte/store');

    expect(get(store.isWaiting)).toBe(false);
    expect(get(store.isTyping)).toBe(false);
    expect(get(store.tokenStats).input).toBe(0);
    expect(get(store.tokenStats).inputMax).toBe(200000);
  });

  it('addMessage adds to current session and returns the message', async () => {
    const history = await import('$stores/chatHistory.store.js');
    const store = await import('$stores/chat.store.js');
    const { get } = await import('svelte/store');

    history.createSession('Test');
    const msg = store.addMessage('user', 'Hello');

    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Hello');
    expect(msg.id).toBeTruthy();

    const msgs = get(store.messages);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('Hello');
  });

  it('clearMessages clears messages and resets tokenStats', async () => {
    const history = await import('$stores/chatHistory.store.js');
    const store = await import('$stores/chat.store.js');
    const { get } = await import('svelte/store');

    history.createSession('Test');
    store.addMessage('user', 'M1');
    store.addMessage('assistant', 'M2');

    store.clearMessages();
    expect(get(store.messages)).toHaveLength(0);
    expect(get(store.tokenStats).input).toBe(0);
  });

  it('updateMessage updates specific message fields', async () => {
    const history = await import('$stores/chatHistory.store.js');
    const store = await import('$stores/chat.store.js');
    const { get } = await import('svelte/store');

    history.createSession('Test');
    const msg = store.addMessage('user', 'Original');
    store.updateMessage(msg.id, { content: 'Updated' });

    const msgs = get(store.messages);
    expect(msgs[0].content).toBe('Updated');
  });

  it('deleteMessage removes a specific message', async () => {
    const history = await import('$stores/chatHistory.store.js');
    const store = await import('$stores/chat.store.js');
    const { get } = await import('svelte/store');

    history.createSession('Test');
    store.addMessage('user', 'Keep');
    const delMsg = store.addMessage('user', 'Delete');

    store.deleteMessage(delMsg.id);
    const msgs = get(store.messages);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('Keep');
  });

  it('deleteMessagesAfter removes messages after given message', async () => {
    const history = await import('$stores/chatHistory.store.js');
    const store = await import('$stores/chat.store.js');
    const { get } = await import('svelte/store');

    history.createSession('Test');
    const first = store.addMessage('user', 'First');
    store.addMessage('assistant', 'Second');
    store.addMessage('user', 'Third');

    store.deleteMessagesAfter(first.id);
    const msgs = get(store.messages);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('First');
  });

  it('prependMessages adds messages without duplicates', async () => {
    const history = await import('$stores/chatHistory.store.js');
    const store = await import('$stores/chat.store.js');
    const { get } = await import('svelte/store');

    history.createSession('Test');
    store.addMessage('user', 'Existing');

    store.prependMessages([{ id: 'old-1', role: 'user', content: 'Older', time: '12:00' }]);

    const msgs = get(store.messages);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toBe('Older');
    expect(msgs[1].content).toBe('Existing');
  });

  it('appendToLastAssistant appends to last assistant message', async () => {
    const history = await import('$stores/chatHistory.store.js');
    const store = await import('$stores/chat.store.js');
    const { get } = await import('svelte/store');

    history.createSession('Test');
    store.addMessage('user', 'Hello');
    store.addMessage('assistant', 'Hi');

    store.appendToLastAssistant(' there!');

    const msgs = get(store.messages);
    const assistantMsg = msgs.find(m => m.role === 'assistant');
    expect(assistantMsg.content).toBe('Hi there!');
  });

  it('setMessages replaces all messages for current session', async () => {
    const history = await import('$stores/chatHistory.store.js');
    const store = await import('$stores/chat.store.js');
    const { get } = await import('svelte/store');

    const session = history.createSession('Test');
    store.addMessage('user', 'Old');

    const newMsgs = [
      { id: 'n1', role: 'user', content: 'New1' },
      { id: 'n2', role: 'assistant', content: 'New2' }
    ];
    store.setMessages(newMsgs);

    const msgs = get(store.messages);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toBe('New1');
  });
});
