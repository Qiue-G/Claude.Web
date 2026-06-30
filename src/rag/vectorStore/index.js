/**
 * VectorStore 适配器工厂
 *
 * 根据 VECTOR_STORE_TYPE 环境变量选择适配器：
 *   - 'memory' （默认）：内存向量索引 + sql.js 全文表
 *   - 'qdrant'         ：Qdrant HTTP API
 *
 * 用法：
 * ```js
 * import { createVectorStoreAdapter } from './vectorStore/index.js';
 * const store = await createVectorStoreAdapter({ db });
 * ```
 */
import { isValidAdapter, getMissingMethods } from './adapter.js';
import { createMemoryAdapter } from './adapters/memory.js';
import { createQdrantAdapter } from './adapters/qdrant.js';

const ADAPTER_TYPES = ['memory', 'qdrant'];

/**
 * 创建 VectorStore 适配器实例
 *
 * @param {object} options
 * @param {object} [options.db] - sql.js 数据库实例（memory 模式需要）
 * @param {number} [options.dimensions=256]
 * @param {string} [options.type] - 适配器类型，默认从 VECTOR_STORE_TYPE 环境变量读取
 * @param {string} [options.qdrantUrl] - Qdrant 服务地址
 * @param {string} [options.qdrantApiKey] - Qdrant API Key
 * @returns {Promise<import('./adapter.js').VectorStoreAdapter>}
 */
export async function createVectorStoreAdapter(options = {}) {
  const type = options.type || process.env.VECTOR_STORE_TYPE || 'memory';
  const dimensions = options.dimensions ?? 256;

  if (!ADAPTER_TYPES.includes(type)) {
    console.warn(`[VECTOR_STORE] Unknown type "${type}", falling back to "memory"`);
    return createMemoryAdapter({ db: options.db, dimensions });
  }

  let adapter;

  switch (type) {
    case 'qdrant':
      adapter = createQdrantAdapter({
        url: options.qdrantUrl,
        apiKey: options.qdrantApiKey,
        dimensions,
      });
      break;

    case 'memory':
    default:
      adapter = createMemoryAdapter({ db: options.db, dimensions });
      break;
  }

  // 校验适配器完整性
  if (!isValidAdapter(adapter)) {
    const missing = getMissingMethods(adapter).join(', ');
    throw new Error(`VectorStore adapter "${type}" is missing methods: ${missing}`);
  }

  console.log(`[VECTOR_STORE] Using "${type}" adapter (${dimensions}d)`);
  return adapter;
}

export { isValidAdapter, getMissingMethods, ADAPTER_TYPES };
export { createMemoryAdapter } from './adapters/memory.js';
export { createQdrantAdapter } from './adapters/qdrant.js';