/**
 * 向量存储层
 *
 * 使用 sql.js 的 FTS5 做 BM25 全文搜索（零依赖）。
 * 使用内存数组做向量存储和余弦相似度搜索。
 *
 * 借鉴 Open WebUI 的 VectorDBBase 接口设计，
 * 但简化到刚好满足 Claude.Web 的需求。
 */
import crypto from 'crypto';

/**
 * 创建向量存储实例
 * @param {object} options
 * @param {object} options.db  - sql.js 数据库实例（用于 FTS5）
 * @param {number} [options.dimensions=256] - 嵌入向量维度
 */
export function createVectorStore(options = {}) {
  const { db, dimensions = 256 } = options;

  // 内存向量索引：{ id, collection, text, vector, metadata, hash }
  const vectors = [];

  // FTS5 表名
  const FTS_TABLE = 'rag_docs_fts';

  /**
   * 初始化 FTS5 表（如有 db）
   */
  function initSchema() {
    if (!db) return;
    db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ${FTS_TABLE}
      USING fts5(
        text,
        collection UNINDEXED,
        name UNINDEXED,
        source UNINDEXED,
        headings UNINDEXED,
        content_hash UNINDEXED
      )
    `);
  }

  /**
   * 插入文档
   * @param {string} collection - 集合名（如 sessionId）
   * @param {Array<{ text: string, metadata: object, hash: string }>} chunks
   * @param {number[][]} [embeddings] - 可选的嵌入向量
   */
  async function insert(collection, chunks, embeddings) {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const id = `${collection}:${chunk.hash}:${i}`;

      // 写入内存向量索引
      if (embeddings && embeddings[i]) {
        vectors.push({
          id,
          collection,
          text: chunk.text,
          vector: embeddings[i],
          metadata: chunk.metadata,
          hash: chunk.hash,
        });
      }

      // 写入 FTS5 全文索引
      if (db) {
        _insertFts(collection, chunk);
      }
    }
  }

  function _insertFts(collection, chunk) {
    const meta = chunk.metadata || {};
    // content_hash 用于 RRF 去重
    db.run(
      `INSERT INTO ${FTS_TABLE}(text, collection, name, source, headings, content_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        chunk.text,
        collection,
        meta.filename || '',
        meta.source || '',
        Array.isArray(meta.headings) ? meta.headings.join(' > ') : '',
        chunk.hash,
      ]
    );
  }

  /**
   * BM25 全文搜索（通过 FTS5 bm25 排序函数）
   * @param {string} collection
   * @param {string} query
   * @param {number} limit
   * @returns {Array<{ text: string, metadata: object, score: number, hash: string }>}
   */
  function searchBm25(collection, query, limit = 10) {
    if (!db) return [];

    // FTS5 查询语法：用 AND 组合关键词
    const ftsQuery = query
      .replace(/[^\w\s\u4e00-\u9fff]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map(w => `"${w}"`)
      .join(' AND ');

    if (!ftsQuery) return [];

    try {
      const stmt = db.prepare(`
        SELECT text, name, source, headings, content_hash, bm25(${FTS_TABLE}) AS score
        FROM ${FTS_TABLE}
        WHERE ${FTS_TABLE} MATCH ?
          AND collection = ?
        ORDER BY score
        LIMIT ?
      `);
      stmt.bind([ftsQuery, collection, limit * 2]); // 多取一些做 RRF

      const results = [];
      while (stmt.step()) {
        const row = stmt.getAsObject();
        results.push({
          text: row.text,
          metadata: {
            filename: row.name || undefined,
            source: row.source || undefined,
            headings: row.headings ? row.headings.split(' > ') : undefined,
          },
          score: row.score,
          hash: row.content_hash,
        });
      }
      stmt.free();
      return results;
    } catch (e) {
      // FTS5 查询可能因语法问题失败（如 CJK 字符），回退到 LIKE
      return _searchLike(collection, query, limit * 2);
    }
  }

  /**
   * 回退：LIKE 搜索（当 FTS5 查询 CJK 失败时）
   */
  function _searchLike(collection, query, limit) {
    const results = [];
    const seenHashes = new Set();
    const terms = query.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return results;

    // 从 FTS5 表用 LIKE 查
    try {
      for (const term of terms) {
        const likePattern = `%${term}%`;
        const stmt = db.prepare(`
          SELECT text, name, source, headings, content_hash
          FROM ${FTS_TABLE}
          WHERE text LIKE ?
            AND collection = ?
          LIMIT ?
        `);
        stmt.bind([likePattern, collection, limit]);
        while (stmt.step()) {
          const row = stmt.getAsObject();
          if (seenHashes.has(row.content_hash)) continue;
          seenHashes.add(row.content_hash);
          results.push({
            text: row.text,
            metadata: {
              filename: row.name || undefined,
              source: row.source || undefined,
              headings: row.headings ? row.headings.split(' > ') : undefined,
            },
            score: 0, // LIKE 无排名
            hash: row.content_hash,
          });
        }
        stmt.free();
      }
    } catch (e) {
      // 静默失败
    }

    return results;
  }

  /**
   * 向量相似性搜索（余弦距离）
   * @param {string} collection
   * @param {number[]} queryVector
   * @param {number} limit
   * @returns {Array<{ text: string, metadata: object, score: number, hash: string }>}
   */
  function searchVector(collection, queryVector, limit = 10) {
    const scored = vectors
      .filter(v => v.collection === collection)
      .map(v => ({
        text: v.text,
        metadata: v.metadata,
        hash: v.hash,
        score: cosineSimilarity(queryVector, v.vector),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit * 2);

    return scored;
  }

  /**
   * 余弦相似度（结果范围 [-1, 1]，越高越相似）
   */
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

  /**
   * 删除集合
   * @param {string} collection
   */
  function deleteCollection(collection) {
    // 清理内存索引
    const lenBefore = vectors.length;
    for (let i = vectors.length - 1; i >= 0; i--) {
      if (vectors[i].collection === collection) vectors.splice(i, 1);
    }

    // 清理 FTS5
    if (db) {
      db.run(`DELETE FROM ${FTS_TABLE} WHERE collection = ?`, [collection]);
    }
  }

  /**
   * 获取集合中的文档数
   */
  function count(collection) {
    return vectors.filter(v => v.collection === collection).length;
  }

  /**
   * 初始化
   */
  initSchema();

  return {
    insert,
    searchBm25,
    searchVector,
    deleteCollection,
    count,
    get vectorCount() { return vectors.length; },
  };
}