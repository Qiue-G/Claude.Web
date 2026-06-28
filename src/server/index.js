import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import helmet from 'helmet';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve as pathResolve } from 'path';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { dirname as pathDirname } from 'path';
import { searchWeb } from './tools/webSearch.js';
import { executePython, extractPythonBlocks } from './tools/codeInterpreter.js';
import { getToolDefinitions, getToolInstructions } from './tools/registry.js';
import { analyzeFilesFromPromptContext, stripFileBlocksFromPrompt } from './tools/fileAnalysis.js';
import { buildPrompt } from './runtime/promptBuilder.js';
import { createFileRouter } from './routes/fileRoutes.js';
import { createWsHandler } from './routes/wsHandler.js';

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
const VERSION = '7.3.1';

// ===== Load agent config =====
let agentConfig = { defaults: { provider: 'openrouter', model: '' }, providers: {} };
try {
  const raw = await readFile(CONFIG_PATH, 'utf-8');
  agentConfig = JSON.parse(raw);
  console.log('[CONFIG] loaded ' + Object.keys(agentConfig.providers || {}).length + ' providers');
} catch (e) {
  console.log('[CONFIG] using built-in defaults (' + e.message + ')');
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
const rateLimits = new Map();
const RATE_WINDOW = 60000;      // 1 minute window
const RATE_MAX_CREATE = 5;      // max session creates per window per IP
const RATE_MAX_INPUT = 20;      // max WebSocket inputs per window per session

function checkRateLimit(key, max, windowMs) {
  const now = Date.now();
  let entry = rateLimits.get(key);
  if (!entry || now - entry.windowStart > windowMs) {
    entry = { windowStart: now, count: 0 };
    rateLimits.set(key, entry);
  }
  entry.count++;
  return entry.count <= max;
}

function getRateRemaining(key, max, windowMs) {
  const now = Date.now();
  const entry = rateLimits.get(key);
  if (!entry || now - entry.windowStart > windowMs) return max;
  return Math.max(0, max - entry.count);
}

// Clean stale rate-limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimits) {
    if (now - entry.windowStart > RATE_WINDOW * 2) rateLimits.delete(key);
  }
}, 300000);

const sessions = new Map();
const sessionProcesses = new Map();
const sessionProxies = new Map(); // proxy processes
const wsProcCount = new Map();    // active process count per session
const sessionClients = new Map(); // sessionId → WebSocket (for model health push)

// ===== Per-model stream health stats =====
const modelStats = new Map(); // modelId → { total, success, fail, lastOk, lastFail, lastError }

function recordModelSuccess(modelId) {
  let s = modelStats.get(modelId);
  if (!s) modelStats.set(modelId, (s = { total: 0, success: 0, fail: 0, lastOk: null, lastFail: null, lastError: null }));
  s.total++; s.success++; s.lastOk = Date.now();
}

function recordModelFail(modelId, errorDetail) {
  let s = modelStats.get(modelId);
  if (!s) modelStats.set(modelId, (s = { total: 0, success: 0, fail: 0, lastOk: null, lastFail: null, lastError: null }));
  s.total++; s.fail++; s.lastFail = Date.now(); s.lastError = errorDetail;
}

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

async function createSession(apiKey, model, provider) {
  const sessionId = uuidv4();
  const sessionToken = uuidv4();
  const csrfToken = uuidv4(); // CSRF protection token
  const sessionDir = join(WORKSPACE_DIR, sessionId);
  await mkdir(WORKSPACE_DIR, { recursive: true });
  await mkdir(sessionDir, { recursive: true });
  const session = { id: sessionId, token: sessionToken, csrfToken, apiKey, model, provider, dir: sessionDir, createdAt: Date.now(), lastActivity: Date.now(), currentModel: model, modelHealth: 'connecting' };
  sessions.set(sessionId, session);
  return session;
}

