import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import helmet from 'helmet';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { dirname as pathDirname } from 'path';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = pathDirname(__filename);

try {
  const envContent = await readFile('.env', 'utf-8');
  envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) process.env[key.trim()] = valueParts.join('=').trim();
  });
} catch (e) {}

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || join(__dirname, '../../workspace');
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '10');
const FREE_CODE_DIR = process.env.FREE_CODE_DIR || '/free-code';
const CONFIG_PATH = process.env.AGENT_CONFIG_PATH || join(FREE_CODE_DIR, 'agent-config.json');
const VERSION = '7.3.0';

// ===== Load agent config (ModelHub-inspired) =====
let agentConfig = { defaults: { provider: 'openrouter', model: '' }, providers: {} };
try {
  const raw = await readFile(CONFIG_PATH, 'utf-8');
  agentConfig = JSON.parse(raw);
  console.log('[CONFIG] loaded ' + Object.keys(agentConfig.providers || {}).length + ' providers from agent-config.json');
} catch (e) {
  console.log('[CONFIG] agent-config.json not found, using built-in defaults (' + e.message + ')');
}

const DEFAULTS = agentConfig.defaults || { provider: 'openrouter', model: '' };
const PROVIDERS = agentConfig.providers || {};

function resolveOpenRouterModel(model) {
  const aliases = (PROVIDERS.openrouter || {}).modelAliases || {};
  return aliases[model] || model;
}

function getFallbackModel(provider) {
  return (PROVIDERS[provider] || {}).fallbackModel || null;
}


// ===== Dynamic Model List & Pricing =====
const dynamicModels = new Map(); // provider -> { models: [], lastUpdate: timestamp }
const MODEL_CACHE_TTL = 3600000; // 1 hour

async function fetchOpenRouterModels() {
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Accept': 'application/json' }
    });
    if (!resp.ok) throw new Error('Failed to fetch');
    const data = await resp.json();
    const models = (data.data || []).map(m => ({
      id: m.id,
      name: m.name || m.id.split('/').pop(),
      context: m.context_length || 0,
      pricing: {
        prompt: parseFloat(m.pricing?.prompt || 0) * 1000000, // per 1M tokens
        completion: parseFloat(m.pricing?.completion || 0) * 1000000,
        currency: 'USD'
      },
      tier: (m.pricing?.prompt === '0' || m.pricing?.prompt === 0) ? 'free' : 'paid'
    }));
    dynamicModels.set('openrouter', { models, lastUpdate: Date.now() });
    console.log(`[MODELS] Fetched ${models.length} models from OpenRouter`);
  } catch (e) {
    console.error('[MODELS] Failed to fetch OpenRouter models:', e.message);
  }
}

// Fetch models on startup
fetchOpenRouterModels();
// Refresh every hour
setInterval(fetchOpenRouterModels, MODEL_CACHE_TTL);

function getModelPricing(provider, modelId) {
  const cached = dynamicModels.get(provider);
  if (!cached) return null;
  const model = cached.models.find(m => m.id === modelId);
  return model?.pricing || null;
}

// ===== Usage Tracking =====
const usageStats = new Map(); // sessionId -> { inputTokens, outputTokens, cost, requests, lastRequest }

