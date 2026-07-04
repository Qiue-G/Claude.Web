/**
 * User authentication routes.
 *
 * POST /api/auth/register  — create a new user (first user becomes admin)
 * POST /api/auth/login     — authenticate and return JWT
 * POST /api/auth/logout    — logout (client-side token removal)
 * GET  /api/auth/me        — get current user info (requires auth)
 */
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { hashPassword, verifyPassword } from './password.js';
import { signToken, requireAuth } from './authMiddleware.js';

// 登录暴力破解防护：基于 IP 的失败计数
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_BLOCK_DURATION = 60000; // 60 秒

/**
 * 检查密码复杂度
 * 要求至少包含大写字母、小写字母、数字中至少两种
 */
function checkPasswordComplexity(password) {
  let categories = 0;
  if (/[a-z]/.test(password)) categories++;
  if (/[A-Z]/.test(password)) categories++;
  if (/[0-9]/.test(password)) categories++;
  return categories >= 2;
}

/**
 * @param {object} deps
 * @param {object} deps.db - SQLite database handle with .run() and .exec() methods
 * @param {Function} deps.createSession - (apiKey, model, provider, maxSessions) => session object
 */
export function createUserRouter(deps) {
  const { db, createSession } = deps;
  const router = Router();

  /**
   * POST /api/auth/register
   * Body: { username, password }
   * First user registration => admin role. Subsequent => user role.
   * Also creates a new session.
   */
  router.post('/register', async (req, res) => {
    try {
      const { username, password } = req.body || {};
      if (!username || typeof username !== 'string' || username.trim().length < 3) {
        return res.status(400).json({ error: 'Username must be at least 3 characters', code: 'invalid_username' });
      }
      if (username.trim().length > 64) {
        return res.status(400).json({ error: 'Username must be at most 64 characters', code: 'invalid_username' });
      }
      if (!password || typeof password !== 'string' || password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters', code: 'invalid_password' });
      }
      if (password.length > 128) {
        return res.status(400).json({ error: 'Password must be at most 128 characters', code: 'invalid_password' });
      }
      if (!checkPasswordComplexity(password)) {
        return res.status(400).json({ error: 'Password must contain at least two of: lowercase letter, uppercase letter, digit', code: 'weak_password' });
      }

      const trimmedUsername = username.trim();

      // 检查是否已有用户（决定角色）
      const existing = db.exec('SELECT COUNT(*) as cnt FROM users');
      const count = existing?.[0]?.values?.[0]?.[0] ?? 0;
      const isFirst = count === 0;

      // 检查用户名重复
      const dup = db.exec('SELECT id FROM users WHERE username = ?', [trimmedUsername]);
      if (dup?.[0]?.values?.length > 0) {
        return res.status(409).json({ error: 'Username already exists', code: 'username_taken' });
      }

      const id = randomUUID();
      const role = isFirst ? 'admin' : 'user';
      const passwordHash = await hashPassword(password);

      db.run(
        'INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)',
        [id, trimmedUsername, passwordHash, role]
      );

      // 创建默认 session
      const session = await createSession('', '', '', 100);
      const token = signToken({ id, username: trimmedUsername, role });

      res.status(201).json({
        user: { id, username: trimmedUsername, role },
        token,
        sessionId: session?.id || null,
        sessionToken: session?.token || null
      });
    } catch (err) {
      console.error('[AUTH] register error:', err.message);
      res.status(500).json({ error: 'Registration failed', code: 'register_error' });
    }
  });

  /**
   * POST /api/auth/login
   * Body: { username, password }
   * Returns JWT token and creates a new session.
   */
  router.post('/login', async (req, res) => {
    try {
      const { username, password } = req.body || {};
      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required', code: 'missing_credentials' });
      }

      // 输入长度限制
      if (typeof username === 'string' && username.length > 64) {
        return res.status(400).json({ error: 'Invalid username or password', code: 'auth_failed' });
      }
      if (typeof password === 'string' && password.length > 128) {
        return res.status(400).json({ error: 'Invalid username or password', code: 'auth_failed' });
      }

      // 暴力破解防护：检查 IP 是否被临时封禁
      const ip = req.ip || req.connection?.remoteAddress || 'unknown';
      const attemptKey = 'login:' + ip;
      const now = Date.now();
      const attemptRecord = loginAttempts.get(attemptKey);
      if (attemptRecord) {
        if (attemptRecord.count >= MAX_LOGIN_ATTEMPTS) {
          if (now - attemptRecord.firstAttempt < LOGIN_BLOCK_DURATION) {
            const retryAfter = Math.ceil((LOGIN_BLOCK_DURATION - (now - attemptRecord.firstAttempt)) / 1000);
            return res.status(429).json({
              error: 'Too many login attempts. Please try again later.',
              code: 'login_blocked',
              retryAfter
            });
          } else {
            // 封禁到期，重置计数
            loginAttempts.delete(attemptKey);
          }
        }
      }

      // 查询用户 (sql.js exec returns [{ columns: [...], values: [[...]] }])
      const rows = db.exec('SELECT id, username, password_hash, role FROM users WHERE username = ?', [username.trim()]);
      if (!rows?.[0]?.values?.length) {
        // 记录失败尝试
        _recordFailedAttempt(loginAttempts, attemptKey);
        return res.status(401).json({ error: 'Invalid username or password', code: 'auth_failed' });
      }

      const [id, dbUsername, passwordHash, role] = rows[0].values[0];
      const valid = await verifyPassword(password, passwordHash);
      if (!valid) {
        // 记录失败尝试
        _recordFailedAttempt(loginAttempts, attemptKey);
        return res.status(401).json({ error: 'Invalid username or password', code: 'auth_failed' });
      }

      // 登录成功，清除失败记录
      loginAttempts.delete(attemptKey);

      // 更新最后登录时间
      db.run('UPDATE users SET last_login = datetime(\'now\') WHERE id = ?', [id]);

      // 创建 session
      const session = await createSession('', '', '', 100);
      const token = signToken({ id, username: dbUsername, role });

      res.json({
        user: { id, username: dbUsername, role },
        token,
        sessionId: session?.id || null,
        sessionToken: session?.token || null
      });
    } catch (err) {
      console.error('[AUTH] login error:', err.message);
      res.status(500).json({ error: 'Login failed', code: 'login_error' });
    }
  });

  /**
   * GET /api/auth/me
   * Headers: Authorization: Bearer <token>
   */
  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  /**
   * POST /api/auth/logout
   * Client-side: discard the token. Server-side: no-op (stateless JWT).
   */
  router.post('/logout', (req, res) => {
    res.json({ message: 'Logged out successfully' });
  });

  return router;
}

/**
 * 记录登录失败尝试
 */
function _recordFailedAttempt(attemptsMap, key) {
  const now = Date.now();
  const record = attemptsMap.get(key);
  if (record) {
    record.count++;
  } else {
    attemptsMap.set(key, { count: 1, firstAttempt: now });
  }
}
