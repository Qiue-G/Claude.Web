import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve as pathResolve } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname as pathDirname } from 'path';
import { searchWeb } from './tools/webSearch.js';
import { executePython, extractPythonBlocks } from './tools/codeInterpreter.js';
import { getToolDefinitions, getToolInstructions } from './tools/registry.js';
import { analyzeFilesFromPromptContext, stripFileBlocksFromPrompt } from './tools/fileAnalysis.js';
import { buildPrompt } from './runtime/promptBuilder.js';
import { createFileRouter } from './routes/fileRoutes.js';
import { createWsHandler } from './routes/wsHandler.js';
import { createSessionManager } from './sessionManager.js';
import { createMessageStore } from './messageStore.js';
import { initDb } from './db.js';
import { createMcpManager } from './mcp/index.js';
import { createRateLimiter } from './lib/rateLimiter.js';
import { createModelStats } from './lib/modelStats.js';
import { createSessionRouter } from './routes/sessionRoutes.js';
import { createModelRouter } from './routes/modelRoutes.js';
import { createHealthRouter } from './routes/healthRoutes.js';
import { createConfigRouter } from './routes/configRoutes.js';
import { createSearchRouter } from './routes/searchRoutes.js';
import { createRagRouter } from './routes/ragRoutes.js';
import { createAdminRouter } from './routes/adminRoutes.js';
import { createAuditLog } from './lib/auditLog.js';
import { createRagSystem } from '../rag/index.js';
import { createSwaggerRouter } from './swagger.js';
import { AppError } from './lib/AppError.js';
import { logger } from './lib/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = pathDirname(__filename);

try {
  const envContent = await readFile('.env', 'utf-8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    // 跳过空行和注释
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) return;
    let key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // 去除引号
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) process.env[key] = value;
  });
} catch (e) {}

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || join(__dirname, '../../workspace');
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '10');
const FREE_CODE_DIR = process.env.FREE_CODE_DIR || (process.platform === 'win32' ? join(__dirname, '../..') : '/free-code');
const CONFIG_PATH = process.env.AGENT_CONFIG_PATH || join(FREE_CODE_DIR, 'agent-config.json');
const VERSION = '7.3.2';

// ===== Load agent config =====
let agentConfig = { defaults: { provider: 'openrouter', model: '' }, providers: {} };
try {
  const raw = await readFile(CONFIG_PATH, 'utf-8');
  agentConfig = JSON.parse(raw);
  logger.info('Config loaded', { providers: Object.keys(agentConfig.providers || {}).length });
} catch (e) {
  logger.warn('Using built-in defaults', { error: e.message });
}

const DEFAULTS = agentConfig.defaults || { provider: 'openrouter', model: '' };
const PROVIDERS = agentConfig.providers || {};

function getProviderConfig(provider) {
  return PROVIDERS[provider] || PROVIDERS[DEFAULTS.provider] || { models: [], fallbackModel: null, modelAliases: {} };
}

function resolveOpenRouterModel(model) {
  const aliases = (PROVIDERS.openrouter || {}).modelAliases || {};
  return aliases[model] || model;
}

function getFallbackModel(provider) {
  return (PROVIDERS[provider] || {}).fallbackModel || null;
}

// ===== Rate Limiter (token bucket, per-IP) =====
const RATE_WINDOW = 60000;      // 1 minute window
const RATE_MAX_CREATE = 5;      // max session creates per window per IP
const RATE_MAX_INPUT = 20;      // max WebSocket inputs per window per session
const { check: checkRateLimit, remaining: getRateRemaining, snapshot: rateLimitsSnapshot } = createRateLimiter(RATE_WINDOW);

// ===== Database (SQLite) =====
const { db, monitor, saveDb } = await initDb(WORKSPACE_DIR);

// ===== Performance Metrics ====
const { PerfMetrics } = await import('./lib/perfMetrics.js');
const perfMetrics = new PerfMetrics();

