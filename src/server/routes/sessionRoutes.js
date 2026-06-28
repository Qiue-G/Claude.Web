/**
 * Session CRUD routes.
 * POST  /api/session          — create a new session
 * GET   /api/session/:id      — get session info
 * DELETE /api/session/:id     — delete session + messages
 */
import { Router } from 'express';

export function createSessionRouter(deps) {
  const { createSession, getSession, deleteSession, sessions, sessionProcesses, sessionProxies, messageStore, checkRateLimit, RATE_WINDOW, RATE_MAX_CREATE, MAX_SESSIONS, DEFAULTS } = deps;
  const VALID_PROVIDERS = ['openrouter', 'anthropic', 'openai', 'deepseek'];
  const router = Router();

  router.post('/', async (req, res) => {
    try {
      const ip = req.ip || req.connection?.remoteAddress || 'unknown';
      if (!checkRateLimit('create:' + ip, RATE_MAX_CREATE, RATE_WINDOW)) {
        return res.status(429).json({
          error: 'Too many session requests. Please wait before creating another.',
          retryAfter: 60
        });
      }

      const { apiKey, model, provider } = req.body;
      if (!apiKey || typeof apiKey !== 'string' || apiKey.length > 200)
        return res.status(400).json({ error: 'Invalid API key' });
      if (model && (typeof model !== 'string' || model.length > 100 || !/^[\w.\-\/]+$/.test(model)))
        return res.status(400).json({ error: 'Invalid model' });
      if (provider && !VALID_PROVIDERS.includes(provider))
        return res.status(400).json({ error: 'Invalid provider' });
      if (sessions.size >= MAX_SESSIONS)
        return res.status(503).json({ error: 'Too many sessions' });

      const session = await createSession(apiKey, model || DEFAULTS.model, provider || DEFAULTS.provider, MAX_SESSIONS);
      res.json({ sessionId: session.id, token: session.token, csrfToken: session.csrfToken });
    } catch (error) {
      res.status(500).json({ error: 'Failed to create session' });
    }
  });

  router.get('/:id', (req, res) => {
    const token = req.headers['x-session-token'];
    const session = getSession(req.params.id, token);
    if (!session) return res.status(401).json({ error: 'Invalid session or token' });
    res.json({ sessionId: session.id, model: session.model, provider: session.provider });
  });

  router.delete('/:id', async (req, res) => {
    const token = req.headers['x-session-token'];
    const session = getSession(req.params.id, token);
    if (session) {
      const csrfToken = req.headers['x-csrf-token'];
      if (!csrfToken || csrfToken !== session.csrfToken)
        return res.status(403).json({ error: 'CSRF token missing or invalid' });
      const oldProc = sessionProcesses.get(req.params.id);
      if (oldProc) { oldProc.kill(); sessionProcesses.delete(req.params.id); }
      const oldProxy = sessionProxies.get(req.params.id);
      if (oldProxy) { oldProxy.kill(); sessionProxies.delete(req.params.id); }
      await deleteSession(req.params.id);
      await messageStore.deleteSessionMessages(req.params.id);
    }
    res.json({ success: true });
  });

  return router;
}
