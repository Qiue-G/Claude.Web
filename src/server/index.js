import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { readFile, writeFile, readdir, stat, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
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

const VERSION = '2.0.1';

// Sessions storage
const sessions = new Map();

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
    messages: [],
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
  sessions.delete(sessionId);
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
    uptime: process.uptime()
  });
});

// Create HTTP server
const server = app.listen(PORT, HOST, () => {
  console.log(`Free-code Web Server v${VERSION} running on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Workspace: ${WORKSPACE_DIR}`);
});

// WebSocket for chat
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
        ws.send(JSON.stringify({ type: 'ready' }));
      } else if (message.type === 'chat') {
        if (!sessionId) {
          ws.send(JSON.stringify({ type: 'error', message: 'Session not initialized' }));
          return;
        }

        const currentSession = getSession(sessionId);
        if (!currentSession) {
          ws.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
          return;
        }

        const userMessage = message.data;
        if (!userMessage || !userMessage.trim()) return;

        // Add user message to history
        currentSession.messages.push({ role: 'user', content: userMessage });

        // Build API request based on provider
        let apiUrl, apiHeaders, requestBody;

        if (currentSession.provider === 'openrouter') {
          apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
          apiHeaders = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentSession.apiKey}`
          };
          requestBody = {
            model: currentSession.model,
            messages: currentSession.messages,
            stream: true
          };
        } else if (currentSession.provider === 'anthropic') {
          apiUrl = 'https://api.anthropic.com/v1/messages';
          apiHeaders = {
            'Content-Type': 'application/json',
            'x-api-key': currentSession.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          };
          const anthropicMessages = currentSession.messages.map(m => ({
            role: m.role,
            content: m.content
          }));
          requestBody = {
            model: currentSession.model,
            messages: anthropicMessages,
            max_tokens: 4096,
            stream: true
          };
        } else if (currentSession.provider === 'openai') {
          apiUrl = 'https://api.openai.com/v1/chat/completions';
          apiHeaders = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentSession.apiKey}`
          };
          requestBody = {
            model: currentSession.model,
            messages: currentSession.messages,
            stream: true
          };
        } else {
          // Default: OpenRouter
          apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
          apiHeaders = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentSession.apiKey}`
          };
          requestBody = {
            model: currentSession.model,
            messages: currentSession.messages,
            stream: true
          };
        }

        try {
          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: apiHeaders,
            body: JSON.stringify(requestBody)
          });

          if (!response.ok) {
            const errText = await response.text();
            ws.send(JSON.stringify({ type: 'error', message: `API error: ${response.status} ${errText}` }));
            // Remove the failed user message
            currentSession.messages.pop();
            return;
          }

          // Stream response
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let fullResponse = '';
          let buffer = '';

          ws.send(JSON.stringify({ type: 'stream_start' }));

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data: ')) continue;

              const data = trimmed.slice(6);
              if (data === '[DONE]') continue;

              try {
                const json = JSON.parse(data);

                if (currentSession.provider === 'anthropic') {
                  if (json.type === 'content_block_delta') {
                    const text = json.delta?.text || '';
                    if (text) {
                      fullResponse += text;
                      ws.send(JSON.stringify({ type: 'stream', data: text }));
                    }
                  }
                } else {
                  const choice = json.choices?.[0];
                  const text = choice?.delta?.content || '';
                  if (text) {
                    fullResponse += text;
                    ws.send(JSON.stringify({ type: 'stream', data: text }));
                  }
                }
              } catch (e) {
                // Skip invalid JSON
              }
            }
          }

          // Add assistant response to history
          currentSession.messages.push({ role: 'assistant', content: fullResponse });
          ws.send(JSON.stringify({ type: 'stream_end' }));

        } catch (error) {
          ws.send(JSON.stringify({ type: 'error', message: error.message }));
          currentSession.messages.pop();
        }
      } else if (message.type === 'clear') {
        if (sessionId) {
          const currentSession = getSession(sessionId);
          if (currentSession) {
            currentSession.messages = [];
            ws.send(JSON.stringify({ type: 'cleared' }));
          }
        }
      }
    } catch (error) {
      console.error('WebSocket error:', error);
      ws.send(JSON.stringify({ type: 'error', message: error.message }));
    }
  });

  ws.on('close', () => {
    // Keep session alive
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close(() => {
    process.exit(0);
  });
});
