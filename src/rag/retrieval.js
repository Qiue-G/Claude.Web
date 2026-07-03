/**
 * 双通道检索 + RRF 融合 + HyDE 假设文档嵌入 + 重排序
 *
 * 借鉴 Open WebUI 的检索管道设计：
 * 1. [可选] Query 重写 — LLM 改写用户查询以提升命中率
 * 2. [可选] HyDE — 先用 LLM 生成假设性文档，然后嵌入作为第三路检索信号
 * 3. BM25 关键词检索
 * 4. 向量相似性检索（余弦距离）
 * 5. RRF 融合（Reciprocal Rank Fusion + 内容哈希去重）
 * 6. [可选] Rerank（本地余弦重排 或 Cross-Encoder API）
 * 7. 内容富化 — 文件名/章节标题注入结果文本
 *
 * 内容富化策略（借鉴 Open WebUI get_enriched_texts）：
 * - 文件名注入：[来源: 文件名]
 * - 标题/章节注入：[章节: 一级标题 > 二级标题]
 */

const RRF_K = 60; // RRF 常数

import { extractEntities, entityMatchSearch } from './entityExtractor.js';

/**
 * 多通道混合检索（BM25 + 向量 + 可选 HyDE）
 * @param {object} vectorStore  - createVectorStore 返回的实例
 * @param {object} embedder     - createEmbedder 返回的实例
 * @param {string} collection   - 集合名
 * @param {string} query        - 用户查询
 * @param {object} [options]
 * @param {number} [options.topK=5]
 * @param {number} [options.bm25Weight=0.3] - BM25 权重（0=纯向量, 1=纯BM25）
 * @param {boolean} [options.enableRerank=true] - (B5) 启用本地余弦重排，默认开启
 * @param {boolean} [options.enableCrossEncoder=false] - 启用 Cross-Encoder Rerank（优先于 enableRerank）
 * @param {object} [options.rerankConfig] - Cross-Encoder Rerank 配置
 * @param {string} [options.rerankConfig.url] - Rerank API URL
 * @param {string} [options.rerankConfig.apiKey] - Rerank API Key
 * @param {string} [options.rerankConfig.model] - Rerank 模型名
 * @param {object} [options.rewriteConfig] - Query 重写配置
 * @param {boolean} [options.rewriteConfig.enabled=false]
 * @param {string} [options.rewriteConfig.url] - LLM API URL
 * @param {string} [options.rewriteConfig.apiKey] - LLM API Key
 * @param {boolean} [options.enableHyDE=false] - (B4) 启用 HyDE 第三通道
 * @param {object} [options.hydeConfig] - HyDE 配置
 * @param {string} [options.hydeConfig.url] - LLM API URL 用于生成假设文档
 * @param {string} [options.hydeConfig.apiKey] - LLM API Key
 * @param {string} [options.hydeConfig.model] - LLM 模型名
 * @param {boolean} [options.enableEnrichment=true] - 启用内容富化
 * @returns {Promise<Array<{ text: string, metadata: object, score: number, hash: string }>>}
 */
