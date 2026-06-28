/**
 * Search API — 对话搜索
 */

const BASE = '';

/**
 * 搜索对话和消息
 * @param {string} query 搜索关键词
 * @returns {Promise<{ results: Array, total: number, query: string }>}
 */
export async function searchChats(query) {
  if (!query || !query.trim()) return { results: [], total: 0, query };
  const res = await fetch(`${BASE}/api/search?q=${encodeURIComponent(query.trim())}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
