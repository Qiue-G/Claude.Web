/**
 * 双通道检索 + RRF 融合
 *
 * 借鉴 Open WebUI 的检索管道设计：
 * 1. [可选] Query 重写 — LLM 改写用户查询以提升命中率
 * 2. BM25 关键词检索（FTS5）
 * 3. 向量相似性检索（余弦距离）
 * 4. RRF 融合（Reciprocal Rank Fusion + 内容哈希去重）
 * 5. [可选] Rerank（余弦重排 或 Cross-Encoder API）
 * 6. 内容富化 — 文件名/章节标题注入结果文本
 *
 * 内容富化策略（借鉴 Open WebUI get_enriched_texts）：
 * - 文件名注入：[来源: 文件名]
 * - 标题/章节注入：[章节: 一级标题 > 二级标题]
 */

const RRF_K = 60; // RRF 常数

/**
 * 双通道混合检索
 * @param {object} vectorStore  - createVectorStore 返回的实例
 * @param {object} embedder     - createEmbedder 返回的实例
 * @param {string} collection   - 集合名
 * @param {string} query        - 用户查询
 * @param {object} [options]
 * @param {number} [options.topK=5]
 * @param {number} [options.bm25Weight=0.3] - BM25 权重（0=纯向量, 1=纯BM25）
 * @param {boolean} [options.enableRerank=false] - 启用余弦重排
 * @param {boolean} [options.enableCrossEncoder=false] - 启用 Cross-Encoder Rerank（优先于 enableRerank）
 * @param {object} [options.rerankConfig] - Cross-Encoder Rerank 配置
 * @param {string} [options.rerankConfig.url] - Rerank API URL
 * @param {string} [options.rerankConfig.apiKey] - Rerank API Key
 * @param {string} [options.rerankConfig.model] - Rerank 模型名（默认 cohere/rerank-v3.5）
 * @param {object} [options.rewriteConfig] - Query 重写配置
 * @param {boolean} [options.rewriteConfig.enabled=false] - 启用 Query 重写
 * @param {string} [options.rewriteConfig.url] - LLM API URL（兼容 OpenAI 格式）
 * @param {string} [options.rewriteConfig.apiKey] - LLM API Key
 * @param {string} [options.rewriteConfig.model] - LLM 模型名
 * @param {boolean} [options.enableEnrichment=true] - 启用内容富化
 * @returns {Promise<Array<{ text: string, metadata: object, score: number, hash: string }>>}
 */
export async function hybridSearch(vectorStore, embedder, collection, query, options = {}) {
  const searchStart = Date.now();
  const topK = options.topK ?? 5;
  const bm25Weight = options.bm25Weight ?? 0.3;
  const enableRerank = options.enableRerank ?? false;
  const enableCrossEncoder = options.enableCrossEncoder ?? false;
  const enableEnrichment = options.enableEnrichment ?? true;
  const metrics = options.metrics || null;

  // ── 1. [可选] Query 重写 ──
  const effectiveQuery = await rewriteQuery(query, options);

  // ── 2. 并行执行两个检索通道 ──
  const [bm25Results, vectorResults] = await Promise.all([
    // 通道A：BM25 全文搜索
    (async () => {
      try {
        return vectorStore.searchBm25(collection, effectiveQuery, topK);
      } catch {
        return []; // BM25 失败时回退到纯向量搜索
      }
    })(),

    // 通道B：向量相似性搜索
    (async () => {
      try {
        const [queryEmb] = await embedder.embedQuery(effectiveQuery);
        return vectorStore.searchVector(collection, queryEmb, topK);
      } catch {
        return []; // 嵌入失败时回退到纯 BM25
      }
    })(),
  ]);

  // ── 3. RRF 融合 ──
  let fused = reciprocalRankFusion(bm25Results, vectorResults, {
    topK,
    bm25Weight,
  });

  // ── 4. [可选] Rerank ──
  if (vectorResults.length > 0) {
    if (enableCrossEncoder) {
      // Cross-Encoder Rerank（优先于余弦 Rerank）
      fused = await crossEncoderRerank(effectiveQuery, fused, topK, options);
    } else if (enableRerank) {
      // 余弦距离 Rerank
      fused = await cosineRerank(vectorStore, embedder, effectiveQuery, fused, topK);
    }
  }

  // ── 5. 内容富化 ──
  if (enableEnrichment && fused.length > 0) {
    fused = enrichResults(fused);
  }

  // 记录检索延迟
  if (metrics) metrics.recordSearch(Date.now() - searchStart);

  return fused;
}

