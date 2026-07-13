/**
 * Admin routes — protected by ADMIN_TOKEN.
 *
 * GET  /api/admin/sessions     — list all sessions (admin only)
 * GET  /api/admin/health       — detailed health (admin only)
 * GET  /api/admin/audit-logs   — audit log query (admin only)
 */
import { Router } from 'express';
import { requireAdmin } from '../auth/middleware.js';

export function createAdminRouter(deps) {
  const { sessions, sessionProcesses, sessionProxies, sessionClients, modelStats, mcpManager, rag, db, auditLog, processPool, monitor, messageStore } = deps;
  const router = Router();

  // All admin routes require admin token
  router.use(requireAdmin);

  // List all sessions with details
  router.get('/sessions', (req, res) => {
    const sessionList = [];
    for (const [sid, s] of sessions) {
      sessionList.push({
        sessionId: sid,
        model: s.currentModel || s.model,
        provider: s.provider,
        health: s.modelHealth,
        wsConnected: (sessionClients && sessionClients.has(sid) && sessionClients.get(sid).size > 0) || false,
        createdAt: s.createdAt,
        lastActivity: s.lastActivity
      });
    }

    res.json({
      total: sessionList.length,
      sessions: sessionList
    });
  });

  // Detailed system health (admin only)
  router.get('/health', (req, res) => {
    const mem = process.memoryUsage();

    let ragMetrics = null;
    if (rag) {
      try { ragMetrics = rag.getMetricsSnapshot(); } catch { /* ignore */ }
    }

    let mcpServers = null;
    if (mcpManager) {
      try { mcpServers = mcpManager.getServerNames(); } catch { /* ignore */ }
    }

    const dbOk = db ? (() => { try { db.exec('SELECT 1'); return true; } catch { return false; } })() : null;

    res.json({
      status: 'ok',
      uptime: process.uptime(),
      memory: {
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        rssMB: Math.round(mem.rss / 1024 / 1024)
      },
      sessions: sessions.size,
      modelStats: modelStats.getAll(),
      processPool: processPool ? processPool.stats() : null,
      subsystems: {
        database: dbOk ? 'ok' : (db ? 'error' : 'n/a'),
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

  // Audit logs query (admin only)
  router.get('/audit-logs', (req, res) => {
    if (!auditLog) {
      return res.status(501).json({ error: 'Audit log not initialized', code: 'audit_disabled' });
    }

    const { limit = 100, offset = 0, action, sessionId, startDate, endDate } = req.query;

    try {
      const logs = auditLog.getLogs({
        limit: parseInt(limit),
        offset: parseInt(offset),
        action,
        sessionId,
        startDate,
        endDate
      });

      res.json({
        total: logs.length,
        logs
      });
    } catch (e) {
      res.status(500).json({ error: 'Failed to query audit logs', code: 'audit_query_error' });
    }
  });

  /**
   * GET /api/admin/slow-queries — SQLite 慢查询记录 (E4)
   */
  router.get('/slow-queries', (req, res) => {
    if (!monitor) {
      return res.json({ slowQueries: [] });
    }
    res.json({ slowQueries: monitor.getSlowQueries() });
  });

  // Force-kill a zombie session (admin only)
  router.post('/sessions/:id/kill', (req, res) => {
    const sid = req.params.id;
    const session = sessions.get(sid);
    if (!session) {
      return res.status(404).json({ error: 'Session not found', code: 'session_not_found' });
    }

    const killed = { proxy: false, process: false, ws: false };
    const proxy = sessionProxies.get(sid);
    if (proxy) {
      try { proxy.kill('SIGKILL'); } catch (_) {}
      sessionProxies.delete(sid);
      killed.proxy = true;
    }
    const proc = sessionProcesses.get(sid);
    if (proc) {
      try { proc.kill('SIGKILL'); } catch (_) {}
      sessionProcesses.delete(sid);
      killed.process = true;
    }
    // Disconnect WebSocket clients for this session
    if (sessionClients) {
      const sClients = sessionClients.get(sid);
      if (sClients) {
        for (const client of sClients) {
          try { client.close(); } catch (_) {}
        }
        sessionClients.delete(sid);
        killed.ws = true;
      }
    }

    // Clean up message store for this session
    if (messageStore) {
      try { messageStore.deleteSessionMessages(sid); } catch (_) {}
    }

    sessions.delete(sid);
    res.json({ killed: true, sessionId: sid, details: killed });
  });

  // Aggregated system stats (admin only)
  router.get('/stats', (req, res) => {
    const mem = process.memoryUsage();

    // Count messages per session from DB
    let messageCount = 0;
    let activeModels = {};
    try {
      const rows = db ? db.exec('SELECT COUNT(*) as cnt FROM messages') : [];
      messageCount = rows[0]?.values?.[0]?.[0] || 0;

      // Model usage stats
      for (const [_, s] of sessions) {
        const model = s.currentModel || s.model || 'unknown';
        activeModels[model] = (activeModels[model] || 0) + 1;
      }
    } catch (_) {}

    // Count WebSocket-connected sessions
    let wsConnected = 0;
    if (sessionClients) {
      for (const [_, clients] of sessionClients) {
        if (clients && clients.size > 0) wsConnected++;
      }
    }

    res.json({
      uptime: Math.round(process.uptime()),
      memory: {
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        rssMB: Math.round(mem.rss / 1024 / 1024)
      },
      sessions: {
        active: sessions.size,
        wsConnected,
        idle: sessions.size - wsConnected,
      },
      messages: { total: messageCount },
      models: activeModels,
      processPool: processPool ? processPool.stats() : null,
    });
  });

  return router;
}
