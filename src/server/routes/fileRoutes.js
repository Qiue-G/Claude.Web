/**
 * File CRUD routes with version management (snapshot-on-write, diff, rollback).
 *
 * Extends the original file system with:
 * - Automatic versioning on every write
 * - Version history listing
 * - Diff between any two versions
 * - Rollback to any version
 *
 * Routes:
 *   GET    /:sessionId                      — file tree
 *   GET    /:sessionId/versions/*           — version list for a file
 *   GET    /:sessionId/version/:vid/*       — read specific version content
 *   GET    /:sessionId/diff/:fromId/:toId   — diff two versions
 *   POST   /:sessionId/rollback/:vid/*      — rollback file to a version
 *   GET    /:sessionId/*                    — read current file content
 *   POST   /:sessionId/*                    — write file (auto-version)
 *   DELETE /:sessionId/*                    — delete file
 */
import { Router } from 'express';
import { join, resolve as pathResolve, dirname as pathDirname, relative as pathRelative, isAbsolute as pathIsAbsolute } from 'path';
import { existsSync } from 'fs';
import { readFile, writeFile, mkdir, unlink, rm, stat } from 'fs/promises';
import { createHash, randomUUID } from 'crypto';
import { diffLines } from 'diff';
import { AppError } from '../lib/AppError.js';
import { asyncHandler } from '../lib/asyncHandler.js';

/**
 * Creates an Express Router for file CRUD with version management.
 * @param {object} deps
 * @param {function} deps.getSession
 * @param {Map} deps.sessions
 * @param {function} deps.checkRateLimit
 * @param {number} deps.RATE_WINDOW
 * @param {number} deps.RATE_MAX_FILE
 * @param {object} deps.db  - sql.js DB instance (for file_versions table)
 */