function recordUsage(sessionId, inputTokens, outputTokens, modelId, provider) {
  let stats = usageStats.get(sessionId);
  if (!stats) {
    stats = { inputTokens: 0, outputTokens: 0, cost: 0, requests: 0, lastRequest: null, model: modelId, provider };
    usageStats.set(sessionId, stats);
  }
  stats.inputTokens += inputTokens || 0;
  stats.outputTokens += outputTokens || 0;
  stats.requests++;
  stats.lastRequest = Date.now();
  stats.model = modelId;
  stats.provider = provider;

  // Calculate cost
  const pricing = getModelPricing(provider, modelId);
  if (pricing) {
    stats.cost += (inputTokens * pricing.prompt / 1000000) + (outputTokens * pricing.completion / 1000000);
  }
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

// ===== Per-model stream health stats =====
const modelStats = new Map(); // modelId => { total, success, fail, lastOk, lastFail, lastError }
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

const sessions = new Map();
const sessionProcesses = new Map();
const sessionProxies = new Map(); // proxy processes
const wsProcCount = new Map();    // active process count per session
const sessionClients = new Map(); // sessionId → WebSocket (for model health push)

// ===== API Key Encryption (AES-256-GCM) =====
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || randomBytes(32).toString('hex');
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function encryptApiKey(plainKey) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  let encrypted = cipher.update(plainKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return iv.toString('hex') + ':' + authTag + ':' + encrypted;
}

function decryptApiKey(encryptedKey) {
  const parts = encryptedKey.split(':');
  if (parts.length !== 3) return encryptedKey; // Not encrypted
  const [ivHex, authTagHex, encrypted] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function maskSensitive(text, apiKey) {
  if (!apiKey || apiKey.length < 12) return text;
  const masked = apiKey.substring(0, 8) + '***' + apiKey.substring(apiKey.length - 4);
  return text.split(apiKey).join(masked);
}

function stripAnsi(str) {
  str = str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  str = str.replace(/\x1b\][^\x07]*\x07/g, '');
  str = str.replace(/\x1b\[[?]\d+[hl]/g, '');
  str = str.replace(/\x1b\[\d+;\d+[A-H]/g, '');
  str = str.replace(/\x1b\[(\d+)C/g, (_, n) => ' '.repeat(parseInt(n)));
  return str;
}

// Sanitize user input to prevent injection attacks
function sanitizeInput(input) {
  if (!input || typeof input !== 'string') return '';
  // Limit length to 100KB
  const MAX_INPUT_LENGTH = 100 * 1024;
  let sanitized = input.length > MAX_INPUT_LENGTH ? input.substring(0, MAX_INPUT_LENGTH) : input;
  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '');
  // Remove control characters except newlines and tabs
  sanitized = sanitized.replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return sanitized;
}

function createSession(apiKey, model, provider) {
  const sessionId = uuidv4();
  const sessionToken = uuidv4();
  const csrfToken = uuidv4(); // CSRF protection token
  const sessionDir = join(WORKSPACE_DIR, sessionId);
  if (!existsSync(WORKSPACE_DIR)) mkdir(WORKSPACE_DIR, { recursive: true }).catch(console.error);
  mkdir(sessionDir, { recursive: true }).catch(console.error);
  // Encrypt API key at rest
  const encryptedKey = encryptApiKey(apiKey);
  const session = { id: sessionId, token: sessionToken, csrfToken, apiKey: encryptedKey, model, provider, dir: sessionDir, createdAt: Date.now(), lastActivity: Date.now(), currentModel: model, modelHealth: 'connecting' };
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

// OPENROUTER_MODELS replaced by agent-config.json modelAliases

// resolveOpenRouterModel now uses agentConfig (defined above)

// Push model health updates to connected WebSocket clients
function notifyModelUpdate(session) {
  const clients = sessionClients.get(session.id);
  if (!clients) return;
  clients.forEach(ws => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'model_update',
        model: session.currentModel,
        health: session.modelHealth
      }));
    }
  });
}

