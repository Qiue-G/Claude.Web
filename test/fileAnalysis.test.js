import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFilesFromPromptContext, stripFileBlocksFromPrompt } from '../src/server/tools/fileAnalysis.js';

test('analyzeFilesFromPromptContext returns empty result for blank context', () => {
  const result = analyzeFilesFromPromptContext('');

  assert.equal(result.tool, 'file_analysis');
  assert.equal(result.ok, true);
  assert.equal(result.content, '');
  assert.deepEqual(result.files, []);
  assert.equal(result.metadata.totalFiles, 0);
});

test('analyzeFilesFromPromptContext extracts one text file block', () => {
  const result = analyzeFilesFromPromptContext('--- notes.md ---\nHello world\nSecond line');

  assert.equal(result.tool, 'file_analysis');
  assert.equal(result.ok, true);
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].name, 'notes.md');
  assert.equal(result.files[0].truncated, false);
  assert.match(result.content, /File: notes\.md/);
  assert.match(result.content, /Hello world/);
});

test('analyzeFilesFromPromptContext extracts multiple file blocks', () => {
  const context = [
    '--- a.md ---\nAlpha',
    '--- b.txt ---\nBeta'
  ].join('\n\n');
  const result = analyzeFilesFromPromptContext(context);

  assert.equal(result.files.length, 2);
  assert.equal(result.files[0].name, 'a.md');
  assert.equal(result.files[1].name, 'b.txt');
  assert.equal(result.metadata.totalFiles, 2);
  assert.match(result.content, /Alpha/);
  assert.match(result.content, /Beta/);
});

test('analyzeFilesFromPromptContext marks truncated files', () => {
  const result = analyzeFilesFromPromptContext('--- long.md ---\nabc\n[文件内容已截断，原始长度 99999 字符]');

  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].truncated, true);
  assert.match(result.content, /Truncated: true/);
});

test('analyzeFilesFromPromptContext preserves unsupported file messages', () => {
  const result = analyzeFilesFromPromptContext('--- image.png ---\n[不支持直接读取此类型文件: image/png]');

  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].name, 'image.png');
  assert.equal(result.files[0].unsupported, true);
  assert.match(result.content, /不支持直接读取此类型文件/);
});

test('stripFileBlocksFromPrompt keeps user text and removes attachment blocks', () => {
  const prompt = [
    '请总结这个文档',
    '',
    '--- notes.md ---',
    'Hello world',
    '',
    '--- data.txt ---',
    'Alpha'
  ].join('\n');

  const result = stripFileBlocksFromPrompt(prompt);

  assert.equal(result, '请总结这个文档');
});
