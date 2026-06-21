import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
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
const VERSION = '5.0.5';

const sessions = new Map();
const sessionProcesses = new Map();

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
  
  // For OpenRouter, create .claude/settings.json with proper env config
  if (provider === 'openrouter') {
    const claudeDir = join(sessionDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    const orModel = resolveOpenRouterModel(model || 'nvidia/nemotron-3-ultra-550b-a55b:free');
    const settings = {
      env: {
        OPENROUTER_API_KEY: apiKey,
        ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
        ANTHROPIC_AUTH_TOKEN: apiKey,
        ANTHROPIC_API_KEY: '',
        ANTHROPIC_MODEL: orModel
      }
    };
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify(settings, null, 2));
  }
  
  sessions.set(sessionId, session);
  return session;
}

function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (session) session.lastActivity = Date.now();
  return session;
}

// OpenRouter model name mapping
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

function spawnCli(session, prompt) {
  const cliPath = join(FREE_CODE_DIR, 'cli-dev');
  const cliArgs = ['--print'];
  
  // For OpenRouter, pass model via env instead of --model flag
  // Free-code CLI resolves aliases to Anthropic format, which OpenRouter doesn't recognize
  if (session.provider === 'openrouter') {
    const orModel = resolveOpenRouterModel(session.model || 'nvidia/nemotron-3-ultra-550b-a55b:free');
    cliArgs.push('--model', orModel);
  } else if (session.model) {
    cliArgs.push('--model', session.model);
  }
  
  const providerEnv = getProviderEnv(session.provider);
  
  const proc = spawn(cliPath, cliArgs, {
    cwd: session.dir,
    env: {
      HOME: session.dir,
      ...process.env,
      // OpenRouter requires ANTHROPIC_AUTH_TOKEN (Bearer token), not ANTHROPIC_API_KEY
      ANTHROPIC_API_KEY: session.provider === 'openrouter' ? '' : session.apiKey,
      ANTHROPIC_AUTH_TOKEN: session.provider === 'openrouter' ? session.apiKey : '',
      ANTHROPIC_MODEL: session.provider === 'openrouter' ? (resolveOpenRouterModel(session.model || 'nvidia/nemotron-3-ultra-550b-a55b:free')) : '',
      ...providerEnv,
      NODE_ENV: 'production'
    },
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
  }
  res.json({ success: true });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: VERSION, sessions: sessions.size, maxSessions: MAX_SESSIONS, uptime: process.uptime(), freeCodeDir: FREE_CODE_DIR });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Free-code Web Server v${VERSION} on ${HOST}:${PORT}`);
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
        console.log(`Session ${sessionId} initialized`);
        ws.send(JSON.stringify({ type: 'ready' }));

      } else if (message.type === 'input') {
        const session = getSession(sessionId);
        if (!session) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid session' }));
          return;
        }

        // Kill previous process if still running
        const oldProc = sessionProcesses.get(sessionId);
        if (oldProc) oldProc.kill();

        console.log(`[INPUT] "${message.data.substring(0, 100)}"`);
        
        const proc = spawnCli(session, message.data);
        sessionProcesses.set(sessionId, proc);

        let buffer = '';
        proc.stdout.on('data', (chunk) => {
          buffer += chunk.toString();
          // Flush periodically for streaming
          if (ws.readyState === ws.OPEN) {
            const clean = stripAnsi(chunk.toString());
            if (clean.trim()) {
              ws.send(JSON.stringify({ type: 'output', data: clean }));
            }
          }
        });

        proc.stderr.on('data', (chunk) => {
          const errStr = chunk.toString();
          console.error(`[STDERR] ${errStr.substring(0, 200)}`);
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'stderr', data: errStr }));
          }
        });

        proc.on('close', (code) => {
          console.log(`[DONE] exit code ${code}`);
          sessionProcesses.delete(sessionId);
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'exit', code }));
          }
        });

        proc.on('error', (err) => {
          console.error(`[ERROR] spawn failed: ${err.message}`);
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'error', message: `Failed to start CLI: ${err.message}` }));
          }
        });
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