// Health degradation: fallback models loaded from agent-config.json

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

  // Decrypt API key for proxy use
  const decryptedKey = decryptApiKey(session.apiKey);
  const proxy = spawn('node', proxyArgs, {
    cwd: session.dir,
    env: { ...process.env, ANTHROPIC_API_KEY: decryptedKey, NODE_ENV: 'production' },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let proxyOutput = '';
  const portPromise = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Proxy startup timeout')), 10000);
    proxy.stdout.on('data', (chunk) => {
      proxyOutput += chunk.toString();
      // Match "listening on port XXXX" or "port: XXXX" format, with fallback to any 4-5 digit number
      const portMatch = proxyOutput.match(/(?:listening on port|port[:\s]+)(\d{4,5})/i)
                     || proxyOutput.match(/(\d{4,5})/);
      if (portMatch) {
        clearTimeout(t);
        resolve(parseInt(portMatch[1], 10));
      }
    });
    proxy.stderr.on('data', (chunk) => {
      const text = chunk.toString().trim();
      // Mask sensitive data (API keys) in logs
      const maskedText = maskSensitive(text, session.apiKey);
      console.error('[PROXY stderr] ' + maskedText);

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
        recordModelSuccess(session.currentModel);
        notifyModelUpdate(session);
      }
      // "✗ all failed ... → code" → error detail
      if (text.includes('[proxy] ✗ all failed')) {
        session.modelHealth = 'error';
        recordModelFail(session.currentModel || session.model, text);
        notifyModelUpdate(session);
      }
      // Parse usage info: "[proxy] usage: input=XXX output=YYY model=ZZZ"
      const usageMatch = text.match(/\[proxy\] usage: input=(\d+) output=(\d+) model=(\S+)/);
      if (usageMatch) {
        const inputTokens = parseInt(usageMatch[1], 10);
        const outputTokens = parseInt(usageMatch[2], 10);
        const modelUsed = usageMatch[3];
        recordUsage(session.id, inputTokens, outputTokens, modelUsed, session.provider);
        // Notify client of usage update
        const clients = sessionClients.get(session.id);
        if (clients) {
          clients.forEach(ws => {
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({
                type: 'usage_update',
                inputTokens,
                outputTokens,
                model: modelUsed
              }));
            }
          });
        }
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

  const env = {
    HOME: session.dir,
    ...process.env,
    ANTHROPIC_API_KEY: session.apiKey,
    NODE_ENV: 'production'
  };

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
      'https://claudefree-production.up.railway.app',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ];

const app = express();

// Trust proxy for correct client IP behind Railway reverse proxy
app.set('trust proxy', 1);

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

app.use(express.json({ limit: '50kb' }));

app.use(express.static(join(__dirname, '../../public'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
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
        retryAfter: 60,
        remaining: getRateRemaining('create:' + clientIp, RATE_MAX_CREATE, RATE_WINDOW)
      });
    }

    const { apiKey, model, provider } = req.body;
    if (!apiKey || typeof apiKey !== 'string' || apiKey.length > 200) return res.status(400).json({ error: 'Invalid API key' });
    if (model && (typeof model !== 'string' || model.length > 100)) return res.status(400).json({ error: 'Invalid model' });
    const VALID_PROVIDERS = ['openrouter', 'anthropic', 'openai', 'deepseek'];
    if (provider && !VALID_PROVIDERS.includes(provider)) return res.status(400).json({ error: 'Invalid provider' });
    if (sessions.size >= MAX_SESSIONS) return res.status(503).json({ error: 'Too many sessions' });
    const session = createSession(apiKey, model || DEFAULTS.model, provider || DEFAULTS.provider);
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
    // Clear sensitive data before deletion
    session.apiKey = null;
    sessions.delete(req.params.id);
    usageStats.delete(req.params.id);
  }
  res.json({ success: true });
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


// ===== File API: CSRF protection =====
// All write operations (POST/PUT/DELETE) on /api/files/ require x-csrf-token
app.use('/api/files/', (req, res, next) => {
  if (req.method === 'GET') return next(); // reads don't need CSRF

  const parts = req.path.split('/');
  const sid = parts[1] || 'unknown';
  const session = sessions.get(sid);
  if (!session) return res.status(401).json({ error: 'Invalid session' });

  const csrfToken = req.headers['x-csrf-token'];
  if (!csrfToken || csrfToken !== session.csrfToken) {
    return res.status(403).json({ error: 'CSRF token missing or invalid' });
  }
  next();
});