// ===== Process Pool (E3) =====
const { ProcessPool } = await import('./lib/processPool.js');
const processPool = new ProcessPool({ maxSize: 8, idleTimeout: 300000, maxPerSession: 2 });

// ===== Audit Log (D3) =====
const auditLog = createAuditLog(db);

// ===== Session Manager (persisted to SQLite) =====
const { sessions, createSession, getSession, deleteSession, loadSessions } = createSessionManager({ db, saveDb, workspaceDir: WORKSPACE_DIR, auditLog });

// ===== Message Store (persisted to SQLite) =====
const messageStore = createMessageStore({ db, monitor, saveDb });

// ===== MCP Manager =====
const mcpConfigs = [];
if (agentConfig.mcpServers && Array.isArray(agentConfig.mcpServers)) {
  mcpConfigs.push(...agentConfig.mcpServers);
}
// Also support MCP_SERVERS env var as JSON override
try {
  if (process.env.MCP_SERVERS) {
    const envServers = JSON.parse(process.env.MCP_SERVERS);
    if (Array.isArray(envServers)) mcpConfigs.push(...envServers);
  }
} catch (e) {
  logger.warn('Failed to parse MCP_SERVERS env', { error: e.message });
}
const mcpManager = createMcpManager();
if (mcpConfigs.length > 0) {
  mcpManager.connectServers(mcpConfigs).then(() => {
    logger.info('MCP servers connected', { count: mcpManager.getServerNames().length });
  });
} else {
  logger.info('No MCP servers configured');
}

// ===== RAG System =====
const rag = await createRagSystem({
  db,
  apiKey: process.env.OPENAI_API_KEY,
  baseUrl: process.env.OPENAI_BASE_URL,
  model: process.env.RAG_EMBEDDING_MODEL || 'text-embedding-3-small',
  dimensions: parseInt(process.env.RAG_EMBEDDING_DIMENSIONS || '256'),
  chunkSize: parseInt(process.env.RAG_CHUNK_SIZE || '512'),
  chunkOverlap: parseInt(process.env.RAG_CHUNK_OVERLAP || '128'),
  vectorStoreType: process.env.VECTOR_STORE_TYPE || 'memory',
  qdrantUrl: process.env.VECTOR_STORE_QDRANT_URL,
  qdrantApiKey: process.env.VECTOR_STORE_QDRANT_API_KEY,
});
logger.info('RAG system initialized', { dimensions: rag.embedder.dimensions });

const sessionProcesses = new Map();
const sessionProxies = new Map(); // proxy processes
const wsProcCount = new Map();    // active process count per session
const sessionClients = new Map(); // sessionId → WebSocket (for model health push)

// ===== 全局进程资源限制 =====
const GLOBAL_PROCESS_LIMIT = parseInt(process.env.MAX_GLOBAL_PROCESSES || '8');
let globalProcessCount = 0;
const PROCESS_TIMEOUT = parseInt(process.env.PROCESS_TIMEOUT || '300000'); // 5 分钟

// ===== Per-model stream health stats =====
const modelStats = createModelStats();

function stripAnsi(str) {
  str = str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  str = str.replace(/\x1b\][^\x07]*\x07/g, '');
  str = str.replace(/\x1b\[[?]\d+[hl]/g, '');
  str = str.replace(/\x1b\[\d+;\d+[A-H]/g, '');
  str = str.replace(/\x1b\[(\d+)C/g, (_, n) => ' '.repeat(parseInt(n)));
  return str;
}

// 白名单方式构建子进程环境变量，避免泄露全部 process.env
function buildSafeEnv(extraVars = {}) {
  const SAFE_KEYS = ['PATH', 'HOME', 'TMP', 'TEMP', 'NODE_PATH', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE'];
  const safeEnv = {};
  for (const key of SAFE_KEYS) {
    if (process.env[key]) safeEnv[key] = process.env[key];
  }
  return { ...safeEnv, ...extraVars };
}

// Push model health updates to connected WebSocket clients
function notifyModelUpdate(session) {
  broadcastToSession(session.id, {
    type: 'model_update',
    model: session.currentModel,
    health: session.modelHealth
  });
}

// Send message to all connected WebSocket clients for a session
function broadcastToSession(sessionId, message) {
  const clients = sessionClients.get(sessionId);
  if (!clients) return;
  const data = JSON.stringify(message);
  clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(data);
    }
  });
}

