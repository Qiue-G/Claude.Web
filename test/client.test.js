import test from 'node:test';
import assert from 'node:assert/strict';

// ====================================================================
// client/lib/utils.js tests
// ====================================================================

const utils = await import('../src/client/lib/utils.js');

test('escapeHtml escapes special HTML characters', () => {
  assert.equal(utils.escapeHtml('<script>alert("xss")</script>'),
    '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  assert.equal(utils.escapeHtml("it's & done"),
    'it&#039;s &amp; done');
  assert.equal(utils.escapeHtml(''), '');
  assert.equal(utils.escapeHtml(null), '');
  assert.equal(utils.escapeHtml('safe text'), 'safe text');
});

test('formatNumber formats large numbers with K/M suffixes', () => {
  assert.equal(utils.formatNumber(0), '0');
  assert.equal(utils.formatNumber(500), '500');
  assert.equal(utils.formatNumber(1500), '1.5K');
  assert.equal(utils.formatNumber(10000), '10.0K');
  assert.equal(utils.formatNumber(1000000), '1.0M');
  assert.equal(utils.formatNumber(2500000), '2.5M');
});

test('stripAnsi removes ANSI escape codes', () => {
  assert.equal(utils.stripAnsi('\x1b[31mRed\x1b[0m'), 'Red');
  assert.equal(utils.stripAnsi('\x1b[1mBold\x1b[22m'), 'Bold');
  assert.equal(utils.stripAnsi('Normal text'), 'Normal text');
  assert.equal(utils.stripAnsi('\x1b[?25lHidden'), 'Hidden');
  assert.equal(utils.stripAnsi('\x1b[2J\x1b[H'), '');
});

test('encodeFilePath encodes URI components', () => {
  assert.equal(utils.encodeFilePath('foo/bar.txt'), 'foo/bar.txt');
  assert.equal(utils.encodeFilePath('foo bar/baz.txt'), 'foo%20bar/baz.txt');
  assert.equal(utils.encodeFilePath('a/b/c'), 'a/b/c');
});

test('getFileExtension returns lowercase extension', () => {
  assert.equal(utils.getFileExtension('hello.txt'), 'txt');
  assert.equal(utils.getFileExtension('noext'), '');
  assert.equal(utils.getFileExtension('archive.tar.gz'), 'gz');
  assert.equal(utils.getFileExtension('Makefile'), '');
  assert.equal(utils.getFileExtension('IMAGE.PNG'), 'png');
  assert.equal(utils.getFileExtension('.hidden'), 'hidden');
});

test('formatFileSize returns human-readable sizes', () => {
  assert.equal(utils.formatFileSize(0), '0 B');
  assert.equal(utils.formatFileSize(500), '500 B');
  assert.equal(utils.formatFileSize(1024), '1.0 KB');
  assert.equal(utils.formatFileSize(1536), '1.5 KB');
  assert.equal(utils.formatFileSize(1048576), '1.0 MB');
});

test('generateId returns unique IDs', () => {
  const id1 = utils.generateId();
  const id2 = utils.generateId();
  assert.equal(typeof id1, 'string');
  assert.ok(id1.length > 0);
  assert.notEqual(id1, id2);
});

test('debounce delays function execution', async () => {
  let callCount = 0;
  const fn = utils.debounce(() => { callCount++; }, 50);

  fn();
  fn();
  fn();

  assert.equal(callCount, 0); // Should not have been called yet

  await new Promise(r => setTimeout(r, 100));
  assert.equal(callCount, 1); // Should have been called once
});

// ====================================================================
// client/stores/tools.store.js tests
// ====================================================================

const { get } = await import('svelte/store');
const toolsStore = await import('../src/client/stores/tools.store.js');

test('tools default toolStates has all built-in tools disabled', () => {
  const states = get(toolsStore.toolStates);
  assert.equal(states.web_search, false);
  assert.equal(states.code_interpreter, false);
  assert.equal(states.image_generation, false);
  assert.equal(states.file_analysis, false);
});

test('tools enabledTools derives from toolStates', () => {
  const enabled = get(toolsStore.enabledTools);
  assert.deepEqual(enabled, []);
});

test('tools setToolEnabled toggles a single tool', () => {
  toolsStore.setToolEnabled('web_search', true);
  assert.equal(get(toolsStore.toolStates).web_search, true);
  assert.equal(get(toolsStore.enabledTools).includes('web_search'), true);

  toolsStore.setToolEnabled('web_search', false);
  assert.equal(get(toolsStore.toolStates).web_search, false);
  assert.equal(get(toolsStore.enabledTools).length, 0);
});

test('tools setAvailableTools updates available tools and disables unconfigured', () => {
  toolsStore.resetTools();
  toolsStore.setToolEnabled('web_search', true);
  toolsStore.setToolEnabled('file_analysis', true);

  toolsStore.setAvailableTools([
    { id: 'web_search', configured: true },
    { id: 'code_interpreter', configured: true }
  ]);

  // file_analysis should be disabled since it's not in the new list
  assert.equal(get(toolsStore.toolStates).file_analysis, false);
  // web_search should remain enabled
  assert.equal(get(toolsStore.toolStates).web_search, true);
});

test('tools resetTools restores defaults', () => {
  toolsStore.setToolEnabled('web_search', true);
  toolsStore.setToolEnabled('code_interpreter', true);
  toolsStore.resetTools();

  const states = get(toolsStore.toolStates);
  assert.equal(states.web_search, false);
  assert.equal(states.code_interpreter, false);
  assert.equal(states.image_generation, false);
  assert.equal(states.file_analysis, false);
});

// ====================================================================
// client/stores/session.store.js tests (pure stores without localStorage)
// ====================================================================

const sessionStore = await import('../src/client/stores/session.store.js');

test('session store initializes with default values', () => {
  assert.equal(get(sessionStore.sessionId), null);
  assert.equal(get(sessionStore.sessionToken), null);
  assert.equal(get(sessionStore.csrfToken), null);
  assert.equal(get(sessionStore.isConnected), false);
  assert.equal(get(sessionStore.connectionStatus), 'disconnected');
});

test('session store writable values can be updated', () => {
  sessionStore.sessionId.set('test-sid');
  sessionStore.sessionToken.set('test-token');
  sessionStore.isConnected.set(true);
  sessionStore.connectionStatus.set('connected');

  assert.equal(get(sessionStore.sessionId), 'test-sid');
  assert.equal(get(sessionStore.sessionToken), 'test-token');
  assert.equal(get(sessionStore.isConnected), true);
  assert.equal(get(sessionStore.connectionStatus), 'connected');

  // Reset
  sessionStore.sessionId.set(null);
  sessionStore.sessionToken.set(null);
  sessionStore.isConnected.set(false);
  sessionStore.connectionStatus.set('disconnected');
});
