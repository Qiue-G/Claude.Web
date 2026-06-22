import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
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
const VERSION = '6.1.1';

const sessions = new Map();
const sessionProcesses = new Map();
const sessionMessages = new Map();

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
  const sessionDir = join(WORKSPACE_DIR, sessionId);
  if (!existsSync(WORKSPACE_DIR)) mkdir(WORKSPACE_DIR, { recursive: true }).catch(console.error);
  mkdir(sessionDir, { recursive: true }).catch(console.error);
  const session = { id: sessionId, apiKey, model, provider, dir: sessionDir, createdAt: Date.now(), lastActivity: Date.now() };
  sessions.set(sessionId, session);
  sessionMessages.set(sessionId, []);
  return session;
}

function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (session) session.lastActivity = Date.now();
  return session;
}

function getMessages(sessionId) {
  return sessionMessages.get(sessionId) || [];
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

function getProviderEnv(provider) {
  switch (provider) {
    case 'openai': return { CLAUDE_CODE_USE_OPENAI: '1' };
    case 'bedrock': return { CLAUDE_CODE_USE_BEDROCK: '1' };
    case 'vertex': return { CLAUDE_CODE_USE_VERTEX: '1' };
    case 'openrouter': return { ANTHROPIC_BASE_URL: 'https://openrouter.ai/api' };
    default: return {};
  }
}

async function spawnWithProxy(session, prompt, ws) {
  const bridgePath = join(FREE_CODE_DIR, 'or_bridge.mjs');
  const model = resolveOpenRouterModel(session.model || 'nvidia/nemotron-3-ultra-550b-a55b:free');
  console.log('[BRIDGE] node ' + bridgePath + ' --model ' + model);

  const bridge = spawn('node', [bridgePath, '--model', model], {
    cwd: session.dir,
    env: { HOME: session.dir, ...process.env, ANTHROPIC_API_KEY: session.apiKey, NODE_ENV: 'production' },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let responseBuffer = '';
  let startupReceived = false;

  // Attach listeners BEFORE sending messages
  bridge.stdout.on('data', (chunk) => {
    const raw = chunk.toString();
    const clean = stripAnsi(raw);
    console.log('[BRIDGE stdout] ' + clean.substring(0, 100));

    if (!startupReceived) {
      const lines = clean.split('\n');
      for (const line of lines) {
        if (line.match(/^\d+$/)) {
          startupReceived = true;
          console.log('[BRIDGE] startup signal received');
          continue;
        }
        if (line.trim()) {
          responseBuffer += line + '\n';
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'output', data: line + '\n' }));
          }
        }
      }
    } else {
      responseBuffer += clean;
      if (clean.trim() && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'output', data: clean }));
      }
    }
  });

  bridge.stderr.on('data', (chunk) => {
    const errStr = chunk.toString();
    console.error('[BRIDGE stderr] ' + errStr.substring(0, 200));
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'stderr', data: errStr }));
    }
  });

  bridge.on('close', (code) => {
    console.log('[BRIDGE] exited with code ' + code);
    sessionProcesses.delete(session.id);

    if (responseBuffer.trim()) {
      const msgs = getMessages(session.id);
      msgs.push({ role: 'user', content: prompt });
      msgs.push({ role: 'assistant', content: responseBuffer.trim() });
      if (msgs.length > 20) msgs.splice(0, msgs.length - 20);
      sessionMessages.set(session.id, msgs);
      console.log('[HISTORY] ' + msgs.length + ' messages');
    }

    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', code }));
    }
  });

  bridge.on('error', (err) => {
    console.error('[BRIDGE error] ' + err.message);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: 'Bridge failed: ' + err.message }));
    }
  });

  // Wait for startup signal
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Bridge startup timeout')), 10000);
    const checkStartup = () => {
      if (startupReceived) {
        clearTimeout(t);
        resolve();
      } else {
        setTimeout(checkStartup, 100);
      }
    };
    checkStartup();
    bridge.on('close', (c) => { clearTimeout(t); reject(new Error('Bridge exited ' + c)); });
  });

  console.log('[BRIDGE] sending messages');
  const messages = [...getMessages(session.id), { role: 'user', content: prompt }];
  bridge.stdin.write(JSON.stringify(messages));
  bridge.stdin.end();

  return bridge;
}

