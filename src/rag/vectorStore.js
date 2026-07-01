/**
 * 向量存储层
 *
 * BM25 全文搜索 + 向量余弦相似度搜索。
 *
 * 由于 sql.js 标准 WASM 构建不含 FTS5 扩展，
 * BM25 使用普通表 + LIKE 近似实现，兼容所有 sql.js 运行时。
 */
import crypto from 'crypto';

/**
 * 创建向量存储实例
 * @param {object} options
 * @param {object} options.db  - sql.js 数据库实例
 * @param {number} [options.dimensions=256] - 嵌入向量维度
 */
export function createVectorStore(options = {}) {
  const { db, dimensions = 256 } = options;

  // 内存向量索引：{ id, collection, text, vector, metadata, hash }
  const vectors = [];

  const DOCS_TABLE = 'rag_docs';

  /**
   * 初始化普通表 + 索引
   */
  function initSchema() {
    if (!db) return;
    // 使用普通表替代 FTS5，兼容所有 sql.js 构建
    db.run(`
      CREATE TABLE IF NOT EXISTS ${DOCS_TABLE} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        collection TEXT NOT NULL,
        name TEXT DEFAULT '',
        source TEXT DEFAULT '',
        headings TEXT DEFAULT '',
        content_hash TEXT DEFAULT ''
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_rag_collection ON ${DOCS_TABLE}(collection)`);
    // 全文索引用的就是 text 列上的 LIKE
  }

  /**
   * 插入文档
   * @param {string} collection - 集合名（如 sessionId）
   * @param {Array<{ text: string, metadata: object, hash: string }>} chunks
   * @param {number[][]} [embeddings] - 可选的嵌入向量
   */
  async function insert(collection, chunks, embeddings) {
    const seenHashes = new Set();

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // 内容去重：同一 hash 只在内存和 DB 中各存一次
      if (seenHashes.has(chunk.hash)) continue;
      seenHashes.add(chunk.hash);

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

      // 写入全文索引（普通表）
      if (db) {
        _insertDoc(collection, chunk);
      }
    }
  }

  function _insertDoc(collection, chunk) {
    const meta = chunk.metadata || {};
    try {
      db.run(
        `INSERT INTO ${DOCS_TABLE}(text, collection, name, source, headings, content_hash)
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
    } catch (e) {
      console.warn(`[VECTOR_STORE] Failed to insert doc into DB: ${e.message}`);
    }
  }

  /**
   * BM25 近似搜索（基于 LIKE + 词频排序）
   * 不使用 FTS5，兼容 sql.js 标准构建
   * @param {string} collection
   * @param {string} query
   * @param {number} limit
   * @returns {Array<{ text: string, metadata: object, score: number, hash: string }>}
   */
  function searchBm25(collection, query, limit = 10) {
    if (!db) return [];

    const terms = query
      .replace(/[^\w\s\u4e00-\u9fff]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

    if (terms.length === 0) return [];

    const results = [];
    const seenHashes = new Set();
    const totalRows = [];
    const hashTermCount = {}; // hash → 命中的词数

    let stmt;
    try {
      // 使用 db.prepare 支持参数绑定（db.exec 不支持参数）
      stmt = db.prepare(
        `SELECT text, name, source, headings, content_hash
         FROM ${DOCS_TABLE}
         WHERE collection = ? AND text LIKE ?
         LIMIT ?`
      );

      for (const term of terms) {
        const likePattern = `%${term}%`;
        stmt.bind([collection, likePattern, limit * 2]);

        while (stmt.step()) {
          const row = stmt.get();
          const hash = row[4];
          if (seenHashes.has(hash)) {
            hashTermCount[hash] = (hashTermCount[hash] || 1) + 1;
          } else {
            seenHashes.add(hash);
            hashTermCount[hash] = 1;
            totalRows.push({
              text: row[0],
              metadata: {
                filename: row[1] || undefined,
                source: row[2] || undefined,
                headings: row[3] ? row[3].split(' > ') : undefined,
              },
              hash,
              score: 0,
            });
          }
        }

        stmt.reset(); // 重置以便下次 bind
      }

      // 按命中词数排序
      for (const r of totalRows) {
        r.score = (hashTermCount[r.hash] || 1) / terms.length;
      }
      totalRows.sort((a, b) => b.score - a.score);

      results.push(...totalRows.slice(0, limit * 2));
    } catch (e) {
      console.warn(`[VECTOR_STORE] searchBm25 error: ${e.message}`);
    } finally {
      if (stmt) stmt.free();
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

    // 清理文档表
    if (db) {
      db.run(`DELETE FROM ${DOCS_TABLE} WHERE collection = ?`, [collection]);
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