// ===== File API rate limiter =====
const RATE_MAX_FILE = 60; // max file API calls per minute per session
app.use('/api/files/', (req, res, next) => {
  const parts = req.path.split('/');
  const sid = parts[1] || 'unknown';
  if (!checkRateLimit('file:' + sid, RATE_MAX_FILE, RATE_WINDOW)) {
    return res.status(429).json({ error: 'Too many file requests. Please slow down.', remaining: 0 });
  }
  next();
});

// ===== File Tree API =====
app.get('/api/files/:sessionId', async (req, res) => {
  try {
    const token = req.headers['x-session-token'];
    const session = getSession(req.params.sessionId, token);
    if (!session) return res.status(401).json({ error: 'Invalid session or token' });
    const { readdir, stat } = await import('fs/promises');
    async function buildTree(dirPath, basePath) {
      const entries = await readdir(dirPath, { withFileTypes: true });
      const items = [];
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const fullPath = join(dirPath, entry.name);
        const relative = basePath ? basePath + '/' + entry.name : entry.name;
        try {
          const s = await stat(fullPath);
          if (entry.isDirectory()) {
            const children = await buildTree(fullPath, relative);
            items.push({ name: entry.name, path: relative, type: 'directory', children });
          } else {
            items.push({ name: entry.name, path: relative, type: 'file', size: s.size });
          }
        } catch (e) { /* skip */ }
      }
      items.sort((a, b) => a.type !== b.type ? (a.type === 'directory' ? -1 : 1) : a.name.localeCompare(b.name));
      return items;
    }
    const tree = await buildTree(session.dir, '');
    res.json({ tree });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// ===== File Content API =====
app.get('/api/files/:sessionId/*', async (req, res) => {
  try {
    const token = req.headers['x-session-token'];
    const session = getSession(req.params.sessionId, token);
    if (!session) return res.status(401).json({ error: 'Invalid session or token' });
    const filePath = req.params[0];
    const fullPath = join(session.dir, filePath);
    const resolvedPath = resolve(fullPath);
    const resolvedSessionDir = resolve(session.dir);
    
    // 防止路径遍历攻击
    if (!resolvedPath.startsWith(resolvedSessionDir)) {
      return res.status(403).json({ error: 'Access denied: path traversal detected' });
    }
    
    const content = await readFile(fullPath, 'utf-8');
    res.json({ content, path: filePath });
  } catch (error) {
    console.error('[ERROR] read file:', error.message);
    res.status(500).json({ error: 'Failed to read file' });
  }
});

// ===== File Write API =====
app.post('/api/files/:sessionId/*', async (req, res) => {
  try {
    const token = req.headers['x-session-token'];
    const session = getSession(req.params.sessionId, token);
    if (!session) return res.status(401).json({ error: 'Invalid session or token' });
    const filePath = req.params[0];
    const fullPath = join(session.dir, filePath);
    const resolvedPath = resolve(fullPath);
    const resolvedSessionDir = resolve(session.dir);
    
    // 防止路径遍历攻击
    if (!resolvedPath.startsWith(resolvedSessionDir)) {
      return res.status(403).json({ error: 'Access denied: path traversal detected' });
    }
    
    const dir = pathDirname(fullPath);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    const content = req.body.content || '';
    // Limit file size to 5MB
    const MAX_FILE_SIZE = 5 * 1024 * 1024;
    if (content.length > MAX_FILE_SIZE) {
      return res.status(413).json({ error: 'File too large (max 5MB)' });
    }
    await writeFile(fullPath, content, 'utf-8');
    res.json({ success: true, path: filePath });
  } catch (error) {
    console.error('[ERROR] write file:', error.message);
    res.status(500).json({ error: 'Failed to write file' });
  }
});

// ===== File Delete API =====
app.delete('/api/files/:sessionId/*', async (req, res) => {
  try {
    const token = req.headers['x-session-token'];
    const session = getSession(req.params.sessionId, token);
    if (!session) return res.status(401).json({ error: 'Invalid session or token' });
    const filePath = req.params[0];
    const fullPath = join(session.dir, filePath);
    const resolvedPath = resolve(fullPath);
    const resolvedSessionDir = resolve(session.dir);
    
    // 防止路径遍历攻击
    if (!resolvedPath.startsWith(resolvedSessionDir)) {
      return res.status(403).json({ error: 'Access denied: path traversal detected' });
    }
    
    const { unlink } = await import('fs/promises');
    await unlink(fullPath);
    res.json({ success: true, path: filePath });
  } catch (error) {
    console.error('[ERROR] delete file:', error.message);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

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
  res.json({ version: VERSION, defaults: DEFAULTS, providers, maxSessions: MAX_SESSIONS });
});

// ===== Dynamic Models API =====
app.get('/api/models', (req, res) => {
  const provider = req.query.provider || 'openrouter';
  const cached = dynamicModels.get(provider);

  if (!cached) {
    return res.json({ models: [], lastUpdate: null, provider });
  }

  // Return top models (free first, then by context size)
  const sorted = [...cached.models].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier === 'free' ? -1 : 1;
    return (b.context || 0) - (a.context || 0);
  });

  res.json({
    models: sorted.slice(0, 50), // Top 50
    lastUpdate: cached.lastUpdate,
    provider,
    total: cached.models.length
  });
});

// ===== Usage Stats API =====
app.get('/api/usage/:sessionId', (req, res) => {
  const token = req.headers['x-session-token'];
  const session = getSession(req.params.sessionId, token);
  if (!session) return res.status(401).json({ error: 'Invalid session or token' });

  const stats = usageStats.get(req.params.sessionId) || {
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
    requests: 0,
    lastRequest: null,
    model: session.currentModel,
    provider: session.provider
  };

  res.json(stats);
});

const server = app.listen(
PORT, HOST, () => {
  console.log('Free-code Web Server v' + VERSION + ' on ' + HOST + ':' + PORT);
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', (ws, req) => {
  // Verify WebSocket origin
  const wsOrigin = req.headers.origin;
  if (wsOrigin && !ALLOWED_ORIGINS.includes(wsOrigin)) {
    ws.send(JSON.stringify({ type: 'error', message: 'WebSocket origin not allowed' }));
    ws.close();
    return;
  }
  let sessionId = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', async (data) => {
    try {
      // Enforce message size limit (1MB)
      if (data.length > 1024 * 1024) {
        ws.send(JSON.stringify({ type: 'error', message: 'Message too large' }));
        return;
      }

      const message = JSON.parse(data.toString());

      if (message.type === 'init') {
        sessionId = message.sessionId;
        const token = message.token;
        const session = getSession(sessionId, token);
        if (!session) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid session or token' }));
          ws.close();
          return;
        }

        // Register client for model health push
        if (!sessionClients.has(sessionId)) sessionClients.set(sessionId, new Set());
        sessionClients.get(sessionId).add(ws);

        console.log('Session ' + sessionId + ' initialized');
        ws.send(JSON.stringify({
          type: 'ready',
          model: session.currentModel,
          health: session.modelHealth
        }));

      } else if (message.type === 'input') {
        const session = getSession(sessionId);
        if (!session) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid session' }));
          return;
        }

        // Rate limit: max RATE_MAX_INPUT inputs per minute per session
        if (!checkRateLimit('input:' + sessionId, RATE_MAX_INPUT, RATE_WINDOW)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Too many requests. Please slow down.', remaining: 0 }));
          return;
        }

        // Session token re-validation on input
        if (message.token && session.token !== message.token) {
          ws.send(JSON.stringify({ type: 'error', message: 'Session token mismatch' }));
          return;
        }

        // Max 2 concurrent processes per session
        const currentCount = wsProcCount.get(sessionId) || 0;
        if (currentCount >= 2) {
          ws.send(JSON.stringify({ type: 'error', message: 'Already processing. Wait for completion.' }));
          return;
        }

        const oldProc = sessionProcesses.get(sessionId);
        if (oldProc) oldProc.kill();

        // Sanitize user input
        const sanitizedData = sanitizeInput(message.data);
        console.log('[INPUT] message length: ' + (sanitizedData ? sanitizedData.length : 0));

        wsProcCount.set(sessionId, (wsProcCount.get(sessionId) || 0) + 1);
        const proc = await spawnCli(session, sanitizedData);
        sessionProcesses.set(sessionId, proc);

        proc.stdout.on('data', (chunk) => {
          const clean = stripAnsi(chunk.toString());
          // Mask sensitive data in process output
          const masked = maskSensitive(clean, session.apiKey);
          if (masked.trim() && ws.readyState === ws.OPEN) {
            const MAX_WS_MSG = 1024 * 1024; // 1MB
            const data = masked.length > MAX_WS_MSG ? masked.substring(0, MAX_WS_MSG) + '\n[output truncated]' : masked;
            ws.send(JSON.stringify({ type: 'output', data }));
          }
        });

        proc.stderr.on('data', (chunk) => {
          const errStr = chunk.toString();
          // Mask sensitive data in process output
          const masked = maskSensitive(errStr, session.apiKey);
          console.error('[STDERR] ' + masked.substring(0, 200));
          if (ws.readyState === ws.OPEN) {
            const MAX_WS_ERR = 1024 * 1024; // 1MB
            const data = masked.length > MAX_WS_ERR ? masked.substring(0, MAX_WS_ERR) + '\n[output truncated]' : masked;
            ws.send(JSON.stringify({ type: 'stderr', data }));
          }
        });

        proc.on('close', (code) => {
          console.log('[DONE] exit code ' + code);
          sessionProcesses.delete(sessionId);
          wsProcCount.set(sessionId, Math.max(0, (wsProcCount.get(sessionId) || 0) - 1));
          // Kill proxy too
          const proxy = sessionProxies.get(sessionId);
          if (proxy) { proxy.kill(); sessionProxies.delete(sessionId); }
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'exit', code }));
          }
        });

        proc.on('error', (err) => {
          console.error('[ERROR] ' + err.message);
          wsProcCount.set(sessionId, Math.max(0, (wsProcCount.get(sessionId) || 0) - 1));
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'error', message: 'Failed to start CLI' }));
          }
        });
      }

    } catch (error) {
      console.error('WebSocket error:', error);
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'error', message: 'Internal server error' }));
      }
    }
  });

  ws.on('error', (err) => {
    console.error('[WS] error:', err.message);
  });

  ws.on('close', () => {
    if (sessionId) {
      const clients = sessionClients.get(sessionId);
      if (clients) { clients.delete(ws); if (clients.size === 0) sessionClients.delete(sessionId); }
    }
    const proc = sessionProcesses.get(sessionId);
    if (proc) { proc.kill(); sessionProcesses.delete(sessionId); }
    const proxy = sessionProxies.get(sessionId);
    if (proxy) { proxy.kill(); sessionProxies.delete(sessionId); }
  });
});

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
setInterval(async () => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > SESSION_TIMEOUT) {
      const proc = sessionProcesses.get(id);
      if (proc) { try { proc.kill(); } catch (e) {} sessionProcesses.delete(id); }
      const proxy = sessionProxies.get(id);
      if (proxy) { try { proxy.kill(); } catch (e) {} sessionProxies.delete(id); }

      // Clear sensitive data before deletion
      session.apiKey = null;

      // Clean up workspace directory
      try {
        const { rm } = await import('fs/promises');
        await rm(session.dir, { recursive: true, force: true });
        console.log('[SESSION] Cleaned workspace:', session.dir);
      } catch (e) {
        console.error('[SESSION] Failed to clean workspace:', e.message);
      }

      sessions.delete(id);
      console.log('[SESSION] Expired:', id);
    }
  }
}, 60000);
