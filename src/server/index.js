import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { readFile, writeFile, readdir, stat, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { dirname as pathDirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = pathDirname(__filename);

// Load environment variables
try {
  const envContent = await readFile('.env', 'utf-8');
  envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      process.env[key.trim()] = valueParts.join('=').trim();
    }
  });
} catch (e) {
  // .env not found, use defaults
}

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || join(__dirname, '../../workspace');
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '10');
const FREE_CODE_DIR = process.env.FREE_CODE_DIR || '/free-code';

const VERSION = '3.0.0';

// Sessions storage
const sessions = new Map();
const sessionProcesses = new Map();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, '../../public'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// Session management
function createSession(apiKey, model, provider) {
  const sessionId = uuidv4();
  const sessionDir = join(WORKSPACE_DIR, sessionId);

  if (!existsSync(WORKSPACE_DIR)) {
    mkdir(WORKSPACE_DIR, { recursive: true }).catch(console.error);
  }

  mkdir(sessionDir, { recursive: true }).catch(console.error);

  const session = {
    id: sessionId,
    apiKey,
    model,
    provider,
    dir: sessionDir,
    createdAt: Date.now(),
    lastActivity: Date.now()
  };

  sessions.set(sessionId, session);
  return session;
}

function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (session) {
    session.lastActivity = Date.now();
  }
  return session;
}

