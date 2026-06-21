import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { readFile, writeFile, readdir, stat, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { spawn } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Strip ANSI escape codes - zero dependency
function strip(str) {
  // Replace cursor-forward with space (preserves layout)
  str = str.replace(/\x1b\[(\d+)C/g, (_, n) => ' '.repeat(parseInt(n)));
  // Strip remaining ANSI sequences
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}
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

// Version for deployment verification
const VERSION = '1.0.8';

// Sessions storage
const sessions = new Map();
const sessionProcesses = new Map();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, '../../public')));

// Session management
function createSession(apiKey, model = 'claude-opus-4-6', provider = 'anthropic') {
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
    // Kill any running process
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

    res.json({
      content,
      size: stats.size,
      modified: stats.mtime,
      path: req.query.path
    });
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

    // Create parent directories if needed
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
  console.log(`馃殌 Free-code Web Server v${VERSION} running on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`馃搧 Workspace: ${WORKSPACE_DIR}`);
  console.log(`馃摝 Free-code directory: ${FREE_CODE_DIR}`);
});

// WebSocket for real-time CLI interaction
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  let sessionId = null;
  let proc = null;

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'init':
          sessionId = message.sessionId;
          const session = getSession(sessionId);
          if (!session) {
            console.error(`Invalid session: ${sessionId}`);
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid session' }));
            ws.close();
            return;
          }

          console.log(`Starting CLI for session ${sessionId}`);
          console.log(`Session dir: ${session.dir}`);
          console.log(`Model: ${session.model}`);
          console.log(`Provider: ${session.provider}`);

          // Use the compiled binary from bun run build:dev:full
          // This creates an executable at /free-code/cli-dev
          const cliPath = join(FREE_CODE_DIR, 'cli-dev');
          
          console.log(`Attempting to spawn: ${cliPath}`);

          // Build CLI args: pass model via --model flag
          const cliArgs = [];
          if (session.model) {
            cliArgs.push('--model', session.model);
          }

          // Build provider-specific environment variables
          const providerEnv = {};
          switch (session.provider) {
            case 'openai':
              providerEnv.CLAUDE_CODE_USE_OPENAI = '1';
              break;
            case 'bedrock':
              providerEnv.CLAUDE_CODE_USE_BEDROCK = '1';
              break;
            case 'vertex':
              providerEnv.CLAUDE_CODE_USE_VERTEX = '1';
              break;
            case 'foundry':
              providerEnv.CLAUDE_CODE_USE_FOUNDRY = '1';
              break;
            case 'openrouter':
              providerEnv.ANTHROPIC_BASE_URL = 'https://openrouter.ai/api/v1';
              break;
            case 'anthropic':
            default:
              // Anthropic is the default, no special env needed
              break;
          }

          // Use socat to create a proper PTY bridge
          const cliCmd = [cliPath, ...cliArgs].map(a => `'${a}'`).join(' ');
          // raw mode: disable all processing on master side
          // The CLI will set raw mode on slave side when needed
          proc = spawn('socat', ['EXEC:' + cliCmd + ',pty,sane,echo=0,ctty,setsid,sigint,rows=50,cols=200', '-'], {
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

          proc.stdout.on('data', (data) => {
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({
                type: 'output',
                data: strip(data.toString())
              }));
            }
          });

          proc.stderr.on('data', (data) => {
            console.error('stderr:', data.toString());
          });

          proc.on('close', (code, signal) => {
            console.log(`Process exited with code ${code}, signal ${signal}`);
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: 'exit', code, signal }));
            }
            sessionProcesses.delete(sessionId);
          });

          ws.send(JSON.stringify({ type: 'ready' }));
          break;

        case 'input':
          if (proc && proc.stdin) {
            proc.stdin.write(message.data + '\r');
          }
          break;

        case 'interrupt':
          if (proc && proc.stdin) {
            proc.stdin.write('\x03');
          }
          break;

        case 'resize':
          // Handle terminal resize - send SIGWINCH to the PTY
          if (proc && message.cols && message.rows) {
            try {
              // Use stty to resize the PTY
              const resizeProc = spawn('stty', ['rows', String(message.rows), 'columns', String(message.cols)], {
                cwd: session.dir,
                stdio: ['pipe', 'pipe', 'pipe']
              });
              resizeProc.on('close', () => {});
            } catch (e) {
              console.error('Resize error:', e);
            }
          }
          break;
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



