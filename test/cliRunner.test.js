/**
 * cliRunner 单元测试
 *
 * 覆盖：
 * 1. stripAnsi — ANSI 转义码去除
 * 2. maskSensitive — API Key 脱敏
 * 3. resolveOpenRouterModel — 模型名解析
 * 4. getFallbackModel — 回退模型获取
 * 5. modelStats — 模型统计
 * 6. GLOBAL_PROCESS_LIMIT / PROCESS_TIMEOUT — 常量
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  stripAnsi,
  maskSensitive,
  resolveOpenRouterModel,
  getFallbackModel,
  modelStats,
  GLOBAL_PROCESS_LIMIT,
  PROCESS_TIMEOUT
} = await import('../src/server/cliRunner.js');

// ====================================================================
// stripAnsi
// ====================================================================

test('stripAnsi removes ANSI color codes', () => {
  const input = '\x1b[32mHello\x1b[0m \x1b[1mWorld\x1b[22m';
  assert.equal(stripAnsi(input), 'Hello World');
});

test('stripAnsi handles plain text without ANSI codes', () => {
  assert.equal(stripAnsi('Hello World'), 'Hello World');
});

test('stripAnsi removes OSC sequences', () => {
  const input = '\x1b]0;Title\x07Hello';
  assert.equal(stripAnsi(input), 'Hello');
});

test('stripAnsi removes cursor movement sequences', () => {
  const input = 'Line1\x1b[5A\x1b[10C続き';
  assert.equal(stripAnsi(input), 'Line1続き');
});

test('stripAnsi handles empty string', () => {
  assert.equal(stripAnsi(''), '');
});

// ====================================================================
// maskSensitive
// ====================================================================

test('maskSensitive masks API key longer than 12 chars', () => {
  const apiKey = 'sk-12345678901234567890';
  const text = `Using key ${apiKey} for auth`;
  const result = maskSensitive(text, apiKey);
  assert.ok(result.includes('sk-12345'));
  assert.ok(result.includes('***'));
  assert.ok(!result.includes(apiKey));
});

test('maskSensitive masks short API key (middle part)', () => {
  const apiKey = 'short-key';
  const text = `Key: ${apiKey}`;
  const result = maskSensitive(text, apiKey);
  assert.ok(!result.includes(apiKey));
});

test('maskSensitive returns original text when no apiKey provided', () => {
  const text = 'Some sensitive output';
  assert.equal(maskSensitive(text, null), text);
  assert.equal(maskSensitive(text, undefined), text);
});

test('maskSensitive handles multiple occurrences of API key', () => {
  const apiKey = 'sk-multi-occurrence-key';
  const text = `${apiKey} at start and ${apiKey} at end`;
  const result = maskSensitive(text, apiKey);
  assert.ok(!result.includes(apiKey));
  assert.equal(result.split('***').length, 3); // 2 masked occurrences
});

// ====================================================================
// resolveOpenRouterModel
// ====================================================================

test('resolveOpenRouterModel resolves known alias', () => {
  const config = {
    providers: {
      openrouter: {
        modelAliases: {
          'gpt-4': 'openai/gpt-4-turbo'
        }
      }
    }
  };
  assert.equal(resolveOpenRouterModel('gpt-4', config), 'openai/gpt-4-turbo');
});

test('resolveOpenRouterModel returns original model if no alias', () => {
  assert.equal(resolveOpenRouterModel('unknown-model', {}), 'unknown-model');
});

test('resolveOpenRouterModel handles missing providers config', () => {
  assert.equal(resolveOpenRouterModel('any-model', {}), 'any-model');
});

// ====================================================================
// getFallbackModel
// ====================================================================

test('getFallbackModel returns fallback from provider config', () => {
  const config = {
    providers: {
      openrouter: {
        fallbackModel: 'openai/gpt-3.5-turbo'
      }
    }
  };
  assert.equal(getFallbackModel('openrouter', config), 'openai/gpt-3.5-turbo');
});

test('getFallbackModel returns null when no fallback configured', () => {
  assert.equal(getFallbackModel('openrouter', {}), null);
});

test('getFallbackModel returns null for unknown provider', () => {
  const config = { providers: { openrouter: { fallbackModel: 'gpt-4' } } };
  assert.equal(getFallbackModel('nonexistent', config), null);
});

// ====================================================================
// modelStats
// ====================================================================

test('modelStats records and retrieves model stats', () => {
  modelStats.recordSuccess('test-model-v1');
  modelStats.recordSuccess('test-model-v1');
  modelStats.recordFail('test-model-v1', 'timeout');

  const stats = modelStats.getAll();
  assert.ok(Array.isArray(stats));
  const entry = stats.find(s => s.id === 'test-model-v1');
  assert.ok(entry);
  assert.equal(entry.total, 3);
  assert.equal(entry.success, 2);
  assert.equal(entry.fail, 1);
  assert.ok(entry.successRate > 0);
});

// ====================================================================
// Constants
// ====================================================================

test('GLOBAL_PROCESS_LIMIT is a positive integer', () => {
  assert.ok(typeof GLOBAL_PROCESS_LIMIT === 'number');
  assert.ok(GLOBAL_PROCESS_LIMIT > 0);
});

test('PROCESS_TIMEOUT is a positive integer', () => {
  assert.ok(typeof PROCESS_TIMEOUT === 'number');
  assert.ok(PROCESS_TIMEOUT > 0);
});