// API Routes
app.post('/api/session', async (req, res) => {
  try {
    const { apiKey, model, provider } = req.body;

    if (!apiKey) {
      return res.status(400).json({ error: 'API key is required' });
    }

    if (sessions.size >= MAX_SESSIONS) {
      return res.status(503).json({ error: 'Too many sessions. Please try again later.' });
    }

    const session = createSession(apiKey, model || 'claude-opus-4-6', provider || 'anthropic');
    res.json({ sessionId: session.id, dir: session.dir });
  } catch (error) {
    console.error('Session creation error:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

app.get('/api/session/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json({ sessionId: session.id, dir: session.dir, model: session.model, provider: session.provider });
});

app.delete('/api/session/:id', async (req, res) => {
  const sessionId = req.params.id;
  const session = sessions.get(sessionId);
  if (session) {
    const proc = sessionProcesses.get(sessionId);
    if (proc) {
      proc.kill();
      sessionProcesses.delete(sessionId);
    }
    sessions.delete(sessionId);
  }
  res.json({ success: true });
});

// File operations
app.get('/api/files', async (req, res) => {
  const session = getSession(req.query.sessionId);
  if (!session) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  try {
    const targetDir = req.query.path ? join(session.dir, req.query.path) : session.dir;
    if (!targetDir.startsWith(session.dir)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const entries = await readdir(targetDir, { withFileTypes: true });
    const files = entries.map(entry => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
      path: req.query.path ? `${req.query.path}/${entry.name}` : entry.name
    }));
    res.json({ files, currentPath: req.query.path || '/' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/file', async (req, res) => {
  const session = getSession(req.query.sessionId);
  if (!session) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  try {
    const filePath = join(session.dir, req.query.path);
    if (!filePath.startsWith(session.dir)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const content = await readFile(filePath, 'utf-8');
    const stats = await stat(filePath);
    res.json({ content, size: stats.size, modified: stats.mtime, path: req.query.path });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/file', async (req, res) => {
  const session = getSession(req.body.sessionId);
  if (!session) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  try {
    const { path, content } = req.body;
    const filePath = join(session.dir, path);
    if (!filePath.startsWith(session.dir)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const parentDir = dirname(filePath);
    if (!existsSync(parentDir)) {
      await mkdir(parentDir, { recursive: true });
    }
    await writeFile(filePath, content, 'utf-8');
    res.json({ success: true, path });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: VERSION,
    sessions: sessions.size,
    maxSessions: MAX_SESSIONS,
    uptime: process.uptime(),
    freeCodeDir: FREE_CODE_DIR
  });
});

// Create HTTP server
const server = app.listen(PORT, HOST, () => {
  console.log(`Free-code Web Server v${VERSION} running on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Workspace: ${WORKSPACE_DIR}`);
  console.log(`Free-code dir: ${FREE_CODE_DIR}`);
});

// Strip ANSI codes
function stripAnsi(str) {
  str = str.replace(/\x1b\[(\d+)C/g, (_, n) => ' '.repeat(parseInt(n)));
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

// WebSocket for PTY interaction
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  let sessionId = null;
  let proc = null;
  let onboardingPhase = 0; // 0=theme, 1=login, 2=ready
  let outputBuffer = '';

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

        const cliPath = join(FREE_CODE_DIR, 'cli-dev');
        const cliArgs = [];
        if (session.model) {
          cliArgs.push('--model', session.model);
        }

        const providerEnv = {};
        if (session.provider === 'openrouter') {
          providerEnv.ANTHROPIC_BASE_URL = 'https://openrouter.ai/api/v1';
        } else if (session.provider === 'openai') {
          providerEnv.CLAUDE_CODE_USE_OPENAI = '1';
        } else if (session.provider === 'bedrock') {
          providerEnv.CLAUDE_CODE_USE_BEDROCK = '1';
        } else if (session.provider === 'vertex') {
          providerEnv.CLAUDE_CODE_USE_VERTEX = '1';
        }

        // Use socat with PTY
        const cliCmd = [cliPath, ...cliArgs].map(a => `'${a}'`).join(' ');
        proc = spawn('socat', ['EXEC:' + cliCmd + ',pty,raw,echo=0,ctty,setsid,sigint,rows=50,cols=200', '-'], {
          cwd: session.dir,
          env: {
            TERM: 'xterm-256color',
            ...process.env,
            ANTHROPIC_API_KEY: session.apiKey,
            ...providerEnv,
            NODE_ENV: 'production'
          },
          stdio: ['pipe', 'pipe', 'pipe']
        });

        sessionProcesses.set(sessionId, proc);
        onboardingPhase = 0;
        outputBuffer = '';

        proc.stdout.on('data', (data) => {
          const text = stripAnsi(data.toString());
          outputBuffer += text;

          // Auto-handle onboarding
          if (onboardingPhase === 0 && outputBuffer.includes('Choose the text style')) {
            // Theme selection - send "1" for Dark mode
            setTimeout(() => {
              if (proc && proc.stdin) {
                proc.stdin.write('1\r');
                onboardingPhase = 1;
                outputBuffer = '';
              }
            }, 1000);
          } else if (onboardingPhase === 1 && (outputBuffer.includes('Select login method') || outputBuffer.includes('login'))) {
            // Login selection - send "1" for API key
            setTimeout(() => {
              if (proc && proc.stdin) {
                proc.stdin.write('1\r');
                onboardingPhase = 2;
                outputBuffer = '';
              }
            }, 1000);
          }

          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'output', data: text }));
          }
        });

        proc.stderr.on('data', (data) => {
          console.error('stderr:', data.toString());
        });

        proc.on('close', (code, signal) => {
          console.log(`Process exited: code=${code}, signal=${signal}`);
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'exit', code, signal }));
          }
          sessionProcesses.delete(sessionId);
        });

        ws.send(JSON.stringify({ type: 'ready' }));
      } else if (message.type === 'input') {
        if (proc && proc.stdin) {
          proc.stdin.write(message.data + '\r');
        }
      } else if (message.type === 'interrupt') {
        if (proc && proc.stdin) {
          proc.stdin.write('\x03');
        }
      }
    } catch (error) {
      console.error('WebSocket error:', error);
      ws.send(JSON.stringify({ type: 'error', message: error.message }));
    }
  });

  ws.on('close', () => {
    if (proc && !proc.killed && proc.exitCode === null) {
      proc.kill();
    }
    sessionProcesses.delete(sessionId);
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close(() => {
    process.exit(0);
  });
});
