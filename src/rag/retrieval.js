/**
 * 双通道检索 + RRF 融合
 *
 * 借鉴 Open WebUI 的检索管道设计：
 * 1. BM25 关键词检索（FTS5）
 * 2. 向量相似性检索（余弦距离）
 * 3. RRF 融合（Reciprocal Rank Fusion + 内容哈希去重）
 * 4. 可选 Rerank（基于 query 和结果的余弦重排）
 *
 * 内容富化策略（借鉴 Open WebUI get_enriched_texts）：
 * - 文件名重复两次给 BM25 加权
 * - 标题/章节/来源注入
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
 * @param {boolean} [options.enableRerank=false]
 * @returns {Promise<Array<{ text: string, metadata: object, score: number, hash: string }>>}
 */
export async function hybridSearch(vectorStore, embedder, collection, query, options = {}) {
  const searchStart = Date.now();
  const topK = options.topK ?? 5;
  const bm25Weight = options.bm25Weight ?? 0.3;
  const enableRerank = options.enableRerank ?? false;
  const metrics = options.metrics || null;

  // 并行执行两个检索通道
  const [bm25Results, vectorResults] = await Promise.all([
    // 通道A：BM25 全文搜索
    (async () => {
      try {
        return vectorStore.searchBm25(collection, query, topK);
      } catch {
        return []; // BM25 失败时回退到纯向量搜索
      }
    })(),

    // 通道B：向量相似性搜索
    (async () => {
      try {
        const [queryEmb] = await embedder.embedQuery(query);
        return vectorStore.searchVector(collection, queryEmb, topK);
      } catch {
        return []; // 嵌入失败时回退到纯 BM25
      }
    })(),
  ]);

  // RRF 融合
  let fused = reciprocalRankFusion(bm25Results, vectorResults, {
    topK,
    bm25Weight,
  });

  // 可选：Query-based Rerank（用 query 嵌入对结果二次打分）
  if (enableRerank && vectorResults.length > 0) {
    fused = await rerank(vectorStore, embedder, query, fused, topK);
  }

  // 记录检索延迟
  if (metrics) metrics.recordSearch(Date.now() - searchStart);

  return fused;
}

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

  // 向量搜索结果
  for (let i = 0; i < vectorResults.length; i++) {
    const r = vectorResults[i];
    if (!r.hash || seenHashes.has(r.hash)) continue;
    seenHashes.add(r.hash);
    const rank = i + 1;
    // BM25 已经为该 hash 创建了条目，需要加上向量分数的贡献
    if (scoreMap.has(r.hash)) {
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

/**
 * Query-based Rerank
 * 用 query 嵌入向量与结果嵌入向量的余弦相似度重新排序
 */
async function rerank(vectorStore, embedder, query, results, topK) {
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