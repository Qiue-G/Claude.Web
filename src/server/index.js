import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import helmet from 'helmet';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { dirname as pathDirname } from 'path';

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
const VERSION = '7.1.0';

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

function stripAnsi(str) {
  str = str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  str = str.replace(/\x1b\][^\x07]*\x07/g, '');
  str = str.replace(/\x1b\[[?]\d+[hl]/g, '');
  str = str.replace(/\x1b\[\d+;\d+[A-H]/g, '');
  str = str.replace(/\x1b\[(\d+)C/g, (_, n) => ' '.repeat(parseInt(n)));
  return str;
}

function createSession(apiKey, model, provider) {
  const sessionId = uuidv4();
  const sessionToken = uuidv4();
  const sessionDir = join(WORKSPACE_DIR, sessionId);
  if (!existsSync(WORKSPACE_DIR)) mkdir(WORKSPACE_DIR, { recursive: true }).catch(console.error);
  mkdir(sessionDir, { recursive: true }).catch(console.error);
  const session = { id: sessionId, token: sessionToken, apiKey, model, provider, dir: sessionDir, createdAt: Date.now(), lastActivity: Date.now() };
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

const OPENROUTER_MODELS = {
  'haiku': 'anthropic/claude-haiku-4.5',
  'sonnet': 'anthropic/claude-sonnet-4',
  'opus': 'anthropic/claude-opus-4',
  'haiku35': 'anthropic/claude-3.5-haiku',
  'sonnet35': 'anthropic/claude-3.5-sonnet',
  'sonnet37': 'anthropic/claude-3.7-sonnet',
};

function resolveOpenRouterModel(model) {
  return OPENROUTER_MODELS[model] || model;
}

async function startProxy(session) {
  const proxyPath = join(FREE_CODE_DIR, 'or_proxy.mjs');
  const model = session.provider === 'openrouter'
    ? resolveOpenRouterModel(session.model || 'nvidia/nemotron-3-ultra-550b-a55b:free')
    : (session.model || 'deepseek-v4-pro');
  console.log('[PROXY] starting or_proxy.mjs --model ' + model);

  const proxyArgs = [proxyPath, '--model', model];
  if (session.provider === 'deepseek') {
    proxyArgs.push('--base-url', 'https://api.deepseek.com/v1');
  }

  const proxy = spawn('node', proxyArgs, {
    cwd: session.dir,
    env: { ...process.env, ANTHROPIC_API_KEY: session.apiKey, NODE_ENV: 'production' },
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
      console.error('[PROXY stderr] ' + chunk.toString().trim());
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
  : undefined;

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
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// Strict CORS
app.use(cors({
  origin: ALLOWED_ORIGINS
    ? ALLOWED_ORIGINS
    : function (origin, callback) {
        // In production, only allow same-origin or known origins
        if (!origin || origin.startsWith('https://claudefree') || origin.startsWith('http://localhost') || origin.startsWith('https://')) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
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
        retryAfter: 60
      });
    }

    const { apiKey, model, provider } = req.body;
    if (!apiKey || typeof apiKey !== 'string' || apiKey.length > 200) return res.status(400).json({ error: 'Invalid API key' });
    if (model && (typeof model !== 'string' || model.length > 100)) return res.status(400).json({ error: 'Invalid model' });
    const VALID_PROVIDERS = ['openrouter', 'anthropic', 'openai', 'deepseek'];
    if (provider && !VALID_PROVIDERS.includes(provider)) return res.status(400).json({ error: 'Invalid provider' });
    if (sessions.size >= MAX_SESSIONS) return res.status(503).json({ error: 'Too many sessions' });
    const session = createSession(apiKey, model || 'nvidia/nemotron-3-ultra-550b-a55b:free', provider || 'openrouter');
    res.json({ sessionId: session.id, token: session.token });
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
    const oldProc = sessionProcesses.get(req.params.id);
    if (oldProc) { oldProc.kill(); sessionProcesses.delete(req.params.id); }
    const oldProxy = sessionProxies.get(req.params.id);
    if (oldProxy) { oldProxy.kill(); sessionProxies.delete(req.params.id); }
    sessions.delete(req.params.id);
  }
  res.json({ success: true });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: VERSION, sessions: sessions.size, maxSessions: MAX_SESSIONS, uptime: process.uptime() });
});


// ===== File API rate limiter =====
const RATE_MAX_FILE = 60; // max file API calls per minute per session
app.use('/api/files/', (req, res, next) => {
  const parts = req.path.split('/');
  const sid = parts[1] || 'unknown';
  if (!checkRateLimit('file:' + sid, RATE_MAX_FILE, RATE_WINDOW)) {
    return res.status(429).json({ error: 'Too many file requests. Please slow down.' });
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
    const resolvedPath = require('path').resolve(fullPath);
    const resolvedSessionDir = require('path').resolve(session.dir);
    
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
    const resolvedPath = require('path').resolve(fullPath);
    const resolvedSessionDir = require('path').resolve(session.dir);
    
    // 防止路径遍历攻击
    if (!resolvedPath.startsWith(resolvedSessionDir)) {
      return res.status(403).json({ error: 'Access denied: path traversal detected' });
    }
    
    const dir = pathDirname(fullPath);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await writeFile(fullPath, req.body.content || '', 'utf-8');
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
    const resolvedPath = require('path').resolve(fullPath);
    const resolvedSessionDir = require('path').resolve(session.dir);
    
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

const server = app.listen(
PORT, HOST, () => {
  console.log('Free-code Web Server v' + VERSION + ' on ' + HOST + ':' + PORT);
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', (ws) => {
  let sessionId = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', async (data) => {
    try {
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
        console.log('Session ' + sessionId + ' initialized');
        ws.send(JSON.stringify({ type: 'ready' }));

      } else if (message.type === 'input') {
        const session = getSession(sessionId);
        if (!session) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid session' }));
          return;
        }

        // Rate limit: max RATE_MAX_INPUT inputs per minute per session
        if (!checkRateLimit('input:' + sessionId, RATE_MAX_INPUT, RATE_WINDOW)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Too many requests. Please slow down.' }));
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

        console.log('[INPUT] message length: ' + (message.data ? message.data.length : 0));

        wsProcCount.set(sessionId, (wsProcCount.get(sessionId) || 0) + 1);
        const proc = await spawnCli(session, message.data);
        sessionProcesses.set(sessionId, proc);

        proc.stdout.on('data', (chunk) => {
          const clean = stripAnsi(chunk.toString());
          if (clean.trim() && ws.readyState === ws.OPEN) {
            const MAX_WS_MSG = 1024 * 1024; // 1MB
            const data = clean.length > MAX_WS_MSG ? clean.substring(0, MAX_WS_MSG) + '\n[output truncated]' : clean;
            ws.send(JSON.stringify({ type: 'output', data }));
          }
        });

        proc.stderr.on('data', (chunk) => {
          const errStr = chunk.toString();
          console.error('[STDERR] ' + errStr.substring(0, 200));
          if (ws.readyState === ws.OPEN) {
            const MAX_WS_ERR = 1024 * 1024; // 1MB
            const data = errStr.length > MAX_WS_ERR ? errStr.substring(0, MAX_WS_ERR) + '\n[output truncated]' : errStr;
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
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > SESSION_TIMEOUT) {
      const proc = sessionProcesses.get(id);
      if (proc) { try { proc.kill(); } catch (e) {} sessionProcesses.delete(id); }
      const proxy = sessionProxies.get(id);
      if (proxy) { try { proxy.kill(); } catch (e) {} sessionProxies.delete(id); }
      sessions.delete(id);
      console.log('[SESSION] Expired:', id);
    }
  }
}, 60000);
