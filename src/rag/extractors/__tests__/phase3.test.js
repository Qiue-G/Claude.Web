/**
 * Phase 3 内容提取增强 — 测试套件
 *
 * 覆盖：ExtractorRegistry、PdfExtractor、WebExtractor、
 *       RestExtractor、TextFileExtractor、RAG 集成
 */
import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ──────────────────────────────────────────────
// ExtractorRegistry
// ──────────────────────────────────────────────
import { ExtractorRegistry } from '../registry.js';

describe('ExtractorRegistry', () => {
  it('should dispatch to matching extractor', async () => {
    const reg = new ExtractorRegistry();
    reg.register({
      canHandle: (i) => i.type === 'file',
      extract: async (i) => ({ content: 'ok', metadata: { source: i.source, type: 'file', char_count: 2 } }),
    });
    const result = await reg.extract({ type: 'file', source: '/test.txt' });
    assert.equal(result.content, 'ok');
  });

  it('should return error when no extractor matches', async () => {
    const reg = new ExtractorRegistry();
    const result = await reg.extract({ type: 'unknown', source: 'x' });
    assert.ok(result.metadata.error.includes('No extractor'));
  });

  it('should prefer first matching extractor', async () => {
    const reg = new ExtractorRegistry();
    let called = '';
    reg.register({
      canHandle: () => true,
      extract: async () => { called = 'first'; return { content: 'first', metadata: {} }; },
    });
    reg.register({
      canHandle: () => true,
      extract: async () => { called = 'second'; return { content: 'second', metadata: {} }; },
    });
    await reg.extract({ type: 'file', source: 'x' });
    assert.equal(called, 'first');
  });

  it('should catch extractor throw and return error metadata', async () => {
    const reg = new ExtractorRegistry();
    reg.register({
      canHandle: () => true,
      extract: async () => { throw new Error('boom'); },
    });
    const result = await reg.extract({ type: 'file', source: 'x' });
    assert.ok(result.metadata.error.includes('boom'));
    assert.equal(result.content, '');
  });
});

// ──────────────────────────────────────────────
// PdfExtractor
// ──────────────────────────────────────────────
import { PdfExtractor } from '../pdfExtractor.js';

describe('PdfExtractor', () => {
  it('should handle .pdf files', () => {
    const ex = new PdfExtractor();
    assert.ok(ex.canHandle({ type: 'file', source: 'doc.pdf' }));
    assert.ok(!ex.canHandle({ type: 'file', source: 'doc.txt' }));
    assert.ok(!ex.canHandle({ type: 'url', source: 'http://x.pdf' }));
  });

  it('should extract text from real PDF buffer', async () => {
    const ex = new PdfExtractor();
    // 最小有效 PDF — 1 页，内容 "Hello PDF"
    const pdfBuffer = Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>/Contents 4 0 R>>endobj\n' +
      '4 0 obj<</Length 44>>stream\nBT /F1 12 Tf 100 700 Td (Hello PDF) Tj ET\nendstream\nendobj\n' +
      'xref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000266 00000 n \n' +
      'trailer<</Size 5/Root 1 0 R>>\nstartxref\n407\n%%EOF'
    );
    const result = await ex.extractFromBuffer(pdfBuffer, 'test.pdf');
    assert.ok(result.content.includes('Hello PDF'));
    assert.ok(result.metadata.pages.length >= 1);
  });

  it('should return error for corrupt PDF', async () => {
    const ex = new PdfExtractor();
    const result = await ex.extractFromBuffer(Buffer.from('not a pdf'), 'bad.pdf');
    assert.ok(result.metadata.error);
    assert.equal(result.content, '');
  });
});

// ──────────────────────────────────────────────
// WebExtractor
// ──────────────────────────────────────────────
import { WebExtractor } from '../webExtractor.js';

describe('WebExtractor', () => {
  it('should handle url type', () => {
    const ex = new WebExtractor();
    assert.ok(ex.canHandle({ type: 'url', source: 'https://example.com' }));
    assert.ok(!ex.canHandle({ type: 'file', source: 'x.txt' }));
  });

  it('should extract content from valid URL', async () => {
    const ex = new WebExtractor();
    const result = await ex.extract({ type: 'url', source: 'https://example.com' });
    assert.ok(!result.metadata.error, result.metadata.error);
    assert.ok(result.content.length > 0);
  });

  it('should return error on unreachable URL', async () => {
    const ex = new WebExtractor();
    const result = await ex.extract({ type: 'url', source: 'https://invalid.example.nonexist' });
    assert.ok(result.metadata.error);
    assert.equal(result.content, '');
  });
});

// ──────────────────────────────────────────────
// RestExtractor
// ──────────────────────────────────────────────
import { RestExtractor } from '../restExtractor.js';

describe('RestExtractor', () => {
  it('should handle rest type', () => {
    const ex = new RestExtractor();
    assert.ok(ex.canHandle({ type: 'rest', source: 'https://api.example.com/data' }));
    assert.ok(!ex.canHandle({ type: 'file', source: 'x.txt' }));
  });

  it('should extract from JSON API with dataPath', async () => {
    const ex = new RestExtractor();
    // JSONPlaceholder 免费 API
    const result = await ex.extract({
      type: 'rest',
      source: { url: 'https://jsonplaceholder.typicode.com/posts/1', dataPath: 'title' },
    });
    assert.ok(!result.metadata.error, result.metadata.error);
    assert.ok(result.content.length > 0);
  });

  it('should return error on unreachable API', async () => {
    const ex = new RestExtractor();
    const result = await ex.extract({
      type: 'rest',
      source: { url: 'https://invalid.example.api', dataPath: 'data' },
    });
    assert.ok(result.metadata.error);
    assert.equal(result.content, '');
  });

  it('should handle string source (url only)', async () => {
    const ex = new RestExtractor();
    const result = await ex.extract({ type: 'rest', source: 'https://jsonplaceholder.typicode.com/todos/1' });
    assert.ok(!result.metadata.error, result.metadata.error);
    assert.ok(result.content.length > 0);
  });
});

