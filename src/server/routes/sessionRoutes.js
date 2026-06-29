/**
 * Session CRUD routes.
 * POST  /api/session          — create a new session
 * GET   /api/session/:id      — get session info
 * DELETE /api/session/:id     — delete session + messages
 */
import { Router } from 'express';
import { AppError } from '../lib/AppError.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export function createSessionRouter(deps) {
  const { createSession, getSession, deleteSession, sessions, sessionProcesses, sessionProxies, messageStore, checkRateLimit, RATE_WINDOW, RATE_MAX_CREATE, MAX_SESSIONS, DEFAULTS } = deps;
  const VALID_PROVIDERS = ['openrouter', 'anthropic', 'openai', 'deepseek'];
  const router = Router();

  router.post('/', asyncHandler(async (req, res) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    if (!checkRateLimit('create:' + ip, RATE_MAX_CREATE, RATE_WINDOW)) {
      throw new AppError(429, 'Too many session requests. Please wait before creating another.', { retryAfter: 60 });
    }

    const { apiKey, model, provider } = req.body;
    if (!apiKey || typeof apiKey !== 'string' || apiKey.length > 200)
      throw new AppError(400, 'Invalid API key');
    if (model && (typeof model !== 'string' || model.length > 100 || !/^[\w.\-\/:]+$/.test(model)))
      throw new AppError(400, 'Invalid model');
    if (provider && !VALID_PROVIDERS.includes(provider))
      throw new AppError(400, 'Invalid provider');
    if (sessions.size >= MAX_SESSIONS)
      throw new AppError(503, 'Too many sessions');

    const session = await createSession(apiKey, model || DEFAULTS.model, provider || DEFAULTS.provider, MAX_SESSIONS);
    res.json({ sessionId: session.id, token: session.token, csrfToken: session.csrfToken });
  }));

  // 验证当前 session 凭证（用于页面刷新自动重连）
  router.get('/current', (req, res) => {
    const sid = req.headers['x-session-id'];
    const token = req.headers['x-session-token'];
    if (!sid || !token) throw new AppError(400, 'Missing credentials');
    const session = getSession(sid, token);
    if (!session) throw new AppError(401, 'Invalid session or token');
    res.json({ sessionId: session.id, model: session.model, provider: session.provider, currentModel: session.currentModel });
  });

  router.get('/:id', (req, res) => {
    const token = req.headers['x-session-token'];
    const session = getSession(req.params.id, token);
    if (!session) throw new AppError(401, 'Invalid session or token');
    res.json({ sessionId: session.id, model: session.model, provider: session.provider });
  });

  router.delete('/:id', asyncHandler(async (req, res) => {
    const token = req.headers['x-session-token'];
    const session = getSession(req.params.id, token);
    if (session) {
      const csrfToken = req.headers['x-csrf-token'];
      if (!csrfToken || csrfToken !== session.csrfToken)
        throw new AppError(403, 'CSRF token missing or invalid');
      const oldProc = sessionProcesses.get(req.params.id);
      if (oldProc) { oldProc.kill(); sessionProcesses.delete(req.params.id); }
      const oldProxy = sessionProxies.get(req.params.id);
      if (oldProxy) { oldProxy.kill(); sessionProxies.delete(req.params.id); }
      await deleteSession(req.params.id);
      await messageStore.deleteSessionMessages(req.params.id);
    }
    res.json({ success: true });
  }));

  return router;
}
