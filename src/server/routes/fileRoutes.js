import { Router } from 'express';
import { join, resolve as pathResolve, dirname as pathDirname } from 'path';
import { existsSync } from 'fs';
import { readFile, writeFile, mkdir, unlink, rm, stat } from 'fs/promises';

/**
 * Creates an Express Router for file CRUD operations.
 * @param {object} deps - Dependency injection
 * @param {function} deps.getSession - (sessionId, token) => session|null
 * @param {Map} deps.sessions - sessions Map
 * @param {function} deps.checkRateLimit - (key, max, windowMs) => boolean
 * @param {number} deps.RATE_WINDOW - rate limit window in ms
 * @param {number} deps.RATE_MAX_FILE - max file API calls per minute per session
 */
export function createFileRouter(deps) {
  const { getSession, sessions, checkRateLimit, RATE_WINDOW, RATE_MAX_FILE } = deps;
  const router = Router();

  // ===== CSRF protection =====
  // All write operations (POST/PUT/DELETE) on /api/files/ require x-csrf-token
  router.use((req, res, next) => {
    if (req.method === 'GET') return next();
    const parts = req.path.split('/');
    const sid = parts[1] || 'unknown';
    const session = sessions.get(sid);
    if (!session) return res.status(401).json({ error: 'Invalid session' });

    const csrfToken = req.headers['x-csrf-token'];
    if (!csrfToken || csrfToken !== session.csrfToken) {
      return res.status(403).json({ error: 'CSRF token missing or invalid' });
    }
    next();
  });

  // ===== File API rate limiter =====
  router.use((req, res, next) => {
    const parts = req.path.split('/');
    const sid = parts[1] || 'unknown';
    if (!checkRateLimit('file:' + sid, RATE_MAX_FILE, RATE_WINDOW)) {
      return res.status(429).json({ error: 'Too many file requests. Please slow down.' });
    }
    next();
  });

  // ===== File Tree API =====
  router.get('/:sessionId', async (req, res) => {
    try {
      const token = req.headers['x-session-token'];
      const session = getSession(req.params.sessionId, token);
      if (!session) return res.status(401).json({ error: 'Invalid session or token' });
      async function buildTree(dirPath, basePath) {
        const entries = await (await import('fs/promises')).readdir(dirPath, { withFileTypes: true });
        const items = [];
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          const fullPath = join(dirPath, entry.name);
          const relative = basePath ? basePath + '/' + entry.name : entry.name;
          try {
            const s = await stat(fullPath);
            if (entry.isDirectory()) {
              const children = await buildTree(fullPath, relative);
              items.push({ name: entry.name, path: relative, type: 'directory', children });
            } else {
              items.push({ name: entry.name, path: relative, type: 'file', size: s.size });
            }
          } catch (e) { /* skip */ }
        }
        items.sort((a, b) => a.type !== b.type ? (a.type === 'directory' ? -1 : 1) : a.name.localeCompare(b.name));
        return items;
      }
      const tree = await buildTree(session.dir, '');
      res.json({ tree });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list files' });
    }
  });

  // ===== File Content API =====
  router.get('/:sessionId/*', async (req, res) => {
    try {
      const token = req.headers['x-session-token'];
      const session = getSession(req.params.sessionId, token);
      if (!session) return res.status(401).json({ error: 'Invalid session or token' });
      const filePath = req.params[0];
      const fullPath = join(session.dir, filePath);
      const resolvedPath = pathResolve(fullPath);
      const resolvedSessionDir = pathResolve(session.dir);

      // 防止路径遍历攻击
      if (!resolvedPath.startsWith(resolvedSessionDir)) {
        return res.status(403).json({ error: 'Access denied: path traversal detected' });
      }

      const content = await readFile(fullPath, 'utf-8');
      res.json({ content, path: filePath });
    } catch (error) {
      console.error('[ERROR] read file:', error.message);
      res.status(500).json({ error: 'Failed to read file' });
    }
  });

  // ===== File Write API =====
  router.post('/:sessionId/*', async (req, res) => {
    try {
      const token = req.headers['x-session-token'];
      const session = getSession(req.params.sessionId, token);
      if (!session) return res.status(401).json({ error: 'Invalid session or token' });
      const filePath = req.params[0];
      const fullPath = join(session.dir, filePath);
      const resolvedPath = pathResolve(fullPath);
      const resolvedSessionDir = pathResolve(session.dir);

      // 防止路径遍历攻击
      if (!resolvedPath.startsWith(resolvedSessionDir)) {
        return res.status(403).json({ error: 'Access denied: path traversal detected' });
      }

      const dir = pathDirname(fullPath);
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });
      await writeFile(fullPath, req.body.content || '', 'utf-8');
      res.json({ success: true, path: filePath });
    } catch (error) {
      console.error('[ERROR] write file:', error.message);
      res.status(500).json({ error: 'Failed to write file' });
    }
  });

  // ===== File Delete API =====
  router.delete('/:sessionId/*', async (req, res) => {
    try {
      const token = req.headers['x-session-token'];
      const session = getSession(req.params.sessionId, token);
      if (!session) return res.status(401).json({ error: 'Invalid session or token' });
      const filePath = req.params[0];
      const fullPath = join(session.dir, filePath);
      const resolvedPath = pathResolve(fullPath);
      const resolvedSessionDir = pathResolve(session.dir);

      // 防止路径遍历攻击
      if (!resolvedPath.startsWith(resolvedSessionDir)) {
        return res.status(403).json({ error: 'Access denied: path traversal detected' });
      }

      const pathStat = await stat(fullPath);
      if (pathStat.isDirectory()) {
        await rm(fullPath, { recursive: true });
      } else {
        await unlink(fullPath);
      }
      res.json({ success: true, path: filePath });
    } catch (error) {
      console.error('[ERROR] delete file:', error.message);
      res.status(500).json({ error: 'Failed to delete file' });
    }
  });

  return router;
}
