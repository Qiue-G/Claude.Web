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