// ════════════════════════════════════════════
//   Query 重写
// ════════════════════════════════════════════

/**
 * Query 重写 — 用 LLM 改写用户查询以提升检索命中率
 *
 * 支持两种方式（按优先级）:
 * 1. 外部注入 rewriteFn（从 options.rewriteConfig.fn 传入自定义函数）
 * 2. 配置了 rewriteConfig.url，直接调用兼容 OpenAI 格式的 LLM API
 *
 * @param {string} query
 * @param {object} options
 * @param {object} [options.rewriteConfig]
 * @param {boolean} [options.rewriteConfig.enabled=false]
 * @param {Function} [options.rewriteConfig.fn] - 外部注入的异步重写函数 (query) => string
 * @param {string} [options.rewriteConfig.url] - LLM API URL
 * @param {string} [options.rewriteConfig.apiKey] - LLM API Key
 * @param {string} [options.rewriteConfig.model] - LLM 模型名
 * @returns {Promise<string>}
 */
async function rewriteQuery(query, { rewriteConfig } = {}) {
  if (!rewriteConfig?.enabled) return query;

  // 方式1：外部注入 rewriteFn
  if (typeof rewriteConfig.fn === 'function') {
    try {
      const rewritten = await rewriteConfig.fn(query);
      if (rewritten && typeof rewritten === 'string' && rewritten.trim() && rewritten.trim() !== query.trim()) {
        console.log(`[RETRIEVAL] query rewritten via fn: "${query}" → "${rewritten}"`);
        return rewritten.trim();
      }
    } catch (e) {
      console.warn(`[RETRIEVAL] rewrite fn failed: ${e.message}`);
    }
    return query;
  }

  // 方式2：LLM API 重写
  if (rewriteConfig.url) {
    try {
      const response = await fetch(rewriteConfig.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(rewriteConfig.apiKey ? { 'Authorization': `Bearer ${rewriteConfig.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: rewriteConfig.model || 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are a search query rewriter. Rewrite the given query to improve search retrieval relevance. Keep the core meaning but expand abbreviations, add synonyms, and use precise terminology. Output ONLY the rewritten query, no explanation, no quotes, no prefix.',
            },
            { role: 'user', content: query },
          ],
          temperature: 0.3,
          max_tokens: 256,
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const data = await response.json();
        const rewritten = data.choices?.[0]?.message?.content?.trim();
        if (rewritten && rewritten !== query.trim()) {
          console.log(`[RETRIEVAL] query rewritten via LLM: "${query}" → "${rewritten}"`);
          return rewritten;
        }
      } else {
        console.warn(`[RETRIEVAL] rewrite API returned ${response.status}`);
      }
    } catch (e) {
      console.warn(`[RETRIEVAL] rewrite API call failed: ${e.message}`);
    }
  }

  return query;
}

// ════════════════════════════════════════════
//   内容富化
// ════════════════════════════════════════════

/**
 * 内容富化 — 将文件名/章节标题注入结果文本
 *
 * 对每个结果，如果 metadata 中包含 filename 或 headings，
 * 在 text 前添加 [来源: 文件名] 和/或 [章节: 标题链] 前缀。
 * 不修改原始 metadata，仅增强 text 字段。
 *
 * @param {Array<{ text: string, metadata?: object }>} results
 * @returns {Array<{ text: string, metadata?: object }>}
 */
function enrichResults(results) {
  return results.map(r => {
    const meta = r.metadata || {};
    const prefixParts = [];

    if (meta.filename) {
      prefixParts.push(`[来源: ${meta.filename}]`);
    }
    if (meta.headings && Array.isArray(meta.headings) && meta.headings.length > 0) {
      prefixParts.push(`[章节: ${meta.headings.join(' > ')}]`);
    }

    if (prefixParts.length === 0) return r;

    return {
      ...r,
      text: `${prefixParts.join(' ')}\n${r.text}`,
    };
  });
}

// ════════════════════════════════════════════
//   RRF 融合
// ════════════════════════════════════════════

/**
 * Reciprocal Rank Fusion
 * 使用内容哈希（SHA-256）去重，确保同一内容在 BM25 和向量搜索中不重复计分
 */
function reciprocalRankFusion(bm25Results, vectorResults, { topK, bm25Weight }) {
  const seenHashes = new Set();
  const scoreMap = new Map(); // hash → { text, metadata, score }

  // BM25 结果
  for (let i = 0; i < bm25Results.length; i++) {
    const r = bm25Results[i];
    if (!r.hash || seenHashes.has(r.hash)) continue;
    seenHashes.add(r.hash);
    const rank = i + 1;
    scoreMap.set(r.hash, {
      text: r.text,
      metadata: r.metadata,
      hash: r.hash,
      score: bm25Weight * (1 / (RRF_K + rank)),
    });
  }

  // 向量搜索结果（始终加上向量排名贡献，即使文档也出现在 BM25 结果中）
  for (let i = 0; i < vectorResults.length; i++) {
    const r = vectorResults[i];
    if (!r.hash) continue;
    const rank = i + 1;
    if (scoreMap.has(r.hash)) {
      // 同时在 BM25 和向量结果中 → 累加向量排名贡献
      scoreMap.get(r.hash).score += (1 - bm25Weight) * (1 / (RRF_K + rank));
    } else {
      scoreMap.set(r.hash, {
        text: r.text,
        metadata: r.metadata,
        hash: r.hash,
        score: (1 - bm25Weight) * (1 / (RRF_K + rank)),
      });
    }
  }

  return Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ════════════════════════════════════════════
//   Rerank：余弦距离
// ════════════════════════════════════════════

/**
 * 余弦距离 Rerank
 * 用 query 嵌入向量与结果嵌入向量的余弦相似度重新排序
 */
async function cosineRerank(vectorStore, embedder, query, results, topK) {
  if (results.length === 0) return results;

  const [queryEmb] = await embedder.embedQuery(query);

  // 获取结果的嵌入向量
  const textResults = results.map(r => r.text);
  const resultEmbs = await embedder.embedDocuments(textResults);

  const reranked = results.map((r, i) => ({
    ...r,
    score: cosineSimilarity(queryEmb, resultEmbs[i]),
  }));

  return reranked.sort((a, b) => b.score - a.score).slice(0, topK);
}

// ════════════════════════════════════════════
//   Rerank：Cross-Encoder API
// ════════════════════════════════════════════

/**
 * Cross-Encoder Rerank — 通过外部 API 对搜索结果二次排序
 *
 * 兼容 Cohere Rerank API 格式：
 *   POST {url}
 *   Body: { model, query, documents: string[], top_n?: number }
 *   Response: { results: [{ index: number, relevance_score: number }] }
 *
 * @param {string} query
 * @param {Array<{ text: string, metadata?: object, score: number, hash: string }>} results
 * @param {number} topK
 * @param {object} options
 * @param {object} [options.rerankConfig]
 * @param {string} [options.rerankConfig.url] — Rerank API URL
 * @param {string} [options.rerankConfig.apiKey] — API Key
 * @param {string} [options.rerankConfig.model] — 模型名
 * @returns {Promise<Array>}
 */
async function crossEncoderRerank(query, results, topK, { rerankConfig } = {}) {
  if (results.length === 0) return results;

  if (!rerankConfig?.url) {
    console.warn('[RETRIEVAL] crossEncoderRerank: no URL configured, skipping');
    return results;
  }

  const documents = results.map(r => r.text);

  try {
    const response = await fetch(rerankConfig.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(rerankConfig.apiKey ? { 'Authorization': `Bearer ${rerankConfig.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: rerankConfig.model || 'rerank-v3.5',
        query,
        documents,
        top_n: topK,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.warn(`[RETRIEVAL] crossEncoderRerank API error ${response.status}: ${errText}`);
      return results; // 失败时返回原始结果
    }

    const data = await response.json();

    // 兼容 Cohere 格式: data.results[{ index, relevance_score }]
    if (data.results && Array.isArray(data.results)) {
      const scoreMap = new Map();
      for (const item of data.results) {
        scoreMap.set(item.index, item.relevance_score);
      }

      return results
        .map((r, i) => ({
          ...r,
          score: scoreMap.has(i) ? scoreMap.get(i) : 0,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    }

    // 备用格式: data.data[{ index, score }]
    if (data.data && Array.isArray(data.data)) {
      const scoreMap = new Map();
      for (const item of data.data) {
        scoreMap.set(item.index, item.score);
      }

      return results
        .map((r, i) => ({
          ...r,
          score: scoreMap.has(i) ? scoreMap.get(i) : 0,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    }

    console.warn('[RETRIEVAL] crossEncoderRerank: unexpected response format');
    return results;
  } catch (e) {
    console.warn(`[RETRIEVAL] crossEncoderRerank failed: ${e.message}`);
    return results;
  }
}

// ════════════════════════════════════════════
//   工具函数
// ════════════════════════════════════════════

function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB);
  return mag === 0 ? 0 : dot / mag;
}
