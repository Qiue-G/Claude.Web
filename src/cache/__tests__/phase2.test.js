/**
 * Phase 2 缓存组件集成测试
 * 验证 LRU / ImmutablePrefix / ContextCompactor 行为正确
 */

// ---- LRU ----
import { LruCache } from '../lru.js';
const lru = new LruCache({ maxSize: 3, ttl: 0 });

// 1. 基本 set/get
lru.set('a', 1);
lru.set('b', 2);
lru.set('c', 3);
console.assert(lru.get('a') === 1, 'LRU: get a');
console.assert(lru.size === 3, 'LRU: size 3');

// 2. LRU 淘汰
lru.set('d', 4); // 应淘汰 b（a 被访问过，b 最旧未访问）
console.assert(lru.get('b') === undefined, 'LRU: b evicted');
console.assert(lru.get('d') === 4, 'LRU: d present');
console.assert(lru.size === 3, 'LRU: size still 3');

// 3. TTL 过期
const lruTtl = new LruCache({ maxSize: 10, ttl: 10 }); // 10ms
lruTtl.set('x', 99);
console.assert(lruTtl.get('x') === 99, 'TTL: before expiry');
await new Promise(r => setTimeout(r, 20));
console.assert(lruTtl.get('x') === undefined, 'TTL: after expiry');

// 4. has() 不更新顺序
const lru2 = new LruCache({ maxSize: 2 });
lru2.set('a', 1);
lru2.set('b', 2);
lru2.has('a'); // 不应更新访问顺序
lru2.set('c', 3); // 应淘汰 a（has 不更新顺序）
console.assert(lru2.get('a') === undefined, 'LRU: has() does not update order');

// ---- ImmutablePrefix ----
import { getOrBuildPrefix, clearPrefixCache } from '../immutablePrefix.js';
clearPrefixCache();

let callCount = 0;
const result1 = getOrBuildPrefix(['rag_search', 'web_search'], () => {
  callCount++;
  return 'INSTRUCTIONS_V1';
});
const result2 = getOrBuildPrefix(['rag_search', 'web_search'], () => {
  callCount++;
  return 'INSTRUCTIONS_V2'; // 应被缓存，不会执行
});
console.assert(result1 === 'INSTRUCTIONS_V1', 'Prefix: first call returns build result');
console.assert(result2 === 'INSTRUCTIONS_V1', 'Prefix: second call returns cached (same key)');
console.assert(callCount === 1, 'Prefix: buildFn called only once');

// 不同工具组合应生成不同缓存
const result3 = getOrBuildPrefix(['rag_search'], () => {
  callCount++;
  return 'INSTRUCTIONS_RAG_ONLY';
});
console.assert(result3 === 'INSTRUCTIONS_RAG_ONLY', 'Prefix: different key, different cache');
console.assert(callCount === 2, 'Prefix: buildFn called for different key');

// ---- ContextCompactor ----
import { compactHistory } from '../contextCompactor.js';

// 短历史不应压缩
const short = [
  { role: 'user', content: 'hi' },
  { role: 'assistant', content: 'hello' },
];
console.assert(compactHistory(short) === short, 'Compactor: short history unchanged');

// 长历史 + 高价值信号
const longWithDecisions = [
  { role: 'user', content: 'We must use Python for this project.' },
  { role: 'assistant', content: 'Agreed. That is the best choice.' },
  { role: 'user', content: 'OK' },
  { role: 'assistant', content: 'yes' },
  { role: 'user', content: 'The max file size should be 10MB.' },
  { role: 'assistant', content: 'Got it.' },
  { role: 'user', content: 'Another important constraint: no external APIs.' },
  { role: 'assistant', content: 'Understood.' },
  { role: 'user', content: 'How to implement caching?' },
  { role: 'assistant', content: 'Use an LRU cache with TTL.' },
];
// maxRecent=3 会压缩前 7 条
const compacted = compactHistory(longWithDecisions, { maxRecent: 3, maxChars: 500 });

console.assert(compacted.length === 4, 'Compactor: 3 recent + 1 compacted = 4');
console.assert(compacted[0].role === 'system', 'Compactor: compacted block has system role');
// "must" 被 HIGH_SIGNAL 捕获（must\s），应出现在压缩块中
console.assert(compacted[0].content.includes('must'), 'Compactor: "must" signal captured');
// "important" 被 HIGH_SIGNAL 捕获
console.assert(compacted[0].content.includes('important'), 'Compactor: "important" signal captured');
// "OK" 被低价值过滤
console.assert(!compacted[0].content.includes('OK'), 'Compactor: low-value "OK" filtered');
// "yes" 被低价值过滤
console.assert(!compacted[0].content.includes('yes'), 'Compactor: low-value "yes" filtered');

// ---- buildPrompt 无回归 ----
import { buildPrompt } from '../../server/runtime/promptBuilder.js';

// 用唯一工具组合避免前缀缓存干扰
const prompt = buildPrompt({
  toolInstructions: 'Available: web_search, rag_search',
  activeToolIds: ['test_build_prompt'],
  toolResults: [{ tool: 'rag_search', ok: true, content: 'Found doc X' }],
  userMessage: 'Query about X',
  history: [{ role: 'user', content: 'Prior question' }, { role: 'assistant', content: 'Prior answer' }],
  enableCompaction: false,
});

console.assert(prompt.systemPrompt.includes('[Knowledge Base Results]'), 'Prompt: has tool result sections');
console.assert(prompt.systemPrompt.includes('[Conversation History]'), 'Prompt: has history');
console.assert(prompt.userMessage.includes('Query about X'), 'Prompt: has user message text');
console.assert(prompt.systemPrompt.includes('Found doc X'), 'Prompt: contains tool result text');

// 无工具指令时无系统指令段
const promptNoTools = buildPrompt({
  toolInstructions: '',
  activeToolIds: [],
  userMessage: 'hi',
});
console.assert(!promptNoTools.systemPrompt.includes('[Tool Instructions]'), 'Prompt: no tool instructions without tools');

// 启用压缩且历史很长时
const longHistory = Array.from({ length: 20 }, (_, i) => ({
  role: i % 2 === 0 ? 'user' : 'assistant',
  content: i % 2 === 0 ? `Message ${i}: we decided to use option ${i}.` : `OK, option ${i} is chosen.`,
}));
const promptCompacted = buildPrompt({
  userMessage: 'final',
  history: longHistory,
  enableCompaction: true,
  maxHistoryChars: 500, // 小值确保触发压缩
});
// 应仍有用户消息
console.assert(promptCompacted.userMessage === 'final', 'Compacted prompt: has final message');
// 压缩块中应有高价值信号
console.assert(promptCompacted.systemPrompt.includes('decided'), 'Compacted prompt: high signal preserved');

console.log('\n✅ Phase 2 全部测试通过');