export async function hybridSearch(vectorStore, embedder, collection, query, options = {}) {
  const searchStart = Date.now();
  const topK = options.topK ?? 5;
  const bm25Weight = options.bm25Weight ?? 0.3;
  const enableRerank = options.enableRerank ?? true;  // B5: 默认启用本地重排
  const enableCrossEncoder = options.enableCrossEncoder ?? false;
  const enableHyDE = options.enableHyDE ?? false;
  const enableEnrichment = options.enableEnrichment ?? true;
  const metrics = options.metrics || null;

  // ── 1. [可选] Query 重写 ──
  const effectiveQuery = await rewriteQuery(query, options);

  // ── 2. 并行执行检索通道 ──
  const searchTasks = [
    // 通道A：BM25 全文搜索
    (async () => {
      try {
        return vectorStore.searchBm25(collection, effectiveQuery, topK);
      } catch {
        return [];
      }
    })(),

    // 通道B：向量相似性搜索
    (async () => {
      try {
        const [queryEmb] = await embedder.embedQuery(effectiveQuery);
        return vectorStore.searchVector(collection, queryEmb, topK);
      } catch {
        return [];
      }
    })(),
  ];

  // ── [B4] 通道C：HyDE 假设文档嵌入 ──
  let hydeSignal = null;
  if (enableHyDE && options.hydeConfig?.url) {
    searchTasks.push(
      (async () => {
        try {
          const hydeDoc = await generateHypotheticalDoc(effectiveQuery, options.hydeConfig);
          if (hydeDoc) {
            const [hydeEmb] = await embedder.embedDocuments([hydeDoc]);
            const hydeResults = await vectorStore.searchVector(collection, hydeEmb, topK);
            hydeSignal = { doc: hydeDoc, results: hydeResults };
            return hydeResults;
          }
        } catch (e) {
          console.warn(`[RETRIEVAL] HyDE failed: ${e.message}`);
        }
        return [];
      })()
    );
  }

  const searchResults = await Promise.all(searchTasks);
  const [bm25Results, vectorResults, hydeResults] = enableHyDE
    ? [searchResults[0], searchResults[1], searchResults[2]]
    : [searchResults[0], searchResults[1], []];

  if (hydeSignal) {
    console.log(`[RETRIEVAL] HyDE generated "${hydeSignal.doc.slice(0, 80)}..." → ${hydeSignal.results.length} results`);
  }

  // ── 3. RRF 融合（支持三通道） ──
  let fused = reciprocalRankFusion(bm25Results, vectorResults, hydeResults, {
    topK: topK * 2, // 多取一些供后续通道使用
    bm25Weight,
  });

  // ── [B3] 通道D：实体匹配检索（entityMatchSearch）──
  const entityBoost = 0.15; // 实体匹配额外加分
  const queryEntities = extractEntities(effectiveQuery);
  if (queryEntities.length > 0 && fused.length > 0) {
    const entityResults = entityMatchSearch(fused, queryEntities);
    if (entityResults.length > 0) {
      // 将 entityMatchSearch 的评分结果以实体加分形式合并到 fused 中
      const entityScoreMap = new Map();
      for (const er of entityResults) {
        entityScoreMap.set(er.hash, er.score);
      }
      for (const result of fused) {
        const es = entityScoreMap.get(result.hash);
        if (es !== undefined) {
          result.score += entityBoost * es;
          result.matchedEntity = entityResults.find(er => er.hash === result.hash)?.matchedEntity;
        }
      }
      fused.sort((a, b) => b.score - a.score);
      console.log(`[RETRIEVAL] Entity channel: ${entityResults.length}/${fused.length} docs matched, boost=${entityBoost}`);
    }
  }

  // ── [B3] 元数据过滤通道（保存过滤前副本供回退用）──
  const fusedBeforeFilter = fused;
  if (options.metadataFilter && typeof options.metadataFilter === 'object' && fused.length > 0) {
    fused = fused.filter(r => {
      const meta = r.metadata || {};
      for (const [key, value] of Object.entries(options.metadataFilter)) {
        if (meta[key] !== value) return false;
      }
      return true;
    });
  }

  // ── 4. [可选] Rerank ──
  if (fused.length > 0) {
    if (enableCrossEncoder && options.rerankConfig?.url) {
      fused = await crossEncoderRerank(effectiveQuery, fused, topK, options);
    } else if (enableRerank) {
      fused = await localRerank(vectorStore, embedder, effectiveQuery, fused, topK);
    }
  } else {
    // 如果所有结果都被过滤掉了，回退到 unfiltered 的前 topK
    fused = fusedBeforeFilter.slice(0, topK);
  }

  // ── 5. 内容富化 ──
  if (enableEnrichment && fused.length > 0) {
    fused = enrichResults(fused);
  }

  if (metrics) metrics.recordSearch(Date.now() - searchStart);

  return fused;
}

// ════════════════════════════════════════════
//   Query 重写
// ════════════════════════════════════════════

