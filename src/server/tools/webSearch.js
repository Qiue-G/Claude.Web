const MAX_RESULTS = 5;

export async function searchWeb(query, fetchImpl = fetch) {
  try {
    const apiRes = await fetchImpl(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(String(query || '').substring(0, 200))}&format=json&no_html=1&skip_disambig=1`,
      { headers: { 'User-Agent': 'FreeCode/1.0' }, signal: AbortSignal.timeout(8000) }
    );
    const data = await apiRes.json();

    const parts = [];
    if (data.AbstractText) parts.push(`摘要: ${data.AbstractText}${data.AbstractURL ? '\n来源: ' + data.AbstractURL : ''}`);
    if (data.Answer) parts.push(`答案: ${data.Answer}`);

    if (Array.isArray(data.RelatedTopics)) {
      const results = data.RelatedTopics
        .flatMap(topic => Array.isArray(topic.Topics) ? topic.Topics : [topic])
        .filter(topic => topic.Text && topic.FirstURL)
        .slice(0, MAX_RESULTS);

      if (results.length > 0) {
        parts.push('搜索结果:');
        results.forEach((result, index) => parts.push(`${index + 1}. ${result.Text} — ${result.FirstURL}`));
      }
    }

    return parts.length > 0 ? parts.join('\n') : `未找到 "${query}" 的相关结果`;
  } catch (e) {
    console.error('[SEARCH] Error:', e.message);
    return `[搜索失败: ${e.message}]`;
  }
}
