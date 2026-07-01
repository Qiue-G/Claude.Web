/**
 * Health check routes.
 * GET /api/health             — basic server health (for load balancer / Railway)
 * GET /api/health/detailed   — detailed health with RAG/MCP/DB status
 */
import { Router } from 'express';

export function createHealthRouter(deps) {
  const {
    sessions, PROVIDERS, DEFAULTS, MAX_SESSIONS, sessionProxies,
    modelStats, rateLimits, RATE_MAX_CREATE, VERSION,
    allowDetailedHealth = false,
    // C3: new deps for subsystem health
    mcpManager = null,
    rag = null,
    db = null
  } = deps;
  const router = Router();

  // Basic health — lightweight, for load balancer probes
  router.get('/', (req, res) => {
    const mem = process.memoryUsage();
    const dbOk = db ? (() => { try { db.exec('SELECT 1'); return true; } catch { return false; } })() : null;

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
      },
      // C3: subsystem status
      subsystems: {
        database: dbOk ? 'ok' : (db ? 'error' : 'n/a'),
        mcp: mcpManager ? (mcpManager.isConnected() ? 'ok' : 'disconnected') : 'n/a',
        rag: rag ? 'ok' : 'n/a'
      }
    });
  });

  if (allowDetailedHealth) {
    router.get('/detailed', (req, res) => {
      const models = modelStats.getAll();

      const sessionList = [];
      for (const [sid, s] of sessions) {
        const proxyAlive = sessionProxies.has(sid);
        sessionList.push({
          sessionId: sid,
          model: s.currentModel || s.model,
          health: s.modelHealth,
          provider: s.provider,
          proxyAlive,
          createdAt: s.createdAt,
          lastActivity: s.lastActivity
        });
      }

      // C3: RAG metrics snapshot
      let ragMetrics = null;
      if (rag) {
        try { ragMetrics = rag.getMetricsSnapshot(); } catch { /* ignore */ }
      }

      // C3: MCP server details
      let mcpServers = null;
      if (mcpManager) {
        try { mcpServers = mcpManager.getServerNames(); } catch { /* ignore */ }
      }

      res.json({
        models,
        sessions: sessionList,
        uptime: process.uptime(),
        rateLimits: rateLimits.snapshot(RATE_MAX_CREATE),
        config: {
          providers: Object.keys(PROVIDERS),
          defaults: DEFAULTS,
          maxSessions: MAX_SESSIONS
        },
        // C3: extended subsystem info
        subsystems: {
          database: db ? 'ok' : 'n/a',
          mcp: {
            connected: mcpManager ? mcpManager.isConnected() : false,
            servers: mcpServers || []
          },
          rag: {
            status: rag ? 'ok' : 'n/a',
            metrics: ragMetrics
          }
        }
      });
    });
  }

  return router;
}
