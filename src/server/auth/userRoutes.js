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
      if (!password || typeof password !== 'string' || password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters', code: 'invalid_password' });
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

      // 查询用户 (sql.js exec returns [{ columns: [...], values: [[...]] }])
      const rows = db.exec('SELECT id, username, password_hash, role FROM users WHERE username = ?', [username.trim()]);
      if (!rows?.[0]?.values?.length) {
        return res.status(401).json({ error: 'Invalid username or password', code: 'auth_failed' });
      }

      const [id, dbUsername, passwordHash, role] = rows[0].values[0];
      const valid = await verifyPassword(password, passwordHash);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid username or password', code: 'auth_failed' });
      }

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
