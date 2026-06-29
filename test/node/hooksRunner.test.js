import test from 'node:test';
import assert from 'node:assert/strict';
import { runHooks } from '../../src/server/runtime/hooksRunner.js';

const pluginsConfig = {
  'prompt-enhancer': {
    enabled: true,
    type: 'hook',
    hooks: {
      onUserPrompt: { instruction: '请用中文回答' },
      postToolUse: { matcher: 'web_search', instruction: '用中文总结' }
    }
  },
  'disabled-hook': {
    enabled: false,
    type: 'hook',
    hooks: {
      onUserPrompt: { instruction: '不应出现' }
    }
  }
};

test('hooksRunner: appends instruction to prompt on onUserPrompt', () => {
  const result = runHooks('onUserPrompt', { prompt: 'Hello' }, pluginsConfig);
  assert.equal(result.prompt, 'Hello\n请用中文回答');
});

test('hooksRunner: skips disabled plugins', () => {
  const result = runHooks('onUserPrompt', { prompt: 'Hi' }, pluginsConfig);
  assert.ok(!result.prompt.includes('不应出现'));
});

test('hooksRunner: returns unchanged context when no hooks match', () => {
  const ctx = { prompt: 'Hello' };
  const result = runHooks('onUserPrompt', ctx, {});
  assert.deepEqual(result, ctx);
});

test('hooksRunner: returns unchanged context when no plugins config', () => {
  const ctx = { prompt: 'Hello' };
  const result = runHooks('onUserPrompt', ctx, undefined);
  assert.deepEqual(result, ctx);
});

test('hooksRunner: matches tool name with glob on postToolUse', () => {
  const result = runHooks('postToolUse', {
    toolName: 'web_search',
    result: 'some results'
  }, pluginsConfig);
  assert.ok(result.result.includes('用中文总结'));
});

test('hooksRunner: skips non-matching tool on postToolUse', () => {
  const result = runHooks('postToolUse', {
    toolName: 'read_file',
    result: 'file content'
  }, pluginsConfig);
  assert.ok(!result.result.includes('用中文总结'));
});

test('hooksRunner: appends to existing result on postToolUse', () => {
  const result = runHooks('postToolUse', {
    toolName: 'web_search',
    result: '原始结果'
  }, pluginsConfig);
  assert.ok(result.result.includes('原始结果'));
  assert.ok(result.result.includes('用中文总结'));
});

test('hooksRunner: handles preToolUse phase', () => {
  const cfg = {
    'test-hook': {
      enabled: true,
      type: 'hook',
      hooks: {
        preToolUse: { matcher: '*', instruction: '请谨慎使用' }
      }
    }
  };
  const result = runHooks('preToolUse', {
    toolName: 'bash',
    arguments: { cmd: 'ls' }
  }, cfg);
  assert.equal(result.arguments._instruction, '请谨慎使用');
});