// --- API Key masking for terminal output ---
function maskSensitive(text, apiKey) {
  if (!apiKey || apiKey.length < 12) return text;
  const masked = apiKey.substring(0, 8) + '***' + apiKey.substring(apiKey.length - 4);
  return text.split(apiKey).join(masked);
}

async function startProxy(session) {
  const proxyPath = join(FREE_CODE_DIR, 'or_proxy.mjs');
  const model = session.provider === 'openrouter'
    ? resolveOpenRouterModel(session.model || DEFAULTS.model)
    : (session.model || DEFAULTS.model || 'deepseek-chat');
  const fallback = getFallbackModel(session.provider);
  logger.info('Starting proxy', { model, fallback });

  const proxyArgs = [proxyPath, '--model', model];
  if (session.provider === 'deepseek') {
    proxyArgs.push('--base-url', 'https://api.deepseek.com/v1');
  }
  if (fallback && fallback !== model) {
    proxyArgs.push('--fallback-model', fallback);
  }

  const proxy = spawn('node', proxyArgs, {
    cwd: session.dir,
    env: buildSafeEnv({ ANTHROPIC_API_KEY: session.apiKey, NODE_ENV: 'production' }),
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let proxyOutput = '';
  const portPromise = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Proxy startup timeout')), 10000);
    proxy.stdout.on('data', (chunk) => {
      proxyOutput += chunk.toString();
      const portMatch = proxyOutput.match(/(\d{4,5})/);
      if (portMatch) {
        clearTimeout(t);
        resolve(parseInt(portMatch[1], 10));
      }
    });
    proxy.stderr.on('data', (chunk) => {
      const text = chunk.toString().trim();
      logger.error('Proxy stderr', { text });

      // Parse model health events from proxy v5
      // "→ modelX" / "→ modelX [retry 1/2]" → retrying
      const switchingMatch = text.match(/\[proxy\] →\s+(\S+)/);
      if (switchingMatch) {
        session.modelHealth = 'retrying';
      }
      // "✓ modelX" → live
      const liveMatch = text.match(/\[proxy\] ✓\s+(\S+)/);
      if (liveMatch) {
        session.currentModel = liveMatch[1];
        session.modelHealth = 'ok';
        modelStats.recordSuccess(liveMatch[1]);
        notifyModelUpdate(session);
      }
      // "✗ all failed ... → code" → error
      if (text.includes('[proxy] ✗ all failed')) {
        session.modelHealth = 'error';
        const codeMatch = text.match(/→\s*(\S+)$/);
        const errCode = codeMatch ? codeMatch[1] : 'unknown';
        modelStats.recordFail(session.currentModel || session.model, errCode);
        notifyModelUpdate(session);
      }
    });
    proxy.on('error', (e) => { clearTimeout(t); reject(e); });
    proxy.on('close', (c) => { clearTimeout(t); reject(new Error('Proxy exited ' + c)); });
  });

  const port = await portPromise;
  logger.info('Proxy listening', { port });
  return { process: proxy, port };
}