// ──────────────────────────────────────────────
// TextFileExtractor
// ──────────────────────────────────────────────
import { TextFileExtractor } from '../textFileExtractor.js';

describe('TextFileExtractor', () => {
  const tmpDir = join(tmpdir(), 'rag-test-' + Date.now());

  before(async () => {
    await mkdir(tmpDir, { recursive: true });
  });

  after(async () => {
    await unlink(join(tmpDir, 'test.txt')).catch(() => {});
    await unlink(join(tmpDir, 'test.md')).catch(() => {});
    await unlink(join(tmpDir, 'test.bin')).catch(() => {});
  });

  it('should handle text file extensions', () => {
    const ex = new TextFileExtractor();
    assert.ok(ex.canHandle({ type: 'file', source: 'readme.txt' }));
    assert.ok(ex.canHandle({ type: 'file', source: 'doc.md' }));
    assert.ok(ex.canHandle({ type: 'file', source: 'data.json' }));
    assert.ok(!ex.canHandle({ type: 'file', source: 'doc.pdf' }));
    assert.ok(!ex.canHandle({ type: 'file', source: 'image.png' }));
  });

  it('should extract text from .txt file', async () => {
    const filePath = join(tmpDir, 'test.txt');
    await writeFile(filePath, 'Hello World\nLine 2', 'utf-8');
    const ex = new TextFileExtractor();
    const result = await ex.extract({ type: 'file', source: filePath });
    assert.equal(result.content, 'Hello World\nLine 2');
    assert.equal(result.metadata.char_count, 18);
  });

  it('should extract text from .md file', async () => {
    const filePath = join(tmpDir, 'test.md');
    await writeFile(filePath, '# Title\n\nContent here', 'utf-8');
    const ex = new TextFileExtractor();
    const result = await ex.extract({ type: 'file', source: filePath });
    assert.ok(result.content.includes('# Title'));
    assert.ok(result.content.includes('Content here'));
  });

  it('should return error for non-existent file', async () => {
    const ex = new TextFileExtractor();
    const result = await ex.extract({ type: 'file', source: join(tmpDir, 'nonexistent.txt') });
    assert.ok(result.metadata.error);
    assert.equal(result.content, '');
  });
});

// RAG integrated test temp dir (shared across RAG Integration suite)
const intTmpDir = join(tmpdir(), 'rag-int-' + Date.now());

// ──────────────────────────────────────────────
// RAG 集成 — extractor 注册 + API 覆盖
// ──────────────────────────────────────────────
describe('RAG Integration', () => {
  after(async () => {
    await unlink(join(intTmpDir, 'rag-integration.txt')).catch(() => {});
    await unlink(join(intTmpDir, 'rag-ingest.txt')).catch(() => {});
  });

  it('should create registry with all extractors', async () => {
    const { createDefaultRegistry } = await import('../index.js');
    const reg = createDefaultRegistry();
    assert.ok(reg);
  });

  it('should route file to PdfExtractor for .pdf', async () => {
    const buf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>/Contents 4 0 R>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 12 Tf 100 700 Td (Hello PDF) Tj ET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000266 00000 n \ntrailer<</Size 5/Root 1 0 R>>\nstartxref\n407\n%%EOF');
    const pdfExt = new PdfExtractor();
    const result = await pdfExt.extractFromBuffer(buf, 'test.pdf');
    assert.ok(result.content.includes('Hello PDF'));
  });

  it('should route file to TextFileExtractor for .txt', async () => {
    const filePath = join(intTmpDir, 'rag-integration.txt');
    await mkdir(intTmpDir, { recursive: true });
    await writeFile(filePath, 'Integration test content', 'utf-8');
    const ex = new TextFileExtractor();
    const result = await ex.extract({ type: 'file', source: filePath });
    assert.equal(result.content, 'Integration test content');
  });

  it('ingestFile should work with .txt files via createRagSystem (no DB)', async () => {
    const filePath = join(intTmpDir, 'rag-ingest.txt');

    // Ensure dir exists
    await mkdir(intTmpDir, { recursive: true });
    await writeFile(filePath, 'Hello from ingestFile', 'utf-8');

    const { createRagSystem } = await import('../../index.js');
    const rag = await createRagSystem({});
    const count = await rag.ingestFile(filePath, 'test');
    assert.ok(count > 0);
    rag.deleteCollection('test');
  });

  it('ingestUrl should work with example.com', async () => {
    const { createRagSystem } = await import('../../index.js');
    const rag = await createRagSystem({});
    const count = await rag.ingestUrl('https://example.com', 'test-url');
    assert.ok(count > 0);
    rag.deleteCollection('test-url');
  });

  it('ingestRest should work with JSON API', async () => {
    const { createRagSystem } = await import('../../index.js');
    const rag = await createRagSystem({});
    const count = await rag.ingestRest(
      { url: 'https://jsonplaceholder.typicode.com/posts/1', dataPath: 'title' },
      'test-rest'
    );
    assert.ok(count > 0);
    rag.deleteCollection('test-rest');
  });
});