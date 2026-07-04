/**
 * Session CRUD routes.
 * POST  /api/session          — create a new session
 * GET   /api/session/:id      — get session info
 * DELETE /api/session/:id     — delete session + messages
 * POST   /api/session/:id/share             — generate share link
 * DELETE /api/session/:id/share             — revoke share link
 * POST   /api/session/:id/collaborators     — add collaborator
 * DELETE /api/session/:id/collaborators/:username — remove collaborator
 * GET    /api/session/:id/collaborators     — list collaborators
 * POST   /api/session/join/:token           — join session via share token
 */
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { AppError } from '../lib/AppError.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../auth/authMiddleware.js';

export function createSessionRouter(deps) {
  const { createSession, getSession, deleteSession, sessions, sessionProcesses, sessionProxies, messageStore, checkRateLimit, RATE_WINDOW, RATE_MAX_CREATE, MAX_SESSIONS, DEFAULTS, db } = deps;
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

    // 如果用户已登录，关联 owner_id
    if (req.user) {
      session.owner_id = req.user.id;
      try {
        db.run('UPDATE sessions SET owner_id = ? WHERE id = ?', [req.user.id, session.id]);
      } catch (e) {
        console.error('[SESSION] set owner_id failed:', e.message);
      }
    }

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
    // 解析 coauthors
    let coauthors = [];
    try { coauthors = JSON.parse(session.coauthors || '[]'); } catch (_) {}
    res.json({
      sessionId: session.id,
      model: session.model,
      provider: session.provider,
      owner_id: session.owner_id || null,
      coauthors,
      status: session.status || 'private'
    });
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

  /**
   * POST /api/session/:id/share
   * 生成分享链接
   */
  router.post('/:id/share', requireAuth, asyncHandler(async (req, res) => {
    const token = req.headers['x-session-token'];
    const session = getSession(req.params.id, token);
    if (!session) throw new AppError(401, 'Invalid session or token');

    // 验证权限：只有 owner 可以分享
    if (session.owner_id && session.owner_id !== req.user.id) {
      throw new AppError(403, 'Only the session owner can share this session');
    }

    const shareToken = randomUUID().replace(/-/g, '').slice(0, 16);
    session.share_token = shareToken;
    session.status = 'shared';

    try {
      db.run('UPDATE sessions SET share_token = ?, status = ? WHERE id = ?', [shareToken, 'shared', req.params.id]);
    } catch (e) {
      console.error('[SESSION] share failed:', e.message);
      throw new AppError(500, 'Failed to share session');
    }

    res.json({ shareToken, shareUrl: `/api/session/join/${shareToken}`, status: 'shared' });
  }));

  /**
   * DELETE /api/session/:id/share
   * 取消分享
   */
  router.delete('/:id/share', requireAuth, asyncHandler(async (req, res) => {
    const token = req.headers['x-session-token'];
    const session = getSession(req.params.id, token);
    if (!session) throw new AppError(401, 'Invalid session or token');

    // 验证权限
    if (session.owner_id && session.owner_id !== req.user.id) {
      throw new AppError(403, 'Only the session owner can unshare this session');
    }

    session.share_token = null;
    session.status = 'private';

    try {
      db.run('UPDATE sessions SET share_token = NULL, status = ? WHERE id = ?', ['private', req.params.id]);
    } catch (e) {
      console.error('[SESSION] unshare failed:', e.message);
      throw new AppError(500, 'Failed to unshare session');
    }

    res.json({ success: true, status: 'private' });
  }));

  /**
   * POST /api/session/:id/collaborators
   * 添加协作者
   */
  router.post('/:id/collaborators', requireAuth, asyncHandler(async (req, res) => {
    const { username } = req.body || {};
    if (!username || typeof username !== 'string') {
      throw new AppError(400, 'Username is required');
    }

    const token = req.headers['x-session-token'];
    const session = getSession(req.params.id, token);
    if (!session) throw new AppError(401, 'Invalid session or token');

    // 验证权限
    if (session.owner_id && session.owner_id !== req.user.id) {
      throw new AppError(403, 'Only the session owner can add collaborators');
    }

    // 查找用户
    const userRows = db.exec('SELECT id, username FROM users WHERE username = ?', [username.trim()]);
    if (!userRows?.[0]?.values?.length) {
      throw new AppError(404, 'User not found');
    }

    const inviteeId = userRows[0].values[0][0];
    const inviteeUsername = userRows[0].values[0][1];

    // 解析当前协作者列表
    let coauthors = [];
    try { coauthors = JSON.parse(session.coauthors || '[]'); } catch (_) {}

    // 检查是否已存在
    if (coauthors.some(c => c.username === inviteeUsername)) {
      throw new AppError(409, 'User is already a collaborator');
    }

    // 添加协作者
    coauthors.push({ id: inviteeId, username: inviteeUsername });
    session.coauthors = JSON.stringify(coauthors);

    try {
      db.run('UPDATE sessions SET coauthors = ? WHERE id = ?', [session.coauthors, req.params.id]);

      // 记录到 share_sessions 表
      const shareId = randomUUID();
      db.run(
        'INSERT INTO share_sessions (id, session_id, inviter_id, invitee_id, permission) VALUES (?, ?, ?, ?, ?)',
        [shareId, req.params.id, req.user.id, inviteeId, 'read']
      );
    } catch (e) {
      console.error('[SESSION] add collaborator failed:', e.message);
      throw new AppError(500, 'Failed to add collaborator');
    }

    res.json({ success: true, collaborators: coauthors });
  }));

  /**
   * DELETE /api/session/:id/collaborators/:username
   * 移除协作者
   */
  router.delete('/:id/collaborators/:username', requireAuth, asyncHandler(async (req, res) => {
    const token = req.headers['x-session-token'];
    const session = getSession(req.params.id, token);
    if (!session) throw new AppError(401, 'Invalid session or token');

    // 验证权限
    if (session.owner_id && session.owner_id !== req.user.id) {
      throw new AppError(403, 'Only the session owner can remove collaborators');
    }

    const username = req.params.username;
    let coauthors = [];
    try { coauthors = JSON.parse(session.coauthors || '[]'); } catch (_) {}

    const idx = coauthors.findIndex(c => c.username === username);
    if (idx === -1) {
      throw new AppError(404, 'Collaborator not found');
    }

    const removed = coauthors.splice(idx, 1);
    session.coauthors = JSON.stringify(coauthors);

    try {
      db.run('UPDATE sessions SET coauthors = ? WHERE id = ?', [session.coauthors, req.params.id]);

      // 从 share_sessions 表删除
      db.run(
        'DELETE FROM share_sessions WHERE session_id = ? AND invitee_id = (SELECT id FROM users WHERE username = ?)',
        [req.params.id, username]
      );
    } catch (e) {
      console.error('[SESSION] remove collaborator failed:', e.message);
      throw new AppError(500, 'Failed to remove collaborator');
    }

    res.json({ success: true, collaborators: coauthors });
  }));

  /**
   * GET /api/session/:id/collaborators
   * 获取协作者列表
   */
  router.get('/:id/collaborators', requireAuth, asyncHandler(async (req, res) => {
    const token = req.headers['x-session-token'];
    const session = getSession(req.params.id, token);
    if (!session) throw new AppError(401, 'Invalid session or token');

    let coauthors = [];
    try { coauthors = JSON.parse(session.coauthors || '[]'); } catch (_) {}

    res.json({ collaborators: coauthors });
  }));

  /**
   * POST /api/session/join/:token
   * 通过 share_token 加入会话
   */
  router.post('/join/:token', requireAuth, asyncHandler(async (req, res) => {
    const shareToken = req.params.token;

    // 查找共享的 session
    const rows = db.exec('SELECT id FROM sessions WHERE share_token = ? AND status = ?', [shareToken, 'shared']);
    if (!rows?.[0]?.values?.length) {
      throw new AppError(404, 'Share link is invalid or has been revoked');
    }

    const sessionId = rows[0].values[0][0];
    const session = sessions.get(sessionId);
    if (!session) throw new AppError(404, 'Session not found');

    // 解析协作者列表
    let coauthors = [];
    try { coauthors = JSON.parse(session.coauthors || '[]'); } catch (_) {}

    // 检查是否已经是协作者
    const isOwner = session.owner_id === req.user.id;
    const isCollaborator = coauthors.some(c => c.id === req.user.id);

    if (!isOwner && !isCollaborator) {
      // 自动添加为协作者
      coauthors.push({ id: req.user.id, username: req.user.username });
      session.coauthors = JSON.stringify(coauthors);

      try {
        db.run('UPDATE sessions SET coauthors = ? WHERE id = ?', [session.coauthors, sessionId]);

        const shareId = randomUUID();
        db.run(
          'INSERT INTO share_sessions (id, session_id, inviter_id, invitee_id, permission) VALUES (?, ?, ?, ?, ?)',
          [shareId, sessionId, session.owner_id || '', req.user.id, 'read']
        );
      } catch (e) {
        console.error('[SESSION] join failed:', e.message);
        throw new AppError(500, 'Failed to join session');
      }
    }

    res.json({ success: true, sessionId });
  }));

  return router;
}
