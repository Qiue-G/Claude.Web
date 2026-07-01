/**
 * Admin routes — protected by ADMIN_TOKEN.
 *
 * GET  /api/admin/sessions     — list all sessions (admin only)
 * GET  /api/admin/health       — detailed health (admin only)
 */
import { Router } from 'express';
import { requireAdmin } from '../auth/middleware.js';

export function createAdminRouter(deps) {
  const { sessions, sessionProcesses, sessionProxies, modelStats, mcpManager, rag, db } = deps;
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
        proxyAlive: sessionProxies.has(sid),
        processAlive: sessionProcesses.has(sid),
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

  return router;
}
