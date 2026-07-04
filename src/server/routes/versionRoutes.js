/**
 * Version History API — T5 冲突解决与历史
 *
 * HTTP API:
 *   GET    /api/session/:id/versions              — 获取 session 所有版本记录
 *   GET    /api/session/:id/versions/:messageId   — 获取某消息的版本列表
 *   POST   /api/session/:id/versions/:messageId/restore/:version — 回滚到指定版本
 *   GET    /api/session/:id/versions/:messageId/diff?v1=X&v2=Y   — 比较两个版本的差异
 *
 * WebSocket 消息类型 (在 wsHandler.js 中处理):
 *   version_list     — 列出某个 message 的版本历史
 *   version_restore  — 回滚到指定版本
 *   version_diff     — 比较两个版本的差异
 *
 * 版本自动创建 hook (saveMessageVersion) 供 messageStore 调用。
 */
import { Router } from 'express';
import { requireAuth } from '../auth/authMiddleware.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * 创建版本管理路由。
 * @param {object} deps
 * @param {import('sql.js').Database} deps.db
 * @param {Function} deps.getSession
 * @returns {import('express').Router}
 */
export function createVersionRouter({ db, getSession, saveDb }) {
  const router = Router();

  // 所有版本 API 需要认证
  router.use(requireAuth);

  // ---- 辅助函数 ----

  /** 将 DB 行转为版本对象 */
  function rowToVersion(row) {
    return {
      id: row.id,
      sessionId: row.session_id,
      messageId: row.message_id,
      content: row.content,
      version: row.version,
      createdBy: row.created_by || null,
      createdAt: row.created_at
    };
  }

  function rowsToVersions(rows) {
    if (!rows || rows.length === 0 || !rows[0].values) return [];
    const cols = rows[0].columns;
    return rows[0].values.map(row => {
      const obj = {};
      cols.forEach((col, i) => { obj[col] = row[i]; });
      return rowToVersion(obj);
    });
  }

  /**
   * 保存消息的新版本（可在消息编辑时调用）。
   * @param {object} params
   * @param {string} params.sessionId
   * @param {string} params.messageId
   * @param {string} params.content
   * @param {string} [params.createdBy]
   * @returns {{ id: string, version: number }}
   */
  function saveMessageVersion({ sessionId, messageId, content, createdBy }) {
    // 查询当前最新版本号
    const rows = db.exec(
      'SELECT MAX(version) as max_version FROM message_versions WHERE session_id = ? AND message_id = ?',
      [sessionId, messageId]
    );
    const currentVersion = (rows?.[0]?.values?.[0]?.[0]) || 0;
    const newVersion = currentVersion + 1;
    const id = uuidv4();

    db.run(
      `INSERT INTO message_versions (id, session_id, message_id, content, version, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, sessionId, messageId, content, newVersion, createdBy || null]
    );

    if (saveDb) saveDb();

    return { id, version: newVersion };
  }

  // ---- 工具函数暴露给 wsHandler 使用 ----
  router._saveMessageVersion = saveMessageVersion;
  router._rowsToVersions = rowsToVersions;
  router._rowToVersion = rowToVersion;

  /**
   * GET /api/session/:id/versions
   * 获取 session 所有版本记录（按时间倒序）
   */
  router.get('/session/:id/versions', (req, res) => {
    const { id } = req.params;
    const token = req.headers['x-session-token'];

    const session = getSession(id, token);
    if (!session) {
      return res.status(404).json({ error: 'Session not found', code: 'session_not_found' });
    }

    try {
      const rows = db.exec(
        `SELECT id, session_id, message_id, content, version, created_by, created_at
         FROM message_versions WHERE session_id = ?
         ORDER BY created_at DESC`,
        [id]
      );
      const versions = rowsToVersions(rows);
      res.json({ sessionId: id, versions });
    } catch (e) {
      res.status(500).json({ error: 'Failed to load versions', code: 'version_load_error' });
    }
  });

  /**
   * GET /api/session/:id/versions/:messageId
   * 获取某消息的版本列表（按版本号降序）
   */
  router.get('/session/:id/versions/:messageId', (req, res) => {
    const { id, messageId } = req.params;
    const token = req.headers['x-session-token'];

    const session = getSession(id, token);
    if (!session) {
      return res.status(404).json({ error: 'Session not found', code: 'session_not_found' });
    }

    try {
      const rows = db.exec(
        `SELECT id, session_id, message_id, content, version, created_by, created_at
         FROM message_versions WHERE session_id = ? AND message_id = ?
         ORDER BY version DESC`,
        [id, messageId]
      );
      const versions = rowsToVersions(rows);
      res.json({ sessionId: id, messageId, versions });
    } catch (e) {
      res.status(500).json({ error: 'Failed to load versions', code: 'version_load_error' });
    }
  });

  /**
   * POST /api/session/:id/versions/:messageId/restore/:version
   * 回滚到指定版本
   */
  router.post('/session/:id/versions/:messageId/restore/:version', (req, res) => {
    const { id, messageId, version } = req.params;
    const token = req.headers['x-session-token'];
    const csrfToken = req.headers['x-csrf-token'];

    const session = getSession(id, token);
    if (!session) {
      return res.status(404).json({ error: 'Session not found', code: 'session_not_found' });
    }

    // CSRF 校验
    if (!csrfToken || csrfToken !== session.csrfToken) {
      return res.status(403).json({ error: 'Invalid CSRF token', code: 'csrf_mismatch' });
    }

    try {
      const versionNum = parseInt(version, 10);
      if (isNaN(versionNum) || versionNum < 1) {
        return res.status(400).json({ error: 'Invalid version number', code: 'invalid_version' });
      }

      // 查找指定版本
      const rows = db.exec(
        `SELECT id, session_id, message_id, content, version, created_by, created_at
         FROM message_versions WHERE session_id = ? AND message_id = ? AND version = ?`,
        [id, messageId, versionNum]
      );
      const versions = rowsToVersions(rows);

      if (versions.length === 0) {
        return res.status(404).json({ error: 'Version not found', code: 'version_not_found' });
      }

      const targetVersion = versions[0];

      // 更新 messages 表中的内容为当前版本的内容
      db.run(
        'UPDATE messages SET content = ? WHERE id = ? AND sessionId = ?',
        [targetVersion.content, messageId, id]
      );

      if (saveDb) saveDb();

      res.json({
        success: true,
        message: `Restored to version ${versionNum}`,
        version: targetVersion
      });
    } catch (e) {
      res.status(500).json({ error: 'Failed to restore version', code: 'version_restore_error' });
    }
  });

  /**
   * GET /api/session/:id/versions/:messageId/diff?v1=X&v2=Y
   * 比较两个版本的差异（简单的逐行比较，返回差异片段）
   */
  router.get('/session/:id/versions/:messageId/diff', (req, res) => {
    const { id, messageId } = req.params;
    const token = req.headers['x-session-token'];
    const v1 = parseInt(req.query.v1, 10);
    const v2 = parseInt(req.query.v2, 10);

    if (isNaN(v1) || isNaN(v2) || v1 < 1 || v2 < 1) {
      return res.status(400).json({ error: 'Invalid version numbers', code: 'invalid_version' });
    }

    const session = getSession(id, token);
    if (!session) {
      return res.status(404).json({ error: 'Session not found', code: 'session_not_found' });
    }

    try {
      const rows = db.exec(
        `SELECT content, version FROM message_versions
         WHERE session_id = ? AND message_id = ? AND version IN (?, ?)
         ORDER BY version ASC`,
        [id, messageId, v1, v2]
      );

      if (!rows || rows.length === 0 || !rows[0].values) {
        return res.status(404).json({ error: 'One or both versions not found', code: 'version_not_found' });
      }

      const results = rows[0].values.map(r => ({
        content: r[0],
        version: r[1]
      }));

      if (results.length < 2) {
        return res.status(404).json({ error: 'One or both versions not found', code: 'version_not_found' });
      }

      // 简单的逐行 diff
      const lines1 = results[0].content.split('\n');
      const lines2 = results[1].content.split('\n');
      const diff = computeSimpleDiff(lines1, lines2);

      res.json({
        sessionId: id,
        messageId,
        v1,
        v2,
        diff
      });
    } catch (e) {
      res.status(500).json({ error: 'Failed to compute diff', code: 'diff_error' });
    }
  });

  return router;
}

/**
 * 简单的逐行文本比较，返回差异数组。
 * 每项: { type: 'added'|'removed'|'unchanged', line: string, lineNumber?: number }
 */
function computeSimpleDiff(linesA, linesB) {
  const result = [];
  const maxLen = Math.max(linesA.length, linesB.length);
  for (let i = 0; i < maxLen; i++) {
    if (i >= linesA.length) {
      result.push({ type: 'added', line: linesB[i], lineNumber: i + 1 });
    } else if (i >= linesB.length) {
      result.push({ type: 'removed', line: linesA[i], lineNumber: i + 1 });
    } else if (linesA[i] !== linesB[i]) {
      result.push({ type: 'removed', line: linesA[i], lineNumber: i + 1 });
      result.push({ type: 'added', line: linesB[i], lineNumber: i + 1 });
    } else {
      result.push({ type: 'unchanged', line: linesA[i], lineNumber: i + 1 });
    }
  }
  return result;
}