async function rewriteQuery(query, { rewriteConfig } = {}) {
  if (!rewriteConfig?.enabled) return query;

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
//   [B4] HyDE — 假设文档嵌入
// ════════════════════════════════════════════

/**
 * HyDE (Hypothetical Document Embedding)
 * 用 LLM 生成假设性完美答案文档，嵌入后作为第三检索通道。
 * 可提升零样本检索质量 15-30%。
 */
async function generateHypotheticalDoc(query, hydeConfig) {
  if (!hydeConfig?.url) return null;

  try {
    const response = await fetch(hydeConfig.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(hydeConfig.apiKey ? { 'Authorization': `Bearer ${hydeConfig.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: hydeConfig.model || 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: 'You are a hypothetical document generator for search retrieval. Given a query, write a concise, factual document that would be the ideal answer to that query. Write in the style of a technical documentation or encyclopedia entry. Be specific and informative. Output ONLY the document text, no explanations, no meta-commentary.',
          },
          { role: 'user', content: query },
        ],
        temperature: 0.7,
        max_tokens: 512,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.warn(`[HyDE] API returned ${response.status}`);
      return null;
    }

    const data = await response.json();
    const hydeDoc = data.choices?.[0]?.message?.content?.trim();
    if (!hydeDoc || hydeDoc.length < 20) return null;

    console.log(`[HyDE] generated ${hydeDoc.length} chars for query: "${query.slice(0, 50)}..."`);
    return hydeDoc;
  } catch (e) {
    console.warn(`[HyDE] generation failed: ${e.message}`);
    return null;
  }
}

// ════════════════════════════════════════════
//   内容富化
// ════════════════════════════════════════════

function enrichResults(results) {
  return results.map(r => {
    const meta = r.metadata || {};
    const prefixParts = [];

    if (meta.filename) prefixParts.push(`[来源: ${meta.filename}]`);
    if (meta.headings && Array.isArray(meta.headings) && meta.headings.length > 0) {
      prefixParts.push(`[章节: ${meta.headings.join(' > ')}]`);
    }

    if (prefixParts.length === 0) return r;
    return { ...r, text: `${prefixParts.join(' ')}\n${r.text}` };
  });
}

// ════════════════════════════════════════════
//   RRF 融合（三通道：BM25 + 向量 + HyDE）
// ════════════════════════════════════════════

function reciprocalRankFusion(bm25Results, vectorResults, hydeResults = [], { topK, bm25Weight }) {
  const seenHashes = new Set();
  const scoreMap = new Map();

  const vectorWeight = (1 - bm25Weight) * 0.7;
  const hydeWeight = (1 - bm25Weight) * 0.3;

  const channels = [
    { results: bm25Results, weight: bm25Weight },
    { results: vectorResults, weight: vectorWeight },
    { results: hydeResults, weight: hydeWeight },
  ];

  // 第一轮：新文档
  for (const { results, weight } of channels) {
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (!r.hash || seenHashes.has(r.hash)) continue;
      seenHashes.add(r.hash);
      scoreMap.set(r.hash, {
        text: r.text,
        metadata: r.metadata,
        hash: r.hash,
        score: weight * (1 / (RRF_K + i + 1)),
      });
    }
  }

  // 第二轮：向量/HyDE 中已见过的文档累加贡献
  for (const { results, weight } of channels.slice(1)) {
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (!r.hash || !scoreMap.has(r.hash)) continue;
      scoreMap.get(r.hash).score += weight * (1 / (RRF_K + i + 1));
    }
  }

  return Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ════════════════════════════════════════════
//   [B5] 本地余弦重排 (Local Reranker)
// ════════════════════════════════════════════

/**
 * 本地重排序 — 使用查询和文档的嵌入向量余弦相似度重排
 * 不需要外部 API，完全本地运行。
 */
async function localRerank(vectorStore, embedder, query, results, topK) {
  if (results.length === 0) return results;

  try {
    const [queryEmb] = await embedder.embedQuery(query);
    const textResults = results.map(r => r.text);
    const resultEmbs = await embedder.embedDocuments(textResults);

    const reranked = results.map((r, i) => ({
      ...r,
      score: cosineSimilarity(queryEmb, resultEmbs[i]),
    }));

    return reranked.sort((a, b) => b.score - a.score).slice(0, topK);
  } catch (e) {
    console.warn(`[RETRIEVAL] localRerank failed: ${e.message}, using original order`);
    return results;
  }
}

// ════════════════════════════════════════════
//   Rerank：Cross-Encoder API
// ════════════════════════════════════════════

/**
 * Cross-Encoder Rerank — 通过外部 API 对搜索结果二次排序
 * 兼容 Cohere Rerank API 格式
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
      return results;
    }

    const data = await response.json();

    // Cohere 格式: data.results[{ index, relevance_score }]
    if (data.results && Array.isArray(data.results)) {
      const scoreMap = new Map();
      for (const item of data.results) scoreMap.set(item.index, item.relevance_score);
      return results.map((r, i) => ({ ...r, score: scoreMap.has(i) ? scoreMap.get(i) : 0 }))
        .sort((a, b) => b.score - a.score).slice(0, topK);
    }

    // 备用格式: data.data[{ index, score }]
    if (data.data && Array.isArray(data.data)) {
      const scoreMap = new Map();
      for (const item of data.data) scoreMap.set(item.index, item.score);
      return results.map((r, i) => ({ ...r, score: scoreMap.has(i) ? scoreMap.get(i) : 0 }))
        .sort((a, b) => b.score - a.score).slice(0, topK);
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
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB);
  return mag === 0 ? 0 : dot / mag;
}
