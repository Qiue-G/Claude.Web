/**
 * RAG API 路由
 *
 * POST   /api/rag/ingest       — 上传文档到知识库（文本或 base64 文件）
 * POST   /api/rag/ingest/url   — 从 URL 摄入文档
 * POST   /api/rag/ingest/rest  — 从 REST API 摄入数据
 * POST   /api/rag/search       — 搜索知识库
 * GET    /api/rag/status        — 查询 RAG 系统状态
 * GET    /api/rag/collections   — 列出所有集合
 * DELETE /api/rag/collection/:name — 删除指定集合
 *
 * 所有写操作需要 session token 认证和 CSRF token 保护。
 */
import { Router } from 'express';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { asyncHandler } from '../lib/asyncHandler.js';
import { AppError } from '../lib/AppError.js';
import { validateUrl } from '../lib/urlValidator.js';

export function createRagRouter(deps) {
  const { rag, sessions } = deps;
  const router = Router();

  function getSessionCollection(session, requestedCollection) {
    const requested = typeof requestedCollection === 'string' ? requestedCollection.trim() : '';
    if (!requested || requested === session.id) return session.id;
    return `${session.id}:${requested}`;
  }

  // ===== CSRF protection for write operations =====
  router.use((req, res, next) => {
    if (req.method === 'GET') return next();

    let sessionId = req.headers['x-session-id'];
    let token = req.headers['x-session-token'];

    // Also check body
    if (!sessionId && req.body?.sessionId) sessionId = req.body.sessionId;

    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session) throw new AppError(401, 'Invalid session');
    req.session = session;

    // Token validation
    if (token && token !== session.token) {
      throw new AppError(403, 'Session token mismatch');
    }

    // CSRF validation for mutating requests — 独立于 token 校验，双层防护
    if (req.method !== 'GET') {
      const csrfToken = req.headers['x-csrf-token'];
      if (!csrfToken || csrfToken !== session.csrfToken) {
        throw new AppError(403, 'CSRF token missing or invalid');
      }
    }

    next();
  });

  /**
   * POST /api/rag/ingest
   * 上传文档到知识库
   *
   * 文本模式 Body:
   *   { sessionId, text, collection?, metadata? }
   *
   * 文件模式 Body:
   *   { sessionId, filename, content: "base64...", collection?, metadata? }
   */
  router.post('/ingest', asyncHandler(async (req, res) => {
    if (!rag) throw new AppError(503, 'RAG system not initialized');

    const collection = getSessionCollection(req.session, req.body.collection);
    const metadata = req.body.metadata
      ? (typeof req.body.metadata === 'string' ? JSON.parse(req.body.metadata) : req.body.metadata)
      : {};

    let chunksCount = 0;

    // ── 文件模式（base64） ──
    if (req.body.filename && req.body.content) {
      const filename = req.body.filename;
      const tmpDir = join(process.cwd(), '.rag-uploads');
      await mkdir(tmpDir, { recursive: true });
      const tmpPath = join(tmpDir, randomUUID() + '-' + filename);

      try {
        const buffer = Buffer.from(req.body.content, 'base64');
        await writeFile(tmpPath, buffer);
        chunksCount = await rag.ingestFile(tmpPath, collection, metadata);
      } finally {
        await unlink(tmpPath).catch(() => {});
      }
    }
    // ── 文本模式 ──
    else if (req.body.text && typeof req.body.text === 'string' && req.body.text.trim()) {
      chunksCount = await rag.ingest(collection, { text: req.body.text, metadata });
    } else {
      throw new AppError(400, 'No content provided. Send text / { filename + content (base64) } in the request body.');
    }

    res.json({
      success: true,
      collection,
      chunksIngested: chunksCount,
      totalDocs: rag.totalDocs,
    });
  }));

  /**
   * POST /api/rag/ingest/url
   * 从 URL 摄入网页内容
   * Body: { sessionId, url, collection?, metadata? }
   */
  router.post('/ingest/url', asyncHandler(async (req, res) => {
    if (!rag) throw new AppError(503, 'RAG system not initialized');

    const { url } = req.body;
    if (!url) throw new AppError(400, 'URL is required');

    // URL 安全验证
    const urlCheck = validateUrl(url);
    if (!urlCheck.valid) {
      throw new AppError(400, `URL validation failed: ${urlCheck.error}`, { code: 'invalid_url' });
    }

    const collection = getSessionCollection(req.session, req.body.collection);
    const metadata = req.body.metadata
      ? (typeof req.body.metadata === 'string' ? JSON.parse(req.body.metadata) : req.body.metadata)
      : {};

    const chunksCount = await rag.ingestUrl(url, collection, metadata);

    res.json({
      success: true,
      collection,
      source: url,
      chunksIngested: chunksCount,
      totalDocs: rag.totalDocs,
    });
  }));

  /**
   * POST /api/rag/ingest/rest
   * 从 REST API 摄入数据
   * Body: { sessionId, url, dataPath?, collection?, metadata? }
   */
  router.post('/ingest/rest', asyncHandler(async (req, res) => {
    if (!rag) throw new AppError(503, 'RAG system not initialized');

    const { url, dataPath } = req.body;
    if (!url) throw new AppError(400, 'url is required');

    // URL 安全验证
    const urlCheck = validateUrl(url);
    if (!urlCheck.valid) {
      throw new AppError(400, `URL validation failed: ${urlCheck.error}`, { code: 'invalid_url' });
    }

    const collection = getSessionCollection(req.session, req.body.collection);
    const metadata = req.body.metadata
      ? (typeof req.body.metadata === 'string' ? JSON.parse(req.body.metadata) : req.body.metadata)
      : {};

    const source = dataPath ? { url, dataPath } : url;
    const chunksCount = await rag.ingestRest(source, collection, metadata);

    res.json({
      success: true,
      collection,
      source: url,
      dataPath: dataPath || null,
      chunksIngested: chunksCount,
      totalDocs: rag.totalDocs,
    });
  }));

  /**
   * POST /api/rag/search
   * 搜索知识库
   * Body: { sessionId, query, collection?, topK?, bm25Weight?, enableRerank?, enableCrossEncoder?, enableEnrichment?, rewriteConfig?, rerankConfig? }
   */
  router.post('/search', asyncHandler(async (req, res) => {
    if (!rag) throw new AppError(503, 'RAG system not initialized');

    const query = req.body.query;
    if (!query || typeof query !== 'string' || !query.trim()) {
      throw new AppError(400, 'query is required');
    }

    const collection = getSessionCollection(req.session, req.body.collection);

    const results = await rag.search(collection, query.trim(), {
      topK: Math.min(req.body.topK ?? 5, 50),
      bm25Weight: req.body.bm25Weight ?? 0.3,
      enableRerank: req.body.enableRerank ?? false,
      enableCrossEncoder: req.body.enableCrossEncoder ?? false,
      enableEnrichment: req.body.enableEnrichment ?? true,
      rewriteConfig: req.body.rewriteConfig,
      rerankConfig: req.body.rerankConfig,
    });

    res.json({
      success: true,
      collection,
      query: query.trim(),
      resultCount: results.length,
      results: results.map(r => ({
        text: r.text,
        score: r.score,
        metadata: r.metadata || {},
      })),
    });
  }));

  /**
   * GET /api/rag/status
   * 查询 RAG 系统状态
   */
  router.get('/status', asyncHandler(async (req, res) => {
    // 可选 session 验证：前端带 session 信息时就校验
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;
    const token = req.headers['x-session-token'];
    if (sessionId || token) {
      const session = sessions.get(sessionId);
      if (!session || (token && token !== session.token)) {
        throw new AppError(401, 'Invalid session');
      }
    }

    const enabled = !!rag;
    const metrics = enabled ? rag.metrics : null;
    res.json({
      enabled,
      totalDocs: enabled ? rag.totalDocs : 0,
      embedderModel: enabled ? rag.embedder.model : null,
      embeddingDimensions: enabled ? rag.embedder.dimensions : null,
      collections: [], // 如需可扩展
      // 指标摘要（仅含计数，不含详细分布）
      metricsSummary: enabled && metrics ? {
        totalSearches: metrics.getSearchStats().count,
        avgSearchLatencyMs: metrics.getSearchStats().avgLatencyMs,
        totalEmbedCalls: metrics.getEmbedStats().totalCalls,
        embedSuccessRate: metrics.getEmbedStats().successRate,
        embedCacheHitRate: metrics.getEmbedStats().cacheHitRate,
        totalIngestCalls: metrics.getIngestStats().totalIngestCalls,
        totalChunksIngested: metrics.getIngestStats().totalChunksIngested,
      } : null,
    });
  }));

  /**
   * GET /api/rag/collections
   * 列出所有集合（需传入 sessionId）
   */
  router.get('/collections', asyncHandler(async (req, res) => {
    if (!rag) throw new AppError(503, 'RAG system not initialized');

    // 可选 session 验证
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;
    const token = req.headers['x-session-token'];
    if (sessionId || token) {
      const session = sessions.get(sessionId);
      if (!session || (token && token !== session.token)) {
        throw new AppError(401, 'Invalid session');
      }
    }

    let collections = [];
    try {
      collections = await rag.vectorStore.listCollections();
    } catch {
      // listCollections 失败时返回空数组
    }

    res.json({
      success: true,
      collections,
      totalDocs: rag.totalDocs,
    });
  }));

  /**
   * GET /api/rag/metrics
   * 获取 RAG 系统可观测性指标
   */
  router.get('/metrics', asyncHandler(async (req, res) => {
    if (!rag) throw new AppError(503, 'RAG system not initialized');

    const snapshot = rag.getMetricsSnapshot();
    res.json({
      success: true,
      ...snapshot,
    });
  }));

  /**
   * DELETE /api/rag/collection/:name
   * 删除指定集合
   */
  router.delete('/collection/:name', asyncHandler(async (req, res) => {
    if (!rag) throw new AppError(503, 'RAG system not initialized');
    const { name } = req.params;
    if (!name || name === '') throw new AppError(400, 'Collection name required');

    await rag.deleteCollection(name);
    res.json({ success: true, collection: name });
  }));

  return router;
}