/**
 * Health check routes.
 * GET /api/health             — basic server health
 * GET /api/health/detailed   — detailed health with model stats & sessions
 */
import { Router } from 'express';

export function createHealthRouter(deps) {
  const { sessions, PROVIDERS, DEFAULTS, MAX_SESSIONS, sessionProxies, modelStats, rateLimits, RATE_MAX_CREATE, VERSION, allowDetailedHealth = false } = deps;
  const router = Router();

  router.get('/', (req, res) => {
    const mem = process.memoryUsage();
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
        createdAt: s.createdAt
      });
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
      }
    });
  });
  }

  return router;
}