function getSession(sessionId, token) {
  const session = sessions.get(sessionId);
  if (session) {
    if (token && session.token !== token) return null;
    session.lastActivity = Date.now();
  }
  return session;
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
  console.log('[PROXY] starting or_proxy.mjs --model ' + model + (fallback ? ' --fallback-model ' + fallback : ''));

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
      console.error('[PROXY stderr] ' + text);

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
        recordModelSuccess(liveMatch[1]);
        notifyModelUpdate(session);
      }
      // "✗ all failed ... → code" → error
      if (text.includes('[proxy] ✗ all failed')) {
        session.modelHealth = 'error';
        const codeMatch = text.match(/→\s*(\S+)$/);
        const errCode = codeMatch ? codeMatch[1] : 'unknown';
        recordModelFail(session.currentModel || session.model, errCode);
        notifyModelUpdate(session);
      }
    });
    proxy.on('error', (e) => { clearTimeout(t); reject(e); });
    proxy.on('close', (c) => { clearTimeout(t); reject(new Error('Proxy exited ' + c)); });
  });

  const port = await portPromise;
  console.log('[PROXY] listening on port ' + port);
  return { process: proxy, port };
}

async function spawnCli(session, prompt) {
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
    console.log('[CLI] ANTHROPIC_BASE_URL=' + env.ANTHROPIC_BASE_URL);
  }

  const proc = spawn(cliPath, cliArgs, {
    cwd: session.dir,
    env,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  proc.stdin.write(prompt + '\n');
  proc.stdin.end();

  return proc;
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

app.use(express.json({ limit: '500kb' }));

app.use(express.static(join(__dirname, '../../public'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  }
}));

app.post('/api/session', async (req, res) => {
  try {
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
    if (!checkRateLimit('create:' + clientIp, RATE_MAX_CREATE, RATE_WINDOW)) {
      return res.status(429).json({
        error: 'Too many session requests. Please wait before creating another.',
        retryAfter: 60
      });
    }

    const { apiKey, model, provider } = req.body;
    if (!apiKey || typeof apiKey !== 'string' || apiKey.length > 200) return res.status(400).json({ error: 'Invalid API key' });
    // 校验 model 名称：只允许字母、数字、短横线、下划线、点、斜杠（用于模型名如 openai/gpt-4）
    if (model && (typeof model !== 'string' || model.length > 100 || !/^[\w.\-\/]+$/.test(model))) return res.status(400).json({ error: 'Invalid model' });
    const VALID_PROVIDERS = ['openrouter', 'anthropic', 'openai', 'deepseek'];
    if (provider && !VALID_PROVIDERS.includes(provider)) return res.status(400).json({ error: 'Invalid provider' });
    if (sessions.size >= MAX_SESSIONS) return res.status(503).json({ error: 'Too many sessions' });
    const session = await createSession(apiKey, model || DEFAULTS.model, provider || DEFAULTS.provider);
    res.json({ sessionId: session.id, token: session.token, csrfToken: session.csrfToken });
  } catch (error) { res.status(500).json({ error: 'Failed to create session' }); }
});

app.get('/api/session/:id', (req, res) => {
  const token = req.headers['x-session-token'];
  const session = getSession(req.params.id, token);
  if (!session) return res.status(401).json({ error: 'Invalid session or token' });
  res.json({ sessionId: session.id, model: session.model, provider: session.provider });
});

app.delete('/api/session/:id', async (req, res) => {
  const token = req.headers['x-session-token'];
  const session = getSession(req.params.id, token);
  if (session) {
    const csrfToken = req.headers['x-csrf-token'];
    if (!csrfToken || csrfToken !== session.csrfToken) return res.status(403).json({ error: 'CSRF token missing or invalid' });
    const oldProc = sessionProcesses.get(req.params.id);
    if (oldProc) { oldProc.kill(); sessionProcesses.delete(req.params.id); }
    const oldProxy = sessionProxies.get(req.params.id);
    if (oldProxy) { oldProxy.kill(); sessionProxies.delete(req.params.id); }
    sessions.delete(req.params.id);
  }
  res.json({ success: true });
});

// ===== Model Discovery API (ModelHub-inspired) =====
// Models are loaded from agent-config.json at startup

app.get('/api/models', (req, res) => {
  const provider = req.query.provider || DEFAULTS.provider;
  const cfg = getProviderConfig(provider);
  const models = cfg.models || [];
  const sorted = [...models].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier === 'free' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  res.json({
    provider,
    models: sorted,
    fallback: cfg.fallbackModel || null
  });
});

app.get('/api/models/:provider', (req, res) => {
  const cfg = getProviderConfig(req.params.provider);
  if (!cfg.models || cfg.models.length === 0) return res.status(404).json({ error: 'Unknown provider' });
  const sorted = [...cfg.models].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier === 'free' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  res.json({
    provider: req.params.provider,
    models: sorted,
    fallback: cfg.fallbackModel || null
  });
});

app.get('/api/health', (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    status: 'ok',
    version: VERSION,
    sessions: sessions.size,
    maxSessions: MAX_SESSIONS,
    uptime: process.uptime(),
    memory: {
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
      rssMB: Math.round(mem.rss / 1024 / 1024)
    }
  });
});

