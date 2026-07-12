import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { randomUUID } from 'crypto';
import { join, dirname as pathDirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { createSessionRouter } from './routes/sessionRoutes.js';
import { createModelRouter } from './routes/modelRoutes.js';
import { createHealthRouter } from './routes/healthRoutes.js';
import { createConfigRouter } from './routes/configRoutes.js';
import { createSearchRouter } from './routes/searchRoutes.js';
import { createFileRouter } from './routes/fileRoutes.js';
import { createRagRouter } from './routes/ragRoutes.js';
import { createAdminRouter } from './routes/adminRoutes.js';
import { createTemplateRouter } from './routes/templateRoutes.js';
import { createSwaggerRouter } from './swagger.js';
import { createUserRouter } from './auth/userRoutes.js';
import { createVersionRouter } from './routes/versionRoutes.js';
import { getToolDefinitions } from './tools/registry.js';
import { AppError } from './lib/AppError.js';
import { logger } from './lib/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = pathDirname(__filename);

export function createApp(deps) {
  const app = express();

  // Security headers (helmet)
  const isProd = process.env.NODE_ENV === 'production';
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: isProd
          ? ["'self'"]
          : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "ws:", "wss:", "https:"],
        frameAncestors: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: null, // Disable to allow HTTP in development
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  // Strict CORS
  app.use(cors({
    origin: deps.ALLOWED_ORIGINS,
    credentials: true,
    maxAge: 86400,
  }));

  // Response compression (gzip + brotli via Node.js zlib)
  app.use(compression({
    level: 6,          // default compression level
    threshold: 1024,   // only compress responses > 1KB
    filter: (req, res) => {
      // Don't compress server-sent events
      if (req.headers.accept === 'text/event-stream') return false;
      return compression.filter(req, res);
    }
  }));

  app.use(express.json({ limit: '500kb' }));

  // ===== Request ID tracing =====
  app.use((req, res, next) => {
    const reqId = req.headers['x-request-id'] || randomUUID();
    req.requestId = reqId;
    res.setHeader('X-Request-Id', reqId);
    const start = Date.now();
    res.on('finish', () => {
      const elapsed = Date.now() - start;
      if (req.path !== '/api/health' && req.path !== '/api/perf') {
        logger.info('request', { method: req.method, path: req.path, status: res.statusCode, ms: elapsed, reqId });
      }
    });
    next();
  });

  app.use(express.static(join(__dirname, '../../public'), {
    setHeaders: (res, path) => {
      // Hash-named assets (e.g., index-CauHM6Nt.js) can be cached indefinitely
      if (path.match(/[a-f0-9]{8,}\.(js|css|png|jpg|svg|woff2?)$/i)) {
        res.setHeader('Cache-Control', 'public, immutable, max-age=31536000');
      } else {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('X-XSS-Protection', '0');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    }
  }));

  // ===== Performance Metrics Middleware (auto-record API latency) =====
  app.use(deps.perfMetrics.middleware());

  // ===== Performance Metrics API =====
  app.get('/api/perf', (req, res) => {
    res.json(deps.perfMetrics.snapshot());
  });

  // ===== Cache headers for stable API endpoints =====
  app.use(['/api/tools', '/api/config', '/api/models'], (req, res, next) => {
    if (req.method === 'GET') {
      const maxAge = req.path.startsWith('/tools') ? 300
        : req.path.startsWith('/config') ? 60
        : 120;
      res.setHeader('Cache-Control', `public, max-age=${maxAge}`);
    }
    next();
  });

  // ===== Session API ====
  app.set('activityLog', deps.activityLog);
  app.use('/api/session', createSessionRouter({
    createSession: deps.createSession,
    getSession: deps.getSession,
    deleteSession: deps.deleteSession,
    sessions: deps.sessions,
    sessionProcesses: deps.sessionProcesses,
    sessionProxies: deps.sessionProxies,
    messageStore: deps.messageStore,
    checkRateLimit: deps.checkRateLimit,
    RATE_WINDOW: deps.RATE_WINDOW,
    RATE_MAX_CREATE: deps.RATE_MAX_CREATE,
    MAX_SESSIONS: deps.MAX_SESSIONS,
    DEFAULTS: deps.DEFAULTS,
    agentConfig: deps.agentConfig,
    db: deps.db
  }));

  // ===== Model Discovery API ====
  app.locals.agentConfig = deps.agentConfig;
  app.use('/api/models', createModelRouter({ getProviderConfig: deps.getProviderConfig, DEFAULTS: deps.DEFAULTS, agentConfig: deps.agentConfig }));

  // ===== Health API ====
  app.use('/api/health', createHealthRouter({
    sessions: deps.sessions,
    PROVIDERS: deps.PROVIDERS,
    DEFAULTS: deps.DEFAULTS,
    MAX_SESSIONS: deps.MAX_SESSIONS,
    sessionProxies: deps.sessionProxies,
    modelStats: deps.modelStats,
    rateLimits: { snapshot: deps.rateLimitsSnapshot },
    RATE_MAX_CREATE: deps.RATE_MAX_CREATE,
    VERSION: deps.VERSION,
    allowDetailedHealth: process.env.ENABLE_DETAILED_HEALTH === 'true',
    mcpManager: deps.mcpManager,
    rag: deps.rag,
    db: deps.db
  }));

  // ===== Config & Tools API ====
  app.use('/api', createConfigRouter({ getToolDefinitions, PROVIDERS: deps.PROVIDERS, DEFAULTS: deps.DEFAULTS, VERSION: deps.VERSION, mcpManager: deps.mcpManager, agentConfig: deps.agentConfig }));

  // ===== Search API ====
  app.use('/api/search', createSearchRouter({ db: deps.db }));

  // ===== File API ====
  app.use('/api/files', createFileRouter({ getSession: deps.getSession, sessions: deps.sessions, checkRateLimit: deps.checkRateLimit, RATE_WINDOW: deps.RATE_WINDOW, RATE_MAX_FILE: 60, db: deps.db }));

  // ===== RAG API ====
  app.use('/api/rag', createRagRouter({ rag: deps.rag, sessions: deps.sessions }));

  // ===== Admin API (protected by ADMIN_TOKEN) ====
  app.use('/api/admin', createAdminRouter({
    sessions: deps.sessions,
    sessionProcesses: deps.sessionProcesses,
    sessionProxies: deps.sessionProxies,
    modelStats: deps.modelStats,
    mcpManager: deps.mcpManager,
    rag: deps.rag,
    db: deps.db,
    auditLog: deps.auditLog,
    processPool: deps.processPool,
    monitor: deps.monitor
  }));

  // ===== Prompt Template API ====
  app.use('/api/templates', createTemplateRouter());

  // ===== Swagger API Docs =====
  app.use('/api', createSwaggerRouter());

  // ===== User Authentication API =====
  app.use('/api/auth', createUserRouter({ db: deps.db, createSession: deps.createSession }));

  // ===== Version History API (T5) =====
  app.use('/api', createVersionRouter({ db: deps.db, getSession: deps.getSession, saveDb: deps.saveDb }));

  // ===== SPA fallback: serve index.html for non-API routes =====
  app.get('*', (req, res) => {
    const indexPath = join(__dirname, '../../public/index.html');
    if (existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(503).json({ error: 'Frontend not built yet. Run: npm run build' });
    }
  });

  // ===== Error handler (must be 4-param to be recognized by Express) =====
  app.use((err, req, res, next) => {
    // AppError — structured errors from route handlers
    if (err instanceof AppError) {
      logger.error('AppError', { status: err.status, message: err.message, code: err.extra?.code || '' });
      return res.status(err.status).json(err.toJSON());
    }

    // Express body-parser: payload too large
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'File too large (max 500KB)', code: 'payload_too_large' });
    }

    // Unknown errors
    logger.error('Unhandled error', { message: err.message, stack: err.stack || undefined });
    res.status(500).json({ error: 'Internal server error', code: 'internal_error' });
  });

  return app;
}
