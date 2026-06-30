/**
 * VectorStore 适配器抽象接口。
 *
 * 定义所有向量存储适配器必须实现的方法。
 * 使用鸭子类型校验而非继承，允许各适配器独立实现。
 *
 * @typedef {object} VectorStoreAdapter
 * @property {(collection: string, chunks: Array<{text:string,metadata?:object,hash:string}>, embeddings?: number[][]) => Promise<void>} insert
 * @property {(collection: string, query: string, limit?: number) => Promise<Array<{text:string,metadata?:object,score:number,hash:string}>>} searchBm25
 * @property {(collection: string, queryVector: number[], limit?: number) => Promise<Array<{text:string,metadata?:object,score:number,hash:string}>>} searchVector
 * @property {(collection: string) => Promise<void>} deleteCollection
 * @property {() => Promise<string[]>} listCollections
 * @property {(collection: string) => Promise<number>} count
 */

const REQUIRED_METHODS = [
  'insert',
  'searchBm25',
  'searchVector',
  'deleteCollection',
  'listCollections',
  'count',
];

/**
 * 校验对象是否实现了 VectorStoreAdapter 接口。
 * 仅检查方法名是否存在，不检查参数签名。
 *
 * @param {object} adapter
 * @returns {boolean}
 */
export function isValidAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') return false;
  for (const method of REQUIRED_METHODS) {
    if (typeof adapter[method] !== 'function') return false;
  }
  return true;
}

/**
 * 获取缺失的方法名列表（用于调试）
 * @param {object} adapter
 * @returns {string[]}
 */
export function getMissingMethods(adapter) {
  if (!adapter || typeof adapter !== 'object') return REQUIRED_METHODS;
  return REQUIRED_METHODS.filter(m => typeof adapter[m] !== 'function');
}