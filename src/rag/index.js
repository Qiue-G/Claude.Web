/**
 * RAG 系统入口
 *
 * 统一的初始化入口，整合：
 * - 向量存储 (vectorStore) + FTS5 BM25
 * - 嵌入 API 客户端 (embedder)
 * - 文档分块 (chunker)
 * - 双通道检索 + RRF 融合 (retrieval)
 * - 内容提取 (textExtractor, markdownSplitter)
 *
 * 使用方式：
 * ```js
 * import { createRagSystem } from '../rag/index.js';
 * const rag = await createRagSystem({ db });
 * await rag.ingest('default', '一些文本内容...', { source: 'manual' });
 * const results = await rag.search('default', '搜索关键词');
 * ```
 */
import { RecursiveCharacterTextSplitter } from './chunker.js';
import { createEmbedder } from './embedder.js';
import { createVectorStore } from './vectorStore.js';
import { hybridSearch } from './retrieval.js';
import { createDefaultRegistry } from './extractors/index.js';
import { splitMarkdown } from './extractors/markdownSplitter.js';
import { createRagMetrics } from './metrics.js';
import path from 'path';

const DEFAULT_COLLECTION = 'default';

/**
 * @typedef {object} RagSystem
 * @property {(collection: string, input: string|{ text: string, metadata?: object }|Array<string|{ text: string, metadata?: object }>, options?: object) => Promise<number>} ingest
 *   向指定集合中摄入文档。input 可以是文本字符串、{ text, metadata } 对象、或它们的数组。
 *   自动进行分块和嵌入。
 * @property {(collection: string, query: string, options?: object) => Promise<Array<{ text: string, metadata: object, score: number }>>} search
 *   在指定集合中进行混合搜索（BM25 + 向量 + RRF）。
 * @property {(filePath: string, collection?: string) => Promise<number>} ingestFile
 *   从文件路径摄入文档（自动检测 PDF / 文本 / Markdown 等格式）。
 * @property {(url: string, collection?: string) => Promise<number>} ingestUrl
 *   从 URL 摄入网页内容（自动提取正文文本）。
 * @property {(source: string|{ url: string, dataPath?: string }, collection?: string) => Promise<number>} ingestRest
 *   从 REST API 响应中摄入数据（支持 dataPath 提取指定字段）。
 * @property {(collection: string) => void} deleteCollection 删除集合
 * @property {() => number} get totalDocs 所有集合中总文档数
 * @property {() => object} get embedder 底层 embedder 实例
 * @property {() => object} get vectorStore 底层 vectorStore 实例
 * @property {() => RecursiveCharacterTextSplitter} get splitter
 * @property {() => import('./extractors/index.js').ExtractorRegistry} get registry 提取器注册表
 * @property {() => import('./metrics.js').RagMetrics} get metrics 可观测性指标收集器
 * @property {() => object} getMetricsSnapshot 全量指标快照
 */

/**
 * 创建 RAG 系统实例
 * @param {object} options
 * @param {object} [options.db]  - sql.js 数据库实例（用于 FTS5，可选）
 * @param {number} [options.dimensions=256] - 嵌入向量维度
 * @param {number} [options.chunkSize=512]  - 分块大小
 * @param {number} [options.chunkOverlap=128] - 分块重叠
 * @param {string} [options.apiKey]  - 嵌入 API Key（默认 process.env.OPENAI_API_KEY）
 * @param {string} [options.baseUrl] - 嵌入 API Base URL
 * @param {string} [options.model]   - 嵌入模型名
 * @returns {Promise<RagSystem>}
 */
