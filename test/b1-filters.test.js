/**
 * B1 Filters 管道 — 单元测试
 *
 * 直接测试 filterPipeline.js 引擎 + 3 个内置 filter 的核心逻辑
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// --- Filter Pipeline Engine ---
import { runFilters } from '../src/server/runtime/filterPipeline.js';

// --- Built-in Filters ---
import { contextInjectFilter } from '../src/server/runtime/filters/contextInject.js';
import { profanityFilter } from '../src/server/runtime/filters/profanity.js';
import { formatGuardFilter } from '../src/server/runtime/filters/formatGuard.js';

// --- Filter Registry ---
import { buildFilterList, getFilterMeta } from '../src/server/runtime/filters/index.js';

// =============================================
// 1. Filter Pipeline Engine
// =============================================
describe('filterPipeline.js', () => {
  it('should pass through content when no filters', async () => {
    const result = await runFilters('input', 'hello', {}, []);
    assert.strictEqual(result.content, 'hello');
    assert.strictEqual(result.aborted, false);
  });

  it('should execute filters in order', async () => {
    const calls = [];
    const filters = [
      {
        id: 'f1',
        enabled: true,
        handler: async ({ content }) => { calls.push('f1'); return { content: content + ' a' }; }
      },
      {
        id: 'f2',
        enabled: true,
        handler: async ({ content }) => { calls.push('f2'); return { content: content + ' b' }; }
      }
    ];

    const result = await runFilters('input', 'x', {}, filters);
    assert.strictEqual(result.content, 'x a b');
    assert.deepStrictEqual(calls, ['f1', 'f2']);
  });

  it('should skip disabled filters', async () => {
    const filters = [
      { id: 'f1', enabled: false, handler: async ({ content }) => ({ content: 'wrong' }) },
      { id: 'f2', enabled: true, handler: async ({ content }) => ({ content: 'ok' }) }
    ];
    const result = await runFilters('input', 'test', {}, filters);
    assert.strictEqual(result.content, 'ok');
  });

  it('should abort pipeline on abort', async () => {
    const filters = [
      { id: 'f1', enabled: true, handler: async ({ content }) => ({ content: 'blocked', abort: true, reason: 'no' }) },
      { id: 'f2', enabled: true, handler: async ({ content }) => ({ content: content + ' should not run' }) }
    ];
    const result = await runFilters('input', 'test', {}, filters);
    assert.strictEqual(result.aborted, true);
    assert.strictEqual(result.reason, 'no');
    // On abort, content is what was passed INTO the aborting filter
    assert.strictEqual(result.content, 'test');
  });

  it('should not crash on handler error', async () => {
    const filters = [
      { id: 'err', enabled: true, handler: async () => { throw new Error('boom'); } },
      { id: 'ok', enabled: true, handler: async ({ content }) => ({ content: content + ' survived' }) }
    ];
    const result = await runFilters('input', 'hi', {}, filters);
    // Error handler doesn't abort, continues to next filter
    assert.strictEqual(result.content, 'hi survived');
  });
});

// =============================================
// 2. contextInject Filter (input)
// =============================================
describe('contextInject (input)', () => {
  it('should skip output type', async () => {
    const result = await contextInjectFilter.handler({
      type: 'output',
      content: 'some output',
      session: { id: 's1' },
      context: {}
    });
    assert.strictEqual(result.content, 'some output');
  });

  it('should skip when no rag', async () => {
    const result = await contextInjectFilter.handler({
      type: 'input',
      content: 'hello world this is a test',
      session: { id: 's1' },
      context: {}
    });
    assert.strictEqual(result.content, 'hello world this is a test');
  });

  it('should skip short messages', async () => {
    const result = await contextInjectFilter.handler({
      type: 'input',
      content: 'hi',
      session: { id: 's1' },
      context: { rag: {}, filterOptions: { minQueryLength: 10 } }
    });
    assert.strictEqual(result.content, 'hi');
  });

  it('should skip tool messages when ignoreToolMessages=true', async () => {
    const result = await contextInjectFilter.handler({
      type: 'input',
      content: '/tool rag_search test query',
      session: { id: 's1' },
      context: { rag: {}, filterOptions: { ignoreToolMessages: true } }
    });
    assert.strictEqual(result.content, '/tool rag_search test query');
  });

  it('should inject context when rag.search returns results', async () => {
    const mockRag = {
      search: async (collection, query, opts) => [
        { text: 'Important document content here', score: 0.85, metadata: { filename: 'doc1.txt' } },
        { text: 'Another relevant snippet', score: 0.62, metadata: { filename: 'doc2.txt' } }
      ]
    };

    const result = await contextInjectFilter.handler({
      type: 'input',
      content: 'what is the knowledge base about?',
      session: { id: 's1' },
      context: { rag: mockRag, filterOptions: { topK: 3, maxContextLength: 2000 } }
    });

    console.log('[contextInject] injected content sample:', result.content.substring(0, 120) + '...');

    assert.ok(result.content.includes('<context>'), 'should wrap in context tags');
    assert.ok(result.content.includes('</context>'), 'should close context tags');
    assert.ok(result.content.includes('[知识库]'), 'should include source labels');
    assert.ok(result.content.includes('what is the knowledge base about?'), 'should keep original query');
  });

  it('should filter by minScore', async () => {
    const mockRag = {
      search: async () => [
        { text: 'High score doc', score: 0.9 },
        { text: 'Low score doc', score: 0.05 }
      ]
    };

    const result = await contextInjectFilter.handler({
      type: 'input',
      content: 'test query with sufficient length for filtering',
      session: { id: 's1' },
      context: { rag: mockRag, filterOptions: { minScore: 0.1 } }
    });

    assert.ok(result.content.includes('High score doc'), 'should include high-score doc');
    assert.ok(!result.content.includes('Low score doc'), 'should exclude low-score doc');
  });
});

// =============================================
// 3. profanity Filter (output)
// =============================================
describe('profanity (output)', () => {
  it('should skip input type', async () => {
    const result = await profanityFilter.handler({
      type: 'input',
      content: 'some input',
      session: {},
      context: { filterOptions: { action: 'block' } }
    });
    assert.strictEqual(result.content, 'some input');
  });

  it('should pass through clean content', async () => {
    const result = await profanityFilter.handler({
      type: 'output',
      content: 'This is a perfectly clean response.',
      session: {},
      context: { filterOptions: {} }
    });
    assert.strictEqual(result.content, 'This is a perfectly clean response.');
  });

  it('should add warning on warn action', async () => {
    // With empty default words list, we need custom words to trigger
    const result = await profanityFilter.handler({
      type: 'output',
      content: 'this is a normal response',
      session: {},
      context: { filterOptions: { customWords: ['normal'], action: 'warn' } }
    });
    assert.ok(result.content.includes('内容审查'), 'should include warning');
  });

  it('should abort on block action', async () => {
    const result = await profanityFilter.handler({
      type: 'output',
      content: 'this has normal content that triggers block',
      session: {},
      context: { filterOptions: { customWords: ['normal'], action: 'block' } }
    });
    assert.strictEqual(result.abort, true);
    assert.ok(result.reason.includes('内容审查'), 'should give block reason');
  });

  it('should replace on replace action', async () => {
    const result = await profanityFilter.handler({
      type: 'output',
      content: 'this has normal content for replacement',
      session: {},
      context: { filterOptions: { customWords: ['normal'], action: 'replace' } }
    });
    assert.ok(result.content.includes('***'), 'should replace with asterisks');
    assert.ok(!result.content.includes('normal'), 'should not contain original word');
  });
});

// =============================================
// 4. formatGuard Filter (output)
// =============================================
describe('formatGuard (output)', () => {
  it('should skip input type', async () => {
    const result = await formatGuardFilter.handler({
      type: 'input',
      content: 'some input',
      session: {},
      context: { filterOptions: {} }
    });
    assert.strictEqual(result.content, 'some input');
  });

  it('should truncate oversized content', async () => {
    const long = 'a'.repeat(500);
    const result = await formatGuardFilter.handler({
      type: 'output',
      content: long,
      session: {},
      context: { filterOptions: { maxLength: 100, action: 'fix' } }
    });
    assert.ok(result.content.length <= 100 + 20, 'should truncate to maxLength');
    assert.ok(result.content.includes('输出已截断'), 'should add truncation notice');
  });

  it('should close unclosed code fences', async () => {
    const result = await formatGuardFilter.handler({
      type: 'output',
      content: 'some text\n```python\nprint("hello")',
      session: {},
      context: { filterOptions: { stripCodeFences: true, action: 'fix' } }
    });
    assert.ok(result.content.endsWith('```'), 'should close code fence');
  });

  it('should not add extra closing fence when already closed', async () => {
    const content = 'some text\n```python\nprint("hello")\n```';
    const result = await formatGuardFilter.handler({
      type: 'output',
      content,
      session: {},
      context: { filterOptions: { stripCodeFences: true, action: 'fix' } }
    });
    assert.strictEqual(result.content, content);
  });

  it('should compress excessive blank lines', async () => {
    const result = await formatGuardFilter.handler({
      type: 'output',
      content: 'line1\n\n\n\n\nline2',
      session: {},
      context: { filterOptions: { action: 'fix' } }
    });
    assert.ok(result.content.includes('\n\n\n'), 'should keep 2 blank lines max');
    // Verify: 5 newlines between line1 and line2 gets compressed
    assert.ok(result.content === 'line1\n\n\nline2', 'should compress to 2 blank lines');
  });

  it('should block when action=block and maxLength exceeded', async () => {
    const result = await formatGuardFilter.handler({
      type: 'output',
      content: 'a'.repeat(200),
      session: {},
      context: { filterOptions: { maxLength: 50, action: 'block' } }
    });
    assert.strictEqual(result.abort, true);
    assert.ok(result.reason.includes('超长'), 'should give length reason');
  });

  it('should detect missing Chinese when requireChinese', async () => {
    const result = await formatGuardFilter.handler({
      type: 'output',
      content: 'English only content here',
      session: {},
      context: { filterOptions: { requireChinese: true, action: 'warn' } }
    });
    assert.ok(result.content.includes('格式校验'), 'should warn about missing chinese');
  });

  it('should pass when chinese exists and required', async () => {
    const result = await formatGuardFilter.handler({
      type: 'output',
      content: 'This has 中文 too',
      session: {},
      context: { filterOptions: { requireChinese: true, action: 'warn' } }
    });
    assert.strictEqual(result.content, 'This has 中文 too');
  });
});

// =============================================
// 5. Filter Registry
// =============================================
describe('filters/index.js registry', () => {
  it('should build filter list from config', () => {
    const config = {
      contextInject: { enabled: true },
      profanity: { enabled: false },
      formatGuard: { enabled: true, maxLength: 5000 }
    };

    const list = buildFilterList(config);
    assert.strictEqual(list.length, 3);
    assert.strictEqual(list[0].id, 'contextInject');
    assert.strictEqual(list[0].enabled, true);
    assert.strictEqual(list[1].id, 'profanity');
    assert.strictEqual(list[1].enabled, false);
    assert.strictEqual(list[2].id, 'formatGuard');
    assert.strictEqual(list[2].enabled, true);
    assert.strictEqual(list[2].maxLength, 5000); // custom option passed through
  });

  it('should enable all filters by default', () => {
    const list = buildFilterList({});
    assert.strictEqual(list.length, 3);
    assert.ok(list.every(f => f.enabled === true));
  });

  it('should return filter meta for frontend', () => {
    const meta = getFilterMeta();
    assert.strictEqual(meta.length, 3);
    assert.ok(meta.find(m => m.id === 'contextInject' && m.inputOnly));
    assert.ok(meta.find(m => m.id === 'profanity' && m.outputOnly));
    assert.ok(meta.find(m => m.id === 'formatGuard' && m.outputOnly));
  });
});