export function createFileRouter(deps) {
  const { getSession, sessions, checkRateLimit, RATE_WINDOW, RATE_MAX_FILE, db } = deps;
  const router = Router();

  // ===== Helper: compute SHA-256 hash =====
  function contentHash(content) {
    return createHash('sha256').update(content).digest('hex');
  }

  // ===== Helper: insert a file version into DB =====
  function insertVersion(sessionId, filePath, content, action = 'save') {
    if (!db) return;
    const hash = contentHash(content);
    // Dedup: skip if same hash already exists for this file
    const existing = db.exec(
      `SELECT id FROM file_versions WHERE sessionId=? AND filePath=? AND hash=? LIMIT 1`,
      [sessionId, filePath, hash]
    );
    if (existing.length > 0 && existing[0].values.length > 0) return existing[0].values[0][0];

    const id = randomUUID();
    const now = Date.now();
    try {
      db.run(
        `INSERT INTO file_versions (id, sessionId, filePath, content, hash, size, createdAt, action) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, sessionId, filePath, content, hash, Buffer.byteLength(content, 'utf-8'), now, action]
      );
    } catch (e) {
      console.error('[FILE] version insert failed:', e.message);
    }
    return id;
  }

  // ===== Helper: build file tree (used by GET /:sessionId) =====
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

  // ===== Helper: resolve file path with traversal protection =====
  function resolveFilePath(session, filePath) {
    const resolvedPath = pathResolve(session.dir, filePath);
    const resolvedSessionDir = pathResolve(session.dir);
    const relativePath = pathRelative(resolvedSessionDir, resolvedPath);
    if (relativePath.startsWith('..') || pathIsAbsolute(relativePath)) {
      throw new AppError(403, 'Access denied: path traversal detected');
    }
    return resolvedPath;
  }

  // ===== Helper: get session with validation =====
  function validateSession(req) {
    const token = req.headers['x-session-token'];
    const sessionId = req.params.sessionId;
    const session = getSession(sessionId, token);
    if (!session) throw new AppError(401, 'Invalid session or token');
    return session;
  }

  // ===== CSRF protection =====
  router.use((req, res, next) => {
    if (req.method === 'GET') return next();
    const parts = req.path.split('/');
    const sid = parts[1] || 'unknown';
    const session = sessions.get(sid);
    if (!session) throw new AppError(401, 'Invalid session');

    const csrfToken = req.headers['x-csrf-token'];
    if (!csrfToken || csrfToken !== session.csrfToken) {
      throw new AppError(403, 'CSRF token missing or invalid');
    }
    next();
  });

  // ===== File API rate limiter =====
  router.use((req, res, next) => {
    const parts = req.path.split('/');
    const sid = parts[1] || 'unknown';
    if (!checkRateLimit('file:' + sid, RATE_MAX_FILE, RATE_WINDOW)) {
      throw new AppError(429, 'Too many file requests. Please slow down.');
    }
    next();
  });

  // ===== File Tree API =====
  router.get('/:sessionId', asyncHandler(async (req, res) => {
    const session = validateSession(req);
    const tree = await buildTree(session.dir, '');
    res.json({ tree });
  }));

  // ===== File Version List =====
  router.get('/:sessionId/versions/*', asyncHandler(async (req, res) => {
    const session = validateSession(req);
    const filePath = req.params[0];
    if (!db) {
      return res.json({ versions: [] });
    }

    const rows = db.exec(
      `SELECT id, hash, size, createdAt, action FROM file_versions
       WHERE sessionId=? AND filePath=?
       ORDER BY createdAt DESC
       LIMIT 200`,
      [session.id, filePath]
    );

    const versions = [];
    if (rows.length > 0 && rows[0].values) {
      const cols = rows[0].columns;
      for (const row of rows[0].values) {
        const obj = {};
        cols.forEach((col, i) => { obj[col] = row[i]; });
        versions.push(obj);
      }
    }
    res.json({ versions, filePath });
  }));

  // ===== Read Specific Version Content =====
  router.get('/:sessionId/version/:vid/*', asyncHandler(async (req, res) => {
    const session = validateSession(req);
    const versionId = req.params.vid;
    // req.params[0] is the file path (captured by *)
    // But for version reads, the path is after /version/:vid/
    // Express with multiple wildcards: params[0] may not work correctly with :vid/* pattern
    // We use a different approach: match by version ID only
    if (!db) throw new AppError(500, 'Database not available');

    const rows = db.exec(
      `SELECT content, filePath FROM file_versions WHERE id=? AND sessionId=? LIMIT 1`,
      [versionId, session.id]
    );

    if (!rows.length || !rows[0].values.length) {
      throw new AppError(404, 'Version not found');
    }

    res.json({
      content: rows[0].values[0][0],
      path: rows[0].values[0][1],
      versionId
    });
  }));

  // ===== Diff between two versions =====
  router.get('/:sessionId/diff/:fromId/:toId', asyncHandler(async (req, res) => {
    const session = validateSession(req);
    const { fromId, toId } = req.params;
    if (!db) throw new AppError(500, 'Database not available');

    const rows = db.exec(
      `SELECT id, content, filePath, createdAt FROM file_versions WHERE id IN (?, ?) AND sessionId=? ORDER BY createdAt ASC`,
      [fromId, toId, session.id]
    );

    if (!rows.length || !rows[0].values || rows[0].values.length < 2) {
      throw new AppError(404, 'One or both versions not found');
    }

    const vals = rows[0].values;
    // Order: first row = older (by createdAt ASC), second row = newer
    const older = vals[0][1];
    const newer = vals[1][1];
    const filePath = vals[0][2];
    const fromTime = vals[0][3];
    const toTime = vals[1][3];

    const changes = diffLines(older, newer);

    res.json({
      filePath,
      fromVersion: fromId,
      toVersion: toId,
      fromTime,
      toTime,
      changes: changes.map(c => ({
        count: c.count,
        added: c.added || false,
        removed: c.removed || false,
        value: c.value
      }))
    });
  }));

  // ===== Rollback to a specific version =====
  router.post('/:sessionId/rollback/:vid/*', asyncHandler(async (req, res) => {
    const session = validateSession(req);
    const versionId = req.params.vid;
    const filePath = req.params[0];
    if (!db) throw new AppError(500, 'Database not available');

    // Read the version content
    const rows = db.exec(
      `SELECT content FROM file_versions WHERE id=? AND sessionId=? AND filePath=? LIMIT 1`,
      [versionId, session.id, filePath]
    );

    if (!rows.length || !rows[0].values.length) {
      throw new AppError(404, 'Version not found');
    }

    const oldContent = rows[0].values[0][0];
    const fullPath = resolveFilePath(session, filePath);

    // Snapshot current content before rollback
    let currentContent = '';
    try { currentContent = await readFile(fullPath, 'utf-8'); } catch {}
    if (currentContent) {
      insertVersion(session.id, filePath, currentContent, 'rollback-save');
    }

    // Write the old version content to disk
    await writeFile(fullPath, oldContent, 'utf-8');

    // Also insert a version record for the rollback itself
    insertVersion(session.id, filePath, oldContent, 'rollback');

    res.json({
      success: true,
      path: filePath,
      versionId,
      message: `Rolled back to version ${versionId.substring(0, 8)}...`
    });
  }));

  // ===== Read Current File Content =====
  router.get('/:sessionId/*', asyncHandler(async (req, res, next) => {
    const session = validateSession(req);
    // Skip if this is a versions/version/diff request (caught by more specific routes)
    const subPath = req.params[0] || '';
    if (subPath.startsWith('versions/') || subPath.startsWith('version/') || subPath.startsWith('diff/') || subPath.startsWith('rollback/')) {
      return next();
    }

    const filePath = subPath;
    const fullPath = resolveFilePath(session, filePath);

    const content = await readFile(fullPath, 'utf-8');
    res.json({ content, path: filePath });
  }));

  // ===== Write File with Auto-Versioning =====
  router.post('/:sessionId/*', asyncHandler(async (req, res) => {
    const session = validateSession(req);
    const filePath = req.params[0];
    const newContent = req.body.content || '';
    const fullPath = resolveFilePath(session, filePath);

    // Read current disk content
    let oldContent = '';
    try { oldContent = await readFile(fullPath, 'utf-8'); } catch {}

    // Check if content actually changed
    const newHash = contentHash(newContent);
    const oldHash = oldContent ? contentHash(oldContent) : '';
    const unchanged = oldContent && newHash === oldHash;

    if (!unchanged && oldContent) {
      // Save current content as a historical version before overwriting
      insertVersion(session.id, filePath, oldContent, 'save');
    }

    // Ensure directory exists
    const dir = pathDirname(fullPath);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });

    // Write to disk
    await writeFile(fullPath, newContent, 'utf-8');

    res.json({
      success: true,
      path: filePath,
      status: unchanged ? 'unchanged' : 'saved'
    });
  }));

  // ===== Rename File =====
  router.put('/:sessionId/rename', asyncHandler(async (req, res) => {
    const session = validateSession(req);
    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) throw new AppError(400, 'oldPath and newPath are required');

    const fullOldPath = resolveFilePath(session, oldPath);
    const fullNewPath = resolveFilePath(session, newPath);

    // Ensure parent directory exists
    const newDir = pathDirname(fullNewPath);
    if (!existsSync(newDir)) await mkdir(newDir, { recursive: true });

    try {
      await (await import('fs/promises')).rename(fullOldPath, fullNewPath);
    } catch (err) {
      throw new AppError(500, `Rename failed: ${err.message}`);
    }

    res.json({ success: true, oldPath, newPath });
  }));

  // ===== Delete File =====
  router.delete('/:sessionId/*', asyncHandler(async (req, res) => {
    const session = validateSession(req);
    const filePath = req.params[0];
    const fullPath = resolveFilePath(session, filePath);

    // Save a final version before deleting (soft delete)
    try {
      const finalContent = await readFile(fullPath, 'utf-8');
      insertVersion(session.id, filePath, finalContent, 'delete');
    } catch {}

    const pathStat = await stat(fullPath);
    if (pathStat.isDirectory()) {
      await rm(fullPath, { recursive: true });
    } else {
      await unlink(fullPath);
    }
    res.json({ success: true, path: filePath });
  }));

  return router;
}
