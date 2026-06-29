/**
 * 嵌入 API 客户端
 *
 * 支持 OpenAI 兼容嵌入 API（如 OpenAI, Ollama, Azure）。
 * 借鉴 Open WebUI 的 dual-encoder 前缀设计：
 * - 文档侧前缀：RAG_EMBEDDING_CONTENT_PREFIX → "search_document: "
 * - 查询侧前缀：RAG_EMBEDDING_QUERY_PREFIX → "search_query: "
 */
import crypto from 'crypto';

const DEFAULT_MODEL = 'text-embedding-3-small';
const DEFAULT_DIMENSIONS = 256; // text-embedding-3-small 支持降维
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_CACHE_TTL = 3600_000; // 1 小时嵌入缓存

const EMBED_CACHE_MAX = 500;

// 嵌入缓存（避免同一文本重复调用 API）
const embedCache = new Map();

/**
 * 清理过期缓存条目（惰性清理：超过 MAX 时触发）
 */
function pruneCache() {
  if (embedCache.size <= EMBED_CACHE_MAX) return;
  const now = Date.now();
  const entries = [...embedCache.entries()]
    .filter(([, v]) => (now - v.ts) < DEFAULT_CACHE_TTL)
    .slice(-EMBED_CACHE_MAX);
  embedCache.clear();
  for (const [k, v] of entries) embedCache.set(k, v);
}

/**
 * @param {object} options
 * @param {string} [options.apiKey=process.env.OPENAI_API_KEY]
 * @param {string} [options.baseUrl=process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1']
 * @param {string} [options.model='text-embedding-3-small']
 * @param {number} [options.dimensions=256]
 * @param {number} [options.batchSize=20]
 * @param {number} [options.cacheTtl=3600000]
 */
export function createEmbedder(options = {}) {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  const baseUrl = (options.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = options.model || DEFAULT_MODEL;
  const dimensions = options.dimensions ?? DEFAULT_DIMENSIONS;
  const batchSize = options.batchSize || DEFAULT_BATCH_SIZE;
  const cacheTtl = options.cacheTtl ?? DEFAULT_CACHE_TTL;
  const metrics = options.metrics || null; // 可选的可观测性指标收集器

  /**
   * 为文档/段落生成嵌入向量（带文档前缀）
   * @param {string|string[]} input
   * @returns {Promise<number[][]>}
   */
  async function embedDocuments(input) {
    const texts = Array.isArray(input) ? input : [input];
    const prefixed = texts.map(t => `search_document: ${t}`);
    return _embed(prefixed);
  }

  /**
   * 为查询生成嵌入向量（带查询前缀）
   * @param {string|string[]} input
   * @returns {Promise<number[][]>}
   */
  async function embedQuery(input) {
    const texts = Array.isArray(input) ? input : [input];
    const prefixed = texts.map(t => `search_query: ${t}`);
    return _embed(prefixed);
  }

  /**
   * 内部嵌入方法（批量 + 缓存）
   * @param {string[]} texts
   * @returns {Promise<number[][]>}
   */
  async function _embed(texts) {
    const now = Date.now();
    const results = new Array(texts.length).fill(null);
    const uncached = [];

    // 检查缓存
    for (let i = 0; i < texts.length; i++) {
      const key = _cacheKey(texts[i]);
      const cached = embedCache.get(key);
      if (cached && (now - cached.ts) < cacheTtl) {
        results[i] = cached.vector;
        if (metrics) metrics.recordEmbedCacheHit();
      } else {
        uncached.push({ index: i, text: texts[i] });
        if (metrics) metrics.recordEmbedCacheMiss();
      }
    }

    if (uncached.length === 0) return results;

    // 分批调用 API
    for (let i = 0; i < uncached.length; i += batchSize) {
      const batch = uncached.slice(i, i + batchSize);
      const vectors = await _callApi(batch.map(b => b.text));

      for (let j = 0; j < batch.length; j++) {
        const { index, text } = batch[j];
        results[index] = vectors[j];
        embedCache.set(_cacheKey(text), { vector: vectors[j], ts: now });
      }
    }

    // 缓存惰性清理
    pruneCache();

    return results;
  }

  async function _callApi(texts) {
    const start = Date.now();

    if (!apiKey && !process.env.OPENAI_API_KEY) {
      // 没有配置 API key 时，返回 Mock 向量（用于本地测试）
      console.warn('[EMBEDDER] No API key configured, using fallback mock embeddings');
      const result = texts.map(t => _mockEmbedding(t));
      if (metrics) metrics.recordEmbedSuccess(Date.now() - start);
      return result;
    }

    const body = {
      model,
      input: texts,
      dimensions,
    };

    try {
      const response = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        if (metrics) metrics.recordEmbedFail(Date.now() - start);
        throw new Error(`Embedding API error ${response.status}: ${errText}`);
      }

      const data = await response.json();
      if (metrics) metrics.recordEmbedSuccess(Date.now() - start);
      // 按输入顺序排列
      const sorted = data.data.sort((a, b) => a.index - b.index);
      return sorted.map(item => item.embedding);
    } catch (err) {
      if (metrics) metrics.recordEmbedFail(Date.now() - start);
      throw err;
    }
  }

  function _cacheKey(text) {
    return `${model}:${dimensions}:${crypto.createHash('md5').update(text).digest('hex')}`;
  }

  /**
   * Mock 嵌入（当没有 API key 时使用，保证开发阶段可用）
   * 基于文本的简单哈希，维度固定但结果不稳定，仅用于结构验证
   */
  function _mockEmbedding(text) {
    const hash = crypto.createHash('sha256').update(text).digest();
    const vec = new Array(dimensions).fill(0);
    for (let i = 0; i < dimensions; i++) {
      vec[i] = (hash[i % hash.length] / 128) - 1; // 范围 [-1, 1]
    }
    return vec;
  }

  /**
   * 清除嵌入缓存
   */
  function clearCache() {
    embedCache.clear();
  }

  return {
    embedDocuments,
    embedQuery,
    _embed,
    clearCache,
    get model() { return model; },
    get dimensions() { return dimensions; },
  };
}