async function spawnCli(session, prompt, ws) {
  if (session.provider === 'openrouter') {
    return spawnWithProxy(session, prompt, ws);
  }

  const cliPath = join(FREE_CODE_DIR, 'cli-dev');
  const cliArgs = ['--print'];
  if (session.model) cliArgs.push('--model', session.model);

  const providerEnv = getProviderEnv(session.provider);
  const proc = spawn(cliPath, cliArgs, {
    cwd: session.dir,
    env: { HOME: session.dir, ...process.env, ANTHROPIC_API_KEY: session.apiKey, ...providerEnv, NODE_ENV: 'production' },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  proc.stdin.write(prompt + '\n');
  proc.stdin.end();

  return proc;
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, '../../public'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

app.post('/api/session', async (req, res) => {
  try {
    const { apiKey, model, provider } = req.body;
    if (!apiKey) return res.status(400).json({ error: 'API key is required' });
    if (sessions.size >= MAX_SESSIONS) return res.status(503).json({ error: 'Too many sessions' });
    const session = createSession(apiKey, model || 'nvidia/nemotron-3-ultra-550b-a55b:free', provider || 'openrouter');
    res.json({ sessionId: session.id, dir: session.dir });
  } catch (error) { res.status(500).json({ error: 'Failed to create session' }); }
});

app.get('/api/session/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({ sessionId: session.id, dir: session.dir, model: session.model, provider: session.provider });
});

app.delete('/api/session/:id', async (req, res) => {
  const session = sessions.get(req.params.id);
  if (session) {
    const oldProc = sessionProcesses.get(req.params.id);
    if (oldProc) { oldProc.kill(); sessionProcesses.delete(req.params.id); }
    sessions.delete(req.params.id);
    sessionMessages.delete(req.params.id);
  }
  res.json({ success: true });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: VERSION, sessions: sessions.size, maxSessions: MAX_SESSIONS, uptime: process.uptime(), freeCodeDir: FREE_CODE_DIR });
});

const server = app.listen(PORT, HOST, () => {
  console.log('Free-code Web Server v' + VERSION + ' on ' + HOST + ':' + PORT);
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  let sessionId = null;

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === 'init') {
        sessionId = message.sessionId;
        const session = getSession(sessionId);
        if (!session) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid session' }));
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

        const oldProc = sessionProcesses.get(sessionId);
        if (oldProc) oldProc.kill();

        console.log('[INPUT] "' + message.data.substring(0, 100) + '"');

        const proc = await spawnCli(session, message.data, ws);
        sessionProcesses.set(sessionId, proc);

        // For non-openrouter providers, attach stdout listener here
        if (session.provider !== 'openrouter') {
          let responseBuffer = '';
          proc.stdout.on('data', (chunk) => {
            const clean = stripAnsi(chunk.toString());
            responseBuffer += clean;
            if (clean.trim() && ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: 'output', data: clean }));
            }
          });

          proc.stderr.on('data', (chunk) => {
            const errStr = chunk.toString();
            console.error('[STDERR] ' + errStr.substring(0, 200));
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: 'stderr', data: errStr }));
            }
          });

          proc.on('close', (code) => {
            console.log('[DONE] exit code ' + code);
            sessionProcesses.delete(sessionId);
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: 'exit', code }));
            }
          });

          proc.on('error', (err) => {
            console.error('[ERROR] ' + err.message);
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: 'error', message: 'Failed to start CLI: ' + err.message }));
            }
          });
        }
      }

    } catch (error) {
      console.error('WebSocket error:', error);
      ws.send(JSON.stringify({ type: 'error', message: error.message }));
    }
  });

  ws.on('close', () => {
    const proc = sessionProcesses.get(sessionId);
    if (proc) { proc.kill(); sessionProcesses.delete(sessionId); }
  });
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
});
