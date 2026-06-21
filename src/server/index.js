import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { dirname as pathDirname } from 'path';
import * as pty from 'node-pty';

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
const VERSION = '4.4.0';

const sessions = new Map();
const sessionProcesses = new Map();

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

function stripAnsi(str) {
  // Remove all ANSI escape sequences
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
  return session;
}

function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (session) session.lastActivity = Date.now();
  return session;
}

app.post('/api/session', async (req, res) => {
  try {
    const { apiKey, model, provider } = req.body;
    if (!apiKey) return res.status(400).json({ error: 'API key is required' });
    if (sessions.size >= MAX_SESSIONS) return res.status(503).json({ error: 'Too many sessions' });
    const session = createSession(apiKey, model || 'claude-opus-4-6', provider || 'anthropic');
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
    const proc = sessionProcesses.get(req.params.id);
    if (proc) { proc.kill(); sessionProcesses.delete(req.params.id); }
    sessions.delete(req.params.id);
  }
  res.json({ success: true });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: VERSION, sessions: sessions.size, maxSessions: MAX_SESSIONS, uptime: process.uptime(), freeCodeDir: FREE_CODE_DIR });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Free-code Web Server v${VERSION} running on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  let sessionId = null;
  let ptyProcess = null;
  let showOutput = false;
  let onboardingTimer = null;

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

        console.log(`Starting CLI for session ${sessionId}`);

        // Pre-create config to skip theme/login onboarding
        const configDir = join(session.dir, '.claude');
        await mkdir(configDir, { recursive: true });
        await writeFile(join(configDir, '.config.json'), JSON.stringify({
          theme: 'dark',
          hasCompletedOnboarding: true,
          hasCompletedProjectOnboarding: true,
          projectOnboardingSeenCount: 1
        }), 'utf-8');

        const cliPath = join(FREE_CODE_DIR, 'cli-dev');
        const cliArgs = [];
        if (session.model) cliArgs.push('--model', session.model);

        const providerEnv = {};
        if (session.provider === 'openrouter') providerEnv.ANTHROPIC_BASE_URL = 'https://openrouter.ai/api/v1';
        else if (session.provider === 'openai') providerEnv.CLAUDE_CODE_USE_OPENAI = '1';
        else if (session.provider === 'bedrock') providerEnv.CLAUDE_CODE_USE_BEDROCK = '1';
        else if (session.provider === 'vertex') providerEnv.CLAUDE_CODE_USE_VERTEX = '1';

        ptyProcess = pty.spawn(cliPath, cliArgs, {
          name: 'xterm-256color',
          cols: 200,
          rows: 50,
          cwd: session.dir,
          env: {
            TERM: 'xterm-256color',
            ...process.env,
            ANTHROPIC_API_KEY: session.apiKey,
            CLAUDE_CONFIG_DIR: configDir,
            ...providerEnv,
            NODE_ENV: 'production'
          }
        });

        sessionProcesses.set(sessionId, ptyProcess);
        showOutput = false;

        // Force enable output after 3 seconds (timeout fallback)
        onboardingTimer = setTimeout(() => {
          showOutput = true;
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'output', data: '\x1b[2J\x1b[H' }));
            ws.send(JSON.stringify({ type: 'output', data: '\nFree Code CLI 已就绪，请输入你的问题。\n\n' }));
          }
        }, 3000);

        ptyProcess.onData((data) => {
          // Auto-handle trust dialog
          if (!showOutput && data.includes('Is this a project you created')) {
            setTimeout(() => { if (ptyProcess) ptyProcess.write('1\r'); }, 500);
            return;
          }
          // Auto-handle API key confirmation
          if (!showOutput && data.includes('Do you want to use this API key')) {
            setTimeout(() => { if (ptyProcess) ptyProcess.write('1\r'); }, 500);
            return;
          }
          // Detect onboarding complete
          if (!showOutput && data.includes('Not logged in')) {
            showOutput = true;
            clearTimeout(onboardingTimer);
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: 'output', data: '\x1b[2J\x1b[H' }));
              ws.send(JSON.stringify({ type: 'output', data: '\nFree Code CLI 已就绪，请输入你的问题。\n\n' }));
            }
            return;
          }
          // Show output when ready (with ANSI stripped)
          if (showOutput && ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'output', data: stripAnsi(data) }));
          }
        });

        ptyProcess.onExit(({ exitCode, signal }) => {
          console.log(`Process exited: code=${exitCode}, signal=${signal}`);
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'exit', code: exitCode, signal }));
          }
          sessionProcesses.delete(sessionId);
        });

        ws.send(JSON.stringify({ type: 'ready' }));
      } else if (message.type === 'input') {
        if (ptyProcess) ptyProcess.write(message.data + '\r');
      } else if (message.type === 'interrupt') {
        if (ptyProcess) ptyProcess.write('\x03');
      }
    } catch (error) {
      console.error('WebSocket error:', error);
      ws.send(JSON.stringify({ type: 'error', message: error.message }));
    }
  });

  ws.on('close', () => {
    if (onboardingTimer) clearTimeout(onboardingTimer);
    if (ptyProcess) ptyProcess.kill();
    sessionProcesses.delete(sessionId);
  });
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
});
