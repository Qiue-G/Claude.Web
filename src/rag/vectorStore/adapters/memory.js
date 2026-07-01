/**
 * MemoryVectorStoreAdapter
 *
 * 在现有 createVectorStore（内存向量索引 + sql.js 全文表）基础上，
 * 实现 VectorStoreAdapter 接口。
 */
import { createVectorStore } from '../../vectorStore.js';

/**
 * @param {object} options
 * @param {object} [options.db] - sql.js 数据库实例（可选，用于 BM25 搜索）
 * @param {number} [options.dimensions=256]
 * @returns {import('../adapter.js').VectorStoreAdapter}
 */
export function createMemoryAdapter(options = {}) {
  const store = createVectorStore(options);
  const collections = new Set();

  // 从 store 中提取原始方法（不修改 store 本身）
  const origInsert = store.insert.bind(store);
  const origDelete = store.deleteCollection.bind(store);

  return {
    /**
     * 插入文档
     */
    async insert(collection, chunks, embeddings) {
      collections.add(collection);
      await origInsert(collection, chunks, embeddings);
    },

    /**
     * BM25 全文搜索
     */
    async searchBm25(collection, query, limit = 10) {
      return store.searchBm25(collection, query, limit);
    },

    /**
     * 向量相似性搜索
     */
    async searchVector(collection, queryVector, limit = 10) {
      return store.searchVector(collection, queryVector, limit);
    },

    /**
     * 删除集合
     */
    async deleteCollection(collection) {
      collections.delete(collection);
      store.deleteCollection(collection);
    },

    /**
     * 列出所有已知集合
     * @returns {Promise<string[]>}
     */
    async listCollections() {
      return [...collections];
    },

    /**
     * 获取集合中文档数
     */
    async count(collection) {
      return store.count(collection);
    },

    /**
     * 访问底层 store（用于兼容场景）
     */
    get _store() { return store; },
  };
}