app.get('/api/health/detailed', (req, res) => {
  const models = [];
  for (const [id, s] of modelStats) {
    const total = s.total || 0;
    const rate = total > 0 ? ((s.success / total) * 100).toFixed(1) : '0.0';
    models.push({
      id,
      total, success: s.success, fail: s.fail,
      successRate: parseFloat(rate),
      lastOk: s.lastOk, lastFail: s.lastFail, lastError: s.lastError
    });
  }
  models.sort((a, b) => b.total - a.total);

  const sessionList = [];
  for (const [sid, s] of sessions) {
    const proxyAlive = sessionProxies.has(sid);
    sessionList.push({
      sessionId: sid,
      model: s.currentModel || s.model,
      health: s.modelHealth,
      provider: s.provider,
      proxyAlive,
      createdAt: s.createdAt
    });
  }

  // Rate limit snapshot
  const now = Date.now();
  const rlSnapshot = [];
  for (const [key, entry] of rateLimits) {
    rlSnapshot.push({ key, count: entry.count, remaining: Math.max(0, RATE_MAX_CREATE - entry.count) });
  }

  res.json({
    models,
    sessions: sessionList,
    uptime: process.uptime(),
    rateLimits: rlSnapshot.length ? rlSnapshot : null,
    config: {
      providers: Object.keys(PROVIDERS),
      defaults: DEFAULTS,
      maxSessions: MAX_SESSIONS
    }
  });
});

// ===== Tools API =====
app.get('/api/tools', (req, res) => {
  res.json({ tools: getToolDefinitions(process.env) });
});

// ===== Config API =====
app.get('/api/config', (req, res) => {
  const providers = {};
  for (const [p, cfg] of Object.entries(PROVIDERS)) {
    providers[p] = {
      baseUrl: cfg.baseUrl || null,
      fallbackModel: cfg.fallbackModel || null,
      modelCount: (cfg.models || []).length,
      aliasCount: Object.keys(cfg.modelAliases || {}).length
    };
  }
  res.json({ version: VERSION, defaults: DEFAULTS, providers });
});

// ===== File API ====
// All file CRUD operations are handled by routes/fileRoutes.js
app.use('/api/files', createFileRouter({ getSession, sessions, checkRateLimit, RATE_WINDOW, RATE_MAX_FILE: 60 }));

// ===== Error handler (must be 4-param to be recognized by Express) =====
app.use((err, req, res, next) => {
  console.error('[ERROR] express:', err.message);
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'File too large (max 500KB)' });
  }
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const server = app.listen(
PORT, HOST, () => {
  console.log('Free-code Web Server v' + VERSION + ' on ' + HOST + ':' + PORT);
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

// WebSocket connection handling is in routes/wsHandler.js
wss.on('connection', createWsHandler({
  getSession, sessions, sessionProcesses, sessionProxies, sessionClients, wsProcCount,
  broadcastToSession, spawnCli, maskSensitive, stripAnsi,
  checkRateLimit, ALLOWED_ORIGINS, RATE_WINDOW, RATE_MAX_INPUT
}));

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
});

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason);
  process.exit(1);
});

// ===== WebSocket heartbeat =====
const HEARTBEAT_INTERVAL = 30000;
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL);

// ===== Session timeout cleanup =====
const SESSION_TIMEOUT = parseInt(process.env.SESSION_TIMEOUT || '3600000');
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > SESSION_TIMEOUT) {
      const proc = sessionProcesses.get(id);
      if (proc) { try { proc.kill(); } catch (e) {} sessionProcesses.delete(id); }
      const proxy = sessionProxies.get(id);
      if (proxy) { try { proxy.kill(); } catch (e) {} sessionProxies.delete(id); }
      sessions.delete(id);
      sessionClients.delete(id);
      wsProcCount.delete(id);
      console.log('[SESSION] Expired:', id);
    }
  }
}, 60000);
