/**
 * QdrantVectorStoreAdapter
 *
 * 通过 Qdrant HTTP REST API 实现 VectorStoreAdapter 接口。
 *
 * 环境变量配置：
 *   VECTOR_STORE_QDRANT_URL  — Qdrant 服务地址（默认 http://localhost:6333）
 *   VECTOR_STORE_QDRANT_API_KEY — API Key（可选）
 *
 * Qdrant 的 BM25 近似实现：
 *   - 使用 text 字段的 full_text_match 过滤 + scroll 扫描
 *   - 由于 Qdrant 不原生支持 BM25 排序，暂用 scroll + 客户端评分
 */
import crypto from 'crypto';

const DEFAULT_QDRANT_URL = 'http://localhost:6333';

// 文本搜索：按空格/标点分词，匹配词数越多评分越高
function simpleTextScore(text, terms) {
  const lower = text.toLowerCase();
  let hits = 0;
  for (const term of terms) {
    if (lower.includes(term)) hits++;
  }
  return terms.length > 0 ? hits / terms.length : 0;
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * @param {object} options
 * @param {string} [options.url] - Qdrant 服务地址
 * @param {string} [options.apiKey] - API Key
 * @param {number} [options.dimensions=256]
 * @returns {import('../adapter.js').VectorStoreAdapter}
 */
export function createQdrantAdapter(options = {}) {
  const baseUrl = (options.url || process.env.VECTOR_STORE_QDRANT_URL || DEFAULT_QDRANT_URL).replace(/\/+$/, '');
  const apiKey = options.apiKey || process.env.VECTOR_STORE_QDRANT_API_KEY || '';
  const dimensions = options.dimensions ?? 256;

  const headers = {
    'Content-Type': 'application/json',
  };
  if (apiKey) headers['api-key'] = apiKey;

  async function request(method, path, body) {
    const url = `${baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let errText = '';
      try { errText = await res.text(); } catch {}
      throw new Error(`Qdrant API error ${res.status}: ${errText}`);
    }
    return res.json();
  }

  /**
   * 确保集合存在
   */
  async function ensureCollection(collection) {
    try {
      await request('GET', `/collections/${encodeURIComponent(collection)}`);
    } catch {
      // 集合不存在，创建
      await request('PUT', `/collections/${encodeURIComponent(collection)}`, {
        vectors: {
          size: dimensions,
          distance: 'Cosine',
        },
      });
    }
  }

  return {
    /**
     * 插入文档
     */
    async insert(collection, chunks, embeddings) {
      await ensureCollection(collection);

      const points = chunks.map((chunk, i) => {
        const pointId = crypto
          .createHash('md5')
          .update(`${collection}:${chunk.hash}:${i}`)
          .digest('hex')
          .slice(0, 32);

        return {
          id: pointId,
          vector: embeddings && embeddings[i] ? embeddings[i] : new Array(dimensions).fill(0),
          payload: {
            text: chunk.text,
            hash: chunk.hash,
            filename: chunk.metadata?.filename || '',
            source: chunk.metadata?.source || '',
            headings: Array.isArray(chunk.metadata?.headings) ? chunk.metadata.headings.join(' > ') : '',
          },
        };
      });

      // 分批写入（Qdrant 单次最大 65536 points）
      const BATCH = 100;
      for (let i = 0; i < points.length; i += BATCH) {
        const batch = points.slice(i, i + BATCH);
        await request('PUT', `/collections/${encodeURIComponent(collection)}/points?wait=true`, {
          points: batch,
        });
      }
    },

    /**
     * BM25 近似搜索
     * 使用 Qdrant scroll + payload text 过滤 + 客户端评分排序
     */
    async searchBm25(collection, query, limit = 10) {
      try {
        await ensureCollection(collection);
      } catch {
        return [];
      }

      const terms = tokenize(query);
      if (terms.length === 0) return [];

      // 先 scroll 获取所有文档（限制最大 1000 条避免 OOM）
      const scrollResult = await request('POST', `/collections/${encodeURIComponent(collection)}/points/scroll`, {
        limit: 1000,
        with_payload: true,
        with_vector: false,
      });

      const points = scrollResult.result?.points || [];
      if (points.length === 0) return [];

      // 客户端评分：匹配词数 / 总词数
      const scored = [];
      const seenHashes = new Set();

      for (const point of points) {
        const text = point.payload?.text || '';
        const hash = point.payload?.hash || '';
        if (!text || seenHashes.has(hash)) continue;
        seenHashes.add(hash);

        const score = simpleTextScore(text, terms);
        if (score > 0) {
          scored.push({
            text,
            metadata: {
              filename: point.payload?.filename || undefined,
              source: point.payload?.source || undefined,
              headings: point.payload?.headings ? point.payload.headings.split(' > ') : undefined,
            },
            hash,
            score,
          });
        }
      }

      return scored.sort((a, b) => b.score - a.score).slice(0, limit);
    },

    /**
     * 向量相似性搜索
     */
    async searchVector(collection, queryVector, limit = 10) {
      try {
        await ensureCollection(collection);
      } catch {
        return [];
      }

      const result = await request('POST', `/collections/${encodeURIComponent(collection)}/points/search`, {
        vector: queryVector,
        limit,
        with_payload: true,
      });

      const points = result.result || [];
      return points.map(p => ({
        text: p.payload?.text || '',
        metadata: {
          filename: p.payload?.filename || undefined,
          source: p.payload?.source || undefined,
          headings: p.payload?.headings ? p.payload.headings.split(' > ') : undefined,
        },
        hash: p.payload?.hash || '',
        score: p.score || 0,
      }));
    },

    /**
     * 删除集合
     */
    async deleteCollection(collection) {
      try {
        await request('DELETE', `/collections/${encodeURIComponent(collection)}`);
      } catch {
        // 集合不存在也算成功
      }
    },

    /**
     * 列出所有集合
     * @returns {Promise<string[]>}
     */
    async listCollections() {
      const result = await request('GET', '/collections');
      const collections = result.result?.collections || [];
      return collections.map(c => c.name);
    },

    /**
     * 获取集合中文档数
     */
    async count(collection) {
      try {
        const result = await request('POST', `/collections/${encodeURIComponent(collection)}/points/count`, {});
        return result.result?.count || 0;
      } catch {
        return 0;
      }
    },
  };
}