async function spawnCli(session, prompt) {
  // 全局进程限制
  if (globalProcessCount >= GLOBAL_PROCESS_LIMIT) {
    throw new Error('Server busy. Global process limit (' + GLOBAL_PROCESS_LIMIT + ') reached. Try again later.');
  }
  globalProcessCount++;
  let processCountActive = true;
  const releaseProcessSlot = () => {
    if (!processCountActive) return;
    processCountActive = false;
    globalProcessCount--;
  };

  try {
    const cliPath = join(FREE_CODE_DIR, 'cli-dev');
    const cliArgs = ['-p', '--bare'];
    if (session.model) cliArgs.push('--model', session.model);

    const env = buildSafeEnv({
      HOME: session.dir,
      ANTHROPIC_API_KEY: session.apiKey,
      NODE_ENV: 'production'
    });

    // For OpenRouter: start proxy and point CLI at it
    if (session.provider === 'openrouter' || session.provider === 'deepseek') {
      const { process: proxy, port } = await startProxy(session);
      sessionProxies.set(session.id, proxy);
      env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:' + port;
      logger.info('CLI ANTHROPIC_BASE_URL', { url: env.ANTHROPIC_BASE_URL });
    }

    const proc = spawn(cliPath, cliArgs, {
      cwd: session.dir,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // 进程超时自动终止
    const processTimeout = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
        logger.warn('Process timed out', { timeout: PROCESS_TIMEOUT / 1000 });
      } catch (e) {
        // 进程可能已结束
      }
    }, PROCESS_TIMEOUT);

    const cleanupProcess = () => {
      clearTimeout(processTimeout);
      releaseProcessSlot();
    };

    proc.on('close', cleanupProcess);
    proc.on('error', cleanupProcess);

    proc.stdin.write(prompt + '\n');
    proc.stdin.end();

    return proc;
  } catch (e) {
    releaseProcessSlot();
    throw e;
  }
}

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ];

// Railway 部署：自动添加部署域名
const RAILWAY_URL = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_STATIC_URL;
if (RAILWAY_URL) {
  ALLOWED_ORIGINS.push('https://' + RAILWAY_URL);
}

const app = express();

