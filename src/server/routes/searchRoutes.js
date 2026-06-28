/**
 * Search API — 全文本搜索对话和消息
 * GET /api/search?q=keyword  — 搜索消息内容，按会话分组返回结果
 */
import { Router } from 'express';

export function createSearchRouter(deps) {
  const { db } = deps;
  const router = Router();

  router.get('/', (req, res) => {
    const query = (req.query.q || '').trim();
    if (!query) {
      return res.json({ results: [], total: 0 });
    }

    try {
      const like = `%${query.replace(/[%_]/g, '\\$&')}%`;

      // 搜索消息内容，按 session 分组，每个 session 取第一条匹配的消息作为摘要
      const rows = db.exec(
        `SELECT m.sessionId, m.content, m.role, m.timestamp,
                (SELECT content FROM messages WHERE sessionId = m.sessionId AND role = 'user' ORDER BY timestamp ASC LIMIT 1) AS sessionTitle
         FROM messages m
         WHERE m.content LIKE ? ESCAPE '\\'
         ORDER BY m.timestamp DESC
         LIMIT 50`,
        [like]
      );

      const results = [];
      const seenSessions = new Set();

      if (rows.length > 0 && rows[0].values) {
        const cols = rows[0].columns;
        for (const row of rows[0].values) {
          const obj = {};
          cols.forEach((col, i) => { obj[col] = row[i]; });

          const sessionId = obj.sessionId;
          if (seenSessions.has(sessionId)) continue;
          seenSessions.add(sessionId);

          const content = obj.content || '';
          const snippet = content.length > 120
            ? content.substring(0, 120) + '...'
            : content;

          // 找到匹配位置附近的片段
          const lower = content.toLowerCase();
          const idx = lower.indexOf(query.toLowerCase());
          let highlightedSnippet = snippet;
          if (idx > 0) {
            const start = Math.max(0, idx - 40);
            const end = Math.min(content.length, idx + query.length + 80);
            highlightedSnippet = (start > 0 ? '...' : '') +
              content.substring(start, end) +
              (end < content.length ? '...' : '');
          }

          results.push({
            sessionId,
            title: obj.sessionTitle || '对话',
            snippet: highlightedSnippet,
            messageRole: obj.role,
            timestamp: obj.timestamp
          });

          if (results.length >= 20) break;
        }
      }

      res.json({ results, total: results.length, query });
    } catch (e) {
      console.error('[SEARCH] Error:', e.message);
      res.status(500).json({ error: 'Search failed', results: [], total: 0 });
    }
  });

  return router;
}