export async function createRagSystem(options = {}) {
  const { db } = options;

  // ── 可观测性指标收集器 ──
  const metrics = createRagMetrics();

  // ── 初始化组件 ──
  const vectorStore = createVectorStore({
    db,
    dimensions: options.dimensions ?? 256,
  });

  const embedder = createEmbedder({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    model: options.model,
    dimensions: options.dimensions ?? 256,
    metrics,
  });

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: options.chunkSize ?? 512,
    chunkOverlap: options.chunkOverlap ?? 128,
  });

  const registry = createDefaultRegistry();

  let totalIngested = 0;
  const collectionCounts = new Map(); // collection → chunk count

  /**
   * 判断文本是否为 Markdown 格式（粗略检测）
   */
  function isMarkdown(text) {
    return /^#{1,6}\s+|```|\[.*?\]\(.*?\)|^[|].*[|]|^[-*+]\s/m.test(text);
  }

  /**
   * 将输入统一解析为文档块列表
   */
  function parseInput(input) {
    const items = Array.isArray(input) ? input : [input];
    const texts = [];

    for (const item of items) {
      if (typeof item === 'string') {
        texts.push({ text: item, metadata: {} });
      } else if (item && typeof item.text === 'string') {
        texts.push({ text: item.text, metadata: item.metadata || {} });
      }
    }

    return texts;
  }

  /**
   * 对文本进行分块，自动选择策略
   */
  function chunk(text, baseMetadata = {}) {
    let chunks;

    if (isMarkdown(text)) {
      // Markdown：使用标题感知分割 + 递归字符分割
      const mdChunks = splitMarkdown(text, {
        maxChunkSize: splitter.chunkSize * 2,
        minChunkSize: splitter.chunkSize,
      });

      if (mdChunks.length > 0) {
        // 对 Markdown 块中仍然过长的部分，用通用分割器再分
        chunks = [];
        for (const md of mdChunks) {
          if (md.text.length > splitter.chunkSize) {
            const sub = splitter.splitText(md.text, { ...baseMetadata, ...md.metadata });
            chunks.push(...sub);
          } else {
            chunks.push(md);
          }
        }
        return chunks;
      }
    }

    // 通用文本：递归字符分割
    return splitter.splitText(text, baseMetadata);
  }

  /**
   * 摄入文档
   * @param {string} collection - 集合名（如 sessionId）
   * @param {string|{text:string,metadata?:object}|Array} input
   * @param {object} [ingestOptions]
   * @param {boolean} [ingestOptions.skipEmbedding=false] - 跳过嵌入（仅建 FTS5 索引）
   * @returns {Promise<number>} 摄入的块数
   */
  async function ingest(collection, input, ingestOptions = {}) {
    const skipEmbedding = ingestOptions.skipEmbedding ?? false;

    // 1. 解析输入为文本列表
    const texts = parseInput(input);
    if (texts.length === 0) return 0;

    // 2. 分块
    const allChunks = [];
    for (const { text, metadata } of texts) {
      const chunks = chunk(text, metadata);
      allChunks.push(...chunks);
    }

    if (allChunks.length === 0) return 0;

    // 3. 生成嵌入
    let embeddings = null;
    if (!skipEmbedding) {
      try {
        const chunkTexts = allChunks.map(c => c.text);
        embeddings = await embedder.embedDocuments(chunkTexts);
      } catch (e) {
        console.warn('[RAG] Embedding failed, falling back to text-only ingest:', e.message);
        // 嵌入失败时只做文本索引
      }
    }

    // 4. 写入向量存储
    await vectorStore.insert(collection, allChunks, embeddings);
    totalIngested += allChunks.length;
    collectionCounts.set(collection, (collectionCounts.get(collection) || 0) + allChunks.length);

    // 记录摄入指标
    metrics.recordIngest(allChunks.length);

    return allChunks.length;
  }

  /**
   * 从文件路径摄入文档（支持 PDF / 文本 / Markdown 等格式）
   * @param {string} filePath - 文件的绝对路径
   * @param {string} [collection=DEFAULT_COLLECTION]
   * @param {object} [metadata={}] - 文件级附加元数据
   * @returns {Promise<number>} 摄入的块数
   */
  async function ingestFile(filePath, collection = DEFAULT_COLLECTION, metadata = {}) {
    const filename = path.basename(filePath);
    const baseMeta = { ...metadata, filename, source: filePath };

    const result = await registry.extract({ type: 'file', source: filePath });

    if (result.metadata.error) {
      throw new Error(`文件提取失败 [${filename}]: ${result.metadata.error}`);
    }

    return ingest(collection, { text: result.content, metadata: baseMeta });
  }

  /**
   * 从 URL 摄入网页内容
   * @param {string} url - 网页 URL
   * @param {string} [collection=DEFAULT_COLLECTION]
   * @param {object} [metadata={}]
   * @returns {Promise<number>} 摄入的块数
   */
  async function ingestUrl(url, collection = DEFAULT_COLLECTION, metadata = {}) {
    const baseMeta = { ...metadata, source: url };

    const result = await registry.extract({ type: 'url', source: url });

    if (result.metadata.error) {
      throw new Error(`URL 提取失败 [${url}]: ${result.metadata.error}`);
    }

    return ingest(collection, { text: result.content, metadata: baseMeta });
  }

  /**
   * 从 REST API 摄入数据
   * @param {string|{ url: string, dataPath?: string }} source - URL 或 { url, dataPath } 对象
   * @param {string} [collection=DEFAULT_COLLECTION]
   * @param {object} [metadata={}]
   * @returns {Promise<number>} 摄入的块数
   */
  async function ingestRest(source, collection = DEFAULT_COLLECTION, metadata = {}) {
    const url = typeof source === 'string' ? source : source.url;
    const baseMeta = { ...metadata, source: url };

    const result = await registry.extract({ type: 'rest', source });

    if (result.metadata.error) {
      throw new Error(`REST 提取失败 [${url}]: ${result.metadata.error}`);
    }

    return ingest(collection, { text: result.content, metadata: baseMeta });
  }

  /**
   * 混合搜索
   * @param {string} collection - 集合名
   * @param {string} query - 搜索查询
   * @param {object} [options]
   * @param {number} [options.topK=5]
   * @param {number} [options.bm25Weight=0.3]
   * @param {boolean} [options.enableRerank=false]
   * @returns {Promise<Array<{ text: string, metadata: object, score: number }>>}
   */
  async function search(collection, query, options = {}) {
    return hybridSearch(vectorStore, embedder, collection, query, { ...options, metrics });
  }

  /**
   * 删除集合
   */
  function deleteCollection(collection) {
    const count = collectionCounts.get(collection) || 0;
    vectorStore.deleteCollection(collection);
    totalIngested -= count;
    collectionCounts.delete(collection);
  }

  return {
    ingest,
    ingestFile,
    ingestUrl,
    ingestRest,
    search,
    deleteCollection,
    get totalDocs() { return totalIngested; },
    get embedder() { return embedder; },
    get vectorStore() { return vectorStore; },
    get splitter() { return splitter; },
    get registry() { return registry; },
    get metrics() { return metrics; },
    getMetricsSnapshot() { return metrics.getSnapshot(); },
  };
}