import { readFileSync } from 'fs';
import { join, dirname as pathDirname } from 'path';
import { fileURLToPath } from 'url';
import { initDb } from './db.js';
import { createRateLimiter } from './lib/rateLimiter.js';
import { createSessionManager } from './sessionManager.js';
import { createMessageStore } from './messageStore.js';
import { createMcpManager } from './mcp/index.js';
import { createRagSystem } from '../rag/index.js';
import { createAuditLog } from './lib/auditLog.js';
import { ActivityLog } from './collab/activityLog.js';
import { logger } from './lib/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = pathDirname(__filename);

function loadEnvFile() {
  try {
    const envContent = readFileSync('.env', 'utf-8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) return;
      let key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key) process.env[key] = value;
    });
  } catch (e) {}
}

export async function bootstrap() {
  // ===== Load .env =====
  loadEnvFile();

  // ===== 安全检查: JWT_SECRET =====
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'fc-auth-dev-secret-do-not-use-in-production') {
    console.error('致命错误: 必须设置强 JWT_SECRET 环境变量！');
    console.error('建议: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
  }

  // ===== 安全检查: ENCRYPTION_KEY =====
  if (!process.env.ENCRYPTION_KEY) {
    console.error('致命错误: 必须设置 ENCRYPTION_KEY 环境变量用于 API Key 加密！');
    console.error('建议: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
  }

  const PORT = process.env.PORT || 3000;
  const HOST = process.env.HOST || '0.0.0.0';
  const WORKSPACE_DIR = process.env.WORKSPACE_DIR || join(__dirname, '../../workspace');
  const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '10');
  const VERSION = '7.3.2';
  const FREE_CODE_DIR = process.env.FREE_CODE_DIR || (process.platform === 'win32' ? join(__dirname, '../..') : '/free-code');
  const CONFIG_PATH = process.env.AGENT_CONFIG_PATH || join(FREE_CODE_DIR, 'agent-config.json');

  // ===== Load agent config =====
  let agentConfig = { defaults: { provider: 'openrouter', model: '' }, providers: {} };
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    agentConfig = JSON.parse(raw);
    logger.info('Config loaded', { providers: Object.keys(agentConfig.providers || {}).length });
  } catch (e) {
    logger.warn('Using built-in defaults', { error: e.message });
  }

  const DEFAULTS = agentConfig.defaults || { provider: 'openrouter', model: '' };
  const PROVIDERS = agentConfig.providers || {};

  function getProviderConfig(provider) {
    return PROVIDERS[provider] || PROVIDERS[DEFAULTS.provider] || { models: [], fallbackModel: null, modelAliases: {} };
  }

  // ===== Rate Limiter (token bucket, per-IP) =====
  const RATE_WINDOW = 60000;      // 1 minute window
  const RATE_MAX_CREATE = 5;      // max session creates per window per IP
  const RATE_MAX_INPUT = 20;      // max WebSocket inputs per window per session
  const { check: checkRateLimit, remaining: getRateRemaining, snapshot: rateLimitsSnapshot } = createRateLimiter(RATE_WINDOW);

  // ===== Database (SQLite) =====
  const { db, monitor, saveDb } = await initDb(WORKSPACE_DIR);

  // ===== Performance Metrics ====
  const { PerfMetrics } = await import('./lib/perfMetrics.js');
  const perfMetrics = new PerfMetrics();

  // ===== Process Pool (E3) =====
  const { ProcessPool } = await import('./lib/processPool.js');
  const processPool = new ProcessPool({ maxSize: 8, idleTimeout: 300000, maxPerSession: 2 });

  // ===== Audit Log (D3) =====
  const auditLog = createAuditLog(db);

  // ===== Session Manager (persisted to SQLite) =====
  const { sessions, createSession, getSession, deleteSession, loadSessions } = createSessionManager({ db, saveDb, workspaceDir: WORKSPACE_DIR, auditLog });

  // ===== Message Store (persisted to SQLite) =====
  const messageStore = createMessageStore({ db, monitor, saveDb });

  // ===== Activity Log (T5) =====
  const activityLog = new ActivityLog({ db });

  // ===== MCP Manager =====
  const mcpConfigs = [];
  if (agentConfig.mcpServers && Array.isArray(agentConfig.mcpServers)) {
    mcpConfigs.push(...agentConfig.mcpServers);
  }
  // Also support MCP_SERVERS env var as JSON override
  try {
    if (process.env.MCP_SERVERS) {
      const envServers = JSON.parse(process.env.MCP_SERVERS);
      if (Array.isArray(envServers)) mcpConfigs.push(...envServers);
    }
  } catch (e) {
    logger.warn('Failed to parse MCP_SERVERS env', { error: e.message });
  }
  const mcpManager = createMcpManager();
  if (mcpConfigs.length > 0) {
    mcpManager.connectServers(mcpConfigs).then(() => {
      logger.info('MCP servers connected', { count: mcpManager.getServerNames().length });
    });
  } else {
    logger.info('No MCP servers configured');
  }

  // ===== RAG System =====
  const rag = await createRagSystem({
    db,
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL,
    model: process.env.RAG_EMBEDDING_MODEL || 'text-embedding-3-small',
    dimensions: parseInt(process.env.RAG_EMBEDDING_DIMENSIONS || '256'),
    chunkSize: parseInt(process.env.RAG_CHUNK_SIZE || '512'),
    chunkOverlap: parseInt(process.env.RAG_CHUNK_OVERLAP || '128'),
    vectorStoreType: process.env.VECTOR_STORE_TYPE || 'memory',
    qdrantUrl: process.env.VECTOR_STORE_QDRANT_URL,
    qdrantApiKey: process.env.VECTOR_STORE_QDRANT_API_KEY,
  });
  logger.info('RAG system initialized', { dimensions: rag.embedder.dimensions });

  // ===== Allowed origins for CORS & WebSocket =====
  const BASE_ORIGINS = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
      ];

  const RAILWAY_URL = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_STATIC_URL;
  const ALLOWED_ORIGINS = RAILWAY_URL
    ? [...BASE_ORIGINS, 'https://' + RAILWAY_URL]
    : BASE_ORIGINS;

  return {
    PORT,
    HOST,
    WORKSPACE_DIR,
    MAX_SESSIONS,
    VERSION,
    FREE_CODE_DIR,
    CONFIG_PATH,
    agentConfig,
    DEFAULTS,
    PROVIDERS,
    getProviderConfig,
    ALLOWED_ORIGINS,
    checkRateLimit,
    getRateRemaining,
    rateLimitsSnapshot,
    RATE_WINDOW,
    RATE_MAX_CREATE,
    RATE_MAX_INPUT,
    db,
    monitor,
    saveDb,
    perfMetrics,
    processPool,
    auditLog,
    sessions,
    createSession,
    getSession,
    deleteSession,
    loadSessions,
    messageStore,
    activityLog,
    mcpManager,
    rag,
  };
}
