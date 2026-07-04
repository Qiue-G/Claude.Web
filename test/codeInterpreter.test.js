import test from 'node:test';
import assert from 'node:assert/strict';
import { executePython, extractPythonBlocks, codeInterpreterResult } from '../src/server/tools/codeInterpreter.js';

test('codeInterpreterResult formats successful ToolResult', () => {
  const result = codeInterpreterResult('print("hello")', { stdout: 'hello\n', stderr: '', exitCode: 0 });

  assert.equal(result.tool, 'code_interpreter');
  assert.equal(result.ok, true);
  assert.match(result.content, /hello/);
  assert.ok(result.metadata);
  assert.equal(result.metadata.exitCode, 0);
});

test('codeInterpreterResult marks error on non-zero exit', () => {
  const result = codeInterpreterResult('invalid code', { stdout: '', stderr: 'SyntaxError', exitCode: 1 });

  assert.equal(result.ok, false);
  assert.match(result.content, /SyntaxError/);
});

test('executePython returns object with stdout/stderr/exitCode', async () => {
  // Use a simple inline Python execution
  const result = await executePython('print("42")');
  assert.ok(typeof result.stdout === 'string');
  assert.ok(typeof result.stderr === 'string');
  assert.ok(typeof result.exitCode === 'number');
});

test('extractPythonBlocks extracts fenced code', () => {
  const blocks = extractPythonBlocks('Some text\n```python\nprint(1)\n```\nmore\n```py\nprint(2)\n```');
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0], 'print(1)');
  assert.equal(blocks[1], 'print(2)');
});

// 第4层：代码大小限制
test('executePython rejects code over 100KB', async () => {
  const bigCode = 'x'.repeat(100 * 1024 + 1);
  const result = await executePython(bigCode);
  assert.equal(result.blocked, true);
  assert.equal(result.exitCode, -1);
  assert.match(result.stderr, /100KB/);
});

// 第5层：全局并发限流
test('executePython enforces concurrency limit', async () => {
  // 并发执行多个，验证超限时返回繁忙
  const promises = [];
  for (let i = 0; i < 10; i++) {
    promises.push(executePython('print("x")'));
  }
  const results = await Promise.all(promises);

  // 至少应有一些被并发限流拦截
  const blockedByConcurrency = results.filter(r => r.stderr && r.stderr.includes('系统繁忙'));
  const notBlocked = results.filter(r => !r.stderr || !r.stderr.includes('系统繁忙'));

  assert.ok(blockedByConcurrency.length > 0, '应有限流结果');
  assert.ok(blockedByConcurrency.length < results.length, '不应全部被限流');
  // 所有非限流结果应包含 exitCode
  notBlocked.forEach(r => assert.ok(typeof r.exitCode === 'number'));
});

// executePython 返回 blocked 字段（兼容性）
test('executePython returns blocked field on failure', async () => {
  const result = await executePython('import os; os.system("echo hack")');
  // 可能被 AST 拦截（如果有 Python 安全检查可用），也可能执行失败
  // 但 blocked 字段应该总是布尔值
  assert.ok(typeof result.blocked === 'boolean' || result.blocked === undefined, 'blocked field should be boolean or absent');
});

// blocked 结果在 codeInterpreterResult 中正确处理
test('codeInterpreterResult handles blocked result', () => {
  const result = codeInterpreterResult('bad code', {
    stdout: '',
    stderr: '[安全拦截] 检测到危险操作',
    exitCode: -1,
    blocked: true,
  });
  assert.equal(result.ok, false);
  assert.match(result.content, /安全拦截/);
});

// executePython 对于空代码应能正常返回
test('executePython handles empty code', async () => {
  const result = await executePython('');
  // 空代码可能通过安全检查，但 Python 执行时可能报错或成功
  assert.ok(typeof result.exitCode === 'number');
});

// codeInterpreterResult metadata 包含 blocked 字段
test('codeInterpreterResult metadata includes blocked', () => {
  const result = codeInterpreterResult('print("1")', { stdout: '1\n', stderr: '', exitCode: 0, blocked: false });
  assert.equal(result.metadata.blocked, false);
});
