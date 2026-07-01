import test from 'node:test';
import assert from 'node:assert/strict';
import { readFilesForAI } from '../src/client/lib/attachments.js';

function makeFile(name, text, type = 'text/plain') {
  return {
    name,
    size: text.length,
    type,
    async text() {
      return text;
    }
  };
}

test('readFilesForAI returns metadata and truncated content for UI-safe sending', async () => {
  const result = await readFilesForAI([
    makeFile('a.md', 'abcdef'),
    makeFile('b.txt', '123456')
  ], { maxCharsPerFile: 4, maxTotalChars: 10 });

  assert.deepEqual(result.fileMeta, [
    { name: 'a.md', size: 6, truncated: true },
    { name: 'b.txt', size: 6, truncated: true }
  ]);
  assert.match(result.content, /--- a.md ---\nabcd\n\[文件内容已截断/);
  assert.match(result.content, /--- b.txt ---\n1234\n\[文件内容已截断/);
});

test('readFilesForAI rejects non text-like files without reading binary content', async () => {
  const result = await readFilesForAI([
    makeFile('image.png', 'binary', 'image/png')
  ]);

  assert.equal(result.fileMeta[0].name, 'image.png');
  assert.match(result.content, /\[不支持直接读取此类型文件: image\/png\]/);
});
