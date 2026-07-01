/**
 * RAG API 调用封装
 *
 * 集合管理、文档上传、搜索、指标查询
 */
import { api } from '$lib/api.js';

/**
 * 列出所有 RAG 集合
 * @param {string} sessionToken
 * @param {string} [sessionId]
 * @returns {Promise<{ collections: string[], totalDocs: number }>}
 */
export function listCollections(sessionToken, sessionId) {
  return api.get('/api/rag/collections', {
    token: sessionToken,
    headers: sessionId ? { 'x-session-id': sessionId } : undefined,
  });
}

/**
 * 获取 RAG 系统状态
 * @param {string} sessionToken
 * @param {string} [sessionId]
 * @returns {Promise<object>}
 */
export function getRagStatus(sessionToken, sessionId) {
  return api.get('/api/rag/status', {
    token: sessionToken,
    headers: sessionId ? { 'x-session-id': sessionId } : undefined,
  });
}

/**
 * 上传文本到 RAG 集合
 * @param {object} params
 * @param {string} params.text
 * @param {string} [params.collection]
 * @param {object} [params.metadata]
 * @param {string} params.sessionId
 * @param {string} params.token
 * @param {string} params.csrfToken
 * @returns {Promise<object>}
 */
export function ingestText({ text, collection, metadata, sessionId, token, csrfToken }) {
  return api.post('/api/rag/ingest', { sessionId, text, collection, metadata }, { token, csrfToken });
}

/**
 * 上传 base64 文件到 RAG 集合
 * @param {object} params
 * @param {string} params.filename
 * @param {string} params.content - base64 content
 * @param {string} [params.collection]
 * @param {object} [params.metadata]
 * @param {string} params.sessionId
 * @param {string} params.token
 * @param {string} params.csrfToken
 * @returns {Promise<object>}
 */
export function ingestFile({ filename, content, collection, metadata, sessionId, token, csrfToken }) {
  return api.post('/api/rag/ingest', { sessionId, filename, content, collection, metadata }, { token, csrfToken });
}

/**
 * 从 URL 摄入
 * @param {object} params
 * @param {string} params.url
 * @param {string} [params.collection]
 * @param {object} [params.metadata]
 * @param {string} params.sessionId
 * @param {string} params.token
 * @param {string} params.csrfToken
 * @returns {Promise<object>}
 */
export function ingestUrl({ url, collection, metadata, sessionId, token, csrfToken }) {
  return api.post('/api/rag/ingest/url', { sessionId, url, collection, metadata }, { token, csrfToken });
}

/**
 * 从 REST API 摄入
 * @param {object} params
 * @param {string} params.url
 * @param {string} [params.dataPath]
 * @param {string} [params.collection]
 * @param {object} [params.metadata]
 * @param {string} params.sessionId
 * @param {string} params.token
 * @param {string} params.csrfToken
 * @returns {Promise<object>}
 */
export function ingestRest({ url, dataPath, collection, metadata, sessionId, token, csrfToken }) {
  return api.post('/api/rag/ingest/rest', { sessionId, url, dataPath, collection, metadata }, { token, csrfToken });
}

/**
 * 搜索 RAG 集合
 * @param {object} params
 * @param {string} params.query
 * @param {string} [params.collection]
 * @param {number} [params.topK]
 * @param {number} [params.bm25Weight]
 * @param {boolean} [params.enableRerank]
 * @param {boolean} [params.enableCrossEncoder]
 * @param {boolean} [params.enableEnrichment]
 * @param {object} [params.rewriteConfig]
 * @param {object} [params.rerankConfig]
 * @param {string} params.sessionId
 * @param {string} params.token
 * @returns {Promise<object>}
 */
export function searchRag({ query, collection, topK, bm25Weight, enableRerank, enableCrossEncoder, enableEnrichment, rewriteConfig, rerankConfig, sessionId, token, csrfToken }) {
  return api.post('/api/rag/search', { sessionId, query, collection, topK, bm25Weight, enableRerank, enableCrossEncoder, enableEnrichment, rewriteConfig, rerankConfig }, { token, csrfToken });
}

/**
 * 删除 RAG 集合
 * @param {string} collectionName
 * @param {string} sessionId
 * @param {string} token
 * @param {string} csrfToken
 * @returns {Promise<object>}
 */
export function deleteCollection(collectionName, sessionId, token, csrfToken) {
  return api.delete(`/api/rag/collection/${encodeURIComponent(collectionName)}`, { token, csrfToken, headers: { 'x-session-id': sessionId } });
}

/**
 * 获取 RAG 指标
 * @param {string} sessionToken
 * @returns {Promise<object>}
 */
export function getRagMetrics(sessionToken) {
  return api.get('/api/rag/metrics', { token: sessionToken });
}