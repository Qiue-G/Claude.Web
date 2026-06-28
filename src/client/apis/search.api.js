/**
 * Search API — 对话搜索
 */
import { api } from '$lib/api.js';

export async function searchChats(query) {
  if (!query || !query.trim()) return { results: [], total: 0, query };
  return api.get(`/api/search?q=${encodeURIComponent(query.trim())}`);
}
