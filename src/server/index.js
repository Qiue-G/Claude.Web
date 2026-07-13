import { WebSocketServer } from 'ws';
import { createApp } from './app.js';
import { createWsHandler } from './routes/wsHandler.js';
import { bootstrap } from './bootstrap.js';
import { logger } from './lib/logger.js';

const deps = await bootstrap();

// ===== Per-session state maps =====
const sessionProcesses = new Map();
const sessionProxies = new Map();
const wsProcCount = new Map();
const sessionClients = new Map();

// ===== Event buffer for replay on reconnect =====
const MAX_BUFFERED_EVENTS = 100;
const sessionEventBuffers = new Map(); // sessionId → Array<{seq, message}>

function bufferEvent(sessionId, message) {
  let buf = sessionEventBuffers.get(sessionId);
  if (!buf) { buf = []; sessionEventBuffers.set(sessionId, buf); }
  const seq = (buf.length > 0 ? buf[buf.length - 1].seq + 1 : 1);
  buf.push({ seq, message });
  if (buf.length > MAX_BUFFERED_EVENTS) buf.shift();
}

function getBufferedEvents(sessionId, lastSeq = 0) {
  const buf = sessionEventBuffers.get(sessionId);
  return buf ? buf.filter(e => e.seq > lastSeq).map(e => e.message) : [];
}

// ===== Dynamic import of CLI runner utilities =====
const {
  broadcastToSession: _broadcastToSession,
  spawnCli: _spawnCli,
  callModelWithTools: _callModelWithTools,
  callModelWithMessages: _callModelWithMessages,
  maskSensitive,
  stripAnsi,
  modelStats
} = await import('./cliRunner.js');

// Bind sessionClients into broadcastToSession, with event buffering
const broadcastToSession = (sessionId, message) => {
  const clients = sessionClients.get(sessionId);
  // Always buffer for replay on reconnect
  bufferEvent(sessionId, message);
  // Only push to live clients
  if (!clients || clients.size === 0) return;
  _broadcastToSession(sessionClients, sessionId, message);
};

// Bind extra params into spawnCli
const spawnCli = (session, prompt) => _spawnCli(session, prompt, deps.agentConfig, sessionClients, sessionProxies);

// Bind extra params into callModelWithTools
const callModelWithTools = (session, prompt, tools) => _callModelWithTools(session, prompt, tools, deps.agentConfig, sessionClients, sessionProxies);

// Bind extra params into callModelWithMessages
const callModelWithMessages = (session, systemPrompt, messages, tools) => _callModelWithMessages(session, systemPrompt, messages, tools, deps.agentConfig, sessionClients, sessionProxies);

// ===== Create Express app =====
const app = createApp({
  ...deps,
  sessionProcesses,
  sessionProxies,
  sessionClients,
  modelStats,
});

// ===== Startup: load persisted sessions =====
await deps.loadSessions();

const server = app.listen(
  deps.PORT,
  deps.HOST,
  () => {
    logger.info('Server started', { version: deps.VERSION, host: deps.HOST, port: deps.PORT });
  }
);

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

// WebSocket connection handling is in routes/wsHandler.js
wss.on('connection', createWsHandler({
  getSession: deps.getSession,
  sessions: deps.sessions,
  sessionProcesses,
  sessionProxies,
  sessionClients,
  wsProcCount,
  broadcastToSession,
  getBufferedEvents,
  spawnCli,
  callModelWithTools,
  callModelWithMessages,
  maskSensitive,
  stripAnsi,
  checkRateLimit: deps.checkRateLimit,
  ALLOWED_ORIGINS: deps.ALLOWED_ORIGINS,
  RATE_WINDOW: deps.RATE_WINDOW,
  RATE_MAX_INPUT: deps.RATE_MAX_INPUT,
  messageStore: deps.messageStore,
  mcpManager: deps.mcpManager,
  rag: deps.rag,
  agentConfig: deps.agentConfig,
  processPool: deps.processPool,
  db: deps.db,
  activityLog: deps.activityLog,
}));

async function gracefulShutdown(signal) {
  logger.info('Shutdown signal received', { signal });

  // 1. Kill proxy processes (SIGTERM first, then SIGKILL after grace period)
  const proxyIds = [...sessionProxies.keys()];
  for (const id of proxyIds) {
    const p = sessionProxies.get(id);
    if (p && !p.killed) {
      try { p.kill('SIGTERM'); } catch (e) { /* already dead */ }
    }
  }
  // 2. Kill CLI processes
  const procIds = [...sessionProcesses.keys()];
  for (const id of procIds) {
    const p = sessionProcesses.get(id);
    if (p && !p.killed) {
      try { p.kill('SIGTERM'); } catch (e) { /* already dead */ }
    }
  }

  // Grace period for SIGTERM to work, then force kill zombies
  await new Promise(r => setTimeout(r, 3000));
  const zombieProxies = [...sessionProxies.values()].filter(p => p && !p.killed);
  const zombieProcs = [...sessionProcesses.values()].filter(p => p && !p.killed);
  for (const p of zombieProxies) {
    try { p.kill('SIGKILL'); logger.warn('Force killed zombie proxy'); } catch (e) {}
  }
  for (const p of zombieProcs) {
    try { p.kill('SIGKILL'); logger.warn('Force killed zombie process'); } catch (e) {}
  }
  sessionProxies.clear();
  sessionProcesses.clear();

  // 2b. Destroy process pool
  await deps.processPool.destroy();
  logger.info('Process pool destroyed');

  // 3. Disconnect MCP servers (C3)
  try {
    await deps.mcpManager.disconnectAll();
    logger.info('MCP servers disconnected');
  } catch (e) {
    logger.error('MCP disconnect failed', { error: e.message });
  }

  // 4. Save message store
  try {
    await deps.messageStore.save();
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
  // 优雅关闭而非直接 exit，确保数据持久化完成
  gracefulShutdown('uncaughtException').then(() => {
    process.exit(1);
  });
  // 超时保护：5 秒后强制退出
  setTimeout(() => process.exit(1), 5000);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
  gracefulShutdown('unhandledRejection').then(() => {
    process.exit(1);
  });
  setTimeout(() => process.exit(1), 5000);
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
    const session = deps.sessions.get(sessionId);
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
  for (const [id, session] of deps.sessions) {
    if (now - session.lastActivity > SESSION_TIMEOUT) {
      expiredIds.push(id);
      const proc = sessionProcesses.get(id);
      if (proc) { try { proc.kill(); } catch (e) {} sessionProcesses.delete(id); }
      const proxy = sessionProxies.get(id);
      if (proxy) { try { proxy.kill(); } catch (e) {} sessionProxies.delete(id); }
      wsProcCount.delete(id);
    }
  }
  if (expiredIds.length > 0) {
     for (const id of expiredIds) {
       // C1: Notify connected clients before deleting session
       broadcastToSession(id, { type: 'session_expired' });
       sessionClients.delete(id);
       sessionEventBuffers.delete(id);
       await deps.deleteSession(id);
       await deps.messageStore.deleteSessionMessages(id);
     }
     logger.info('Sessions expired', { count: expiredIds.length });
   }
}, 60000);