// Security headers (helmet)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      frameAncestors: ["'self'"],
      upgradeInsecureRequests: null, // Disable to allow HTTP in development
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// Strict CORS
app.use(cors({
  origin: ALLOWED_ORIGINS,
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
app.use(perfMetrics.middleware());

// ===== Performance Metrics API =====
app.get('/api/perf', (req, res) => {
  res.json(perfMetrics.snapshot());
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
app.use('/api/session', createSessionRouter({
  createSession, getSession, deleteSession, sessions, sessionProcesses, sessionProxies, messageStore,
  checkRateLimit, RATE_WINDOW, RATE_MAX_CREATE, MAX_SESSIONS, DEFAULTS
}));

// ===== Model Discovery API ====
app.locals.agentConfig = agentConfig;
app.use('/api/models', createModelRouter({ getProviderConfig, DEFAULTS, agentConfig }));

// ===== Health API ====
app.use('/api/health', createHealthRouter({
  sessions, PROVIDERS, DEFAULTS, MAX_SESSIONS, sessionProxies, modelStats,
  rateLimits: { snapshot: rateLimitsSnapshot }, RATE_MAX_CREATE, VERSION,
  allowDetailedHealth: process.env.ENABLE_DETAILED_HEALTH === 'true',
  // C3: pass subsystem references for health checks
  mcpManager,
  rag,
  db
}));

// ===== Config & Tools API ====
app.use('/api', createConfigRouter({ getToolDefinitions, PROVIDERS, DEFAULTS, VERSION, mcpManager, agentConfig }));

// ===== Search API ====
app.use('/api/search', createSearchRouter({ db }));

// ===== File API ====
// All file CRUD operations are handled by routes/fileRoutes.js
app.use('/api/files', createFileRouter({ getSession, sessions, checkRateLimit, RATE_WINDOW, RATE_MAX_FILE: 60, db }));

// ===== RAG API ====
app.use('/api/rag', createRagRouter({ rag, sessions }));

// ===== Admin API (protected by ADMIN_TOKEN) ====
app.use('/api/admin', createAdminRouter({ sessions, sessionProcesses, sessionProxies, modelStats, mcpManager, rag, db, auditLog, processPool, monitor }));

// ===== Prompt Template API ====
const { createTemplateRouter } = await import('./routes/templateRoutes.js');
app.use('/api/templates', createTemplateRouter());

// ===== Swagger API Docs ====
app.use('/api', createSwaggerRouter());

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

// ===== Startup: load persisted sessions =====
await loadSessions();

const server = app.listen(
PORT, HOST, () => {
  logger.info('Server started', { version: VERSION, host: HOST, port: PORT });
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

// WebSocket connection handling is in routes/wsHandler.js
wss.on('connection', createWsHandler({
  getSession, sessions, sessionProcesses, sessionProxies, sessionClients, wsProcCount,
  broadcastToSession, spawnCli, maskSensitive, stripAnsi,
  checkRateLimit, ALLOWED_ORIGINS, RATE_WINDOW, RATE_MAX_INPUT,
  messageStore, mcpManager, rag, agentConfig, processPool
}));

async function gracefulShutdown(signal) {
  logger.info('Shutdown signal received', { signal });

  // 1. Kill proxy processes
  for (const [id, proxy] of sessionProxies) {
    try { proxy.kill('SIGTERM'); } catch (e) { /* already dead */ }
    logger.info('Killed proxy', { sessionId: id });
  }
  sessionProxies.clear();

  // 2. Kill CLI processes
  for (const [id, proc] of sessionProcesses) {
    try { proc.kill('SIGTERM'); } catch (e) { /* already dead */ }
    logger.info('Killed process', { sessionId: id });
  }
  sessionProcesses.clear();

  // 2b. Destroy process pool
  await processPool.destroy();
  logger.info('Process pool destroyed');

  // 3. Disconnect MCP servers (C3)
  try {
    await mcpManager.disconnectAll();
    logger.info('MCP servers disconnected');
  } catch (e) {
    logger.error('MCP disconnect failed', { error: e.message });
  }

  // 4. Save message store
  try {
    await messageStore.save();
    logger.info('Message store saved');
  } catch (e) {
    logger.error('Message store save failed', { error: e.message });
  }

  // 5. Close WebSocket server
  try { wss.close(); logger.info('WebSocket server closed'); } catch (e) {}

  // 6. Close HTTP server
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });

  // Safety net: force exit in 5s
  setTimeout(() => process.exit(0), 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
  process.exit(1);
});

// ===== WebSocket heartbeat + session activity tracking =====
const HEARTBEAT_INTERVAL = 30000;
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });

  // C1: Update lastActivity for all sessions with active WebSocket connections
  for (const [sessionId, clients] of sessionClients) {
    const session = sessions.get(sessionId);
    if (session && clients.size > 0) {
      session.lastActivity = Date.now();
    }
  }
}, HEARTBEAT_INTERVAL);

// ===== Session timeout cleanup =====
const SESSION_TIMEOUT = parseInt(process.env.SESSION_TIMEOUT || '3600000');
setInterval(async () => {
  const now = Date.now();
  const expiredIds = [];
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > SESSION_TIMEOUT) {
      expiredIds.push(id);
      const proc = sessionProcesses.get(id);
      if (proc) { try { proc.kill(); } catch (e) {} sessionProcesses.delete(id); }
      const proxy = sessionProxies.get(id);
      if (proxy) { try { proxy.kill(); } catch (e) {} sessionProxies.delete(id); }
      sessionClients.delete(id);
      wsProcCount.delete(id);
    }
  }
  if (expiredIds.length > 0) {
     for (const id of expiredIds) {
       // C1: Notify connected clients before deleting session
       broadcastToSession(id, { type: 'session_expired' });
       await deleteSession(id);
       await messageStore.deleteSessionMessages(id);
     }
     logger.info('Sessions expired', { count: expiredIds.length });
   }
}, 60000);
