const MAX_RESULTS = 5;

export async function searchWeb(query, fetchImpl = fetch) {
  try {
    // 使用 DuckDuckGo HTML 搜索（返回真实搜索结果，无需 API Key）
    const htmlRes = await fetchImpl(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(String(query || '').substring(0, 200))}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
        },
        signal: AbortSignal.timeout(10000)
      }
    );
    const html = await htmlRes.text();
    const sources = [];
    const parts = [];

    // 解析搜索结果条目（DuckDuckGo HTML 结果格式）
    const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    const urls = [];
    const titles = [];
    const snippets = [];

    let m;
    while ((m = resultRegex.exec(html)) !== null && titles.length < MAX_RESULTS) {
      let href = m[1];
      // DuckDuckGo 使用重定向链接，提取真实 URL
      const redirectMatch = href.match(/uddg=([^&]+)/);
      if (redirectMatch) {
        href = decodeURIComponent(redirectMatch[1]);
      }
      const title = m[2].replace(/<[^>]+>/g, '').trim();
      urls.push(href);
      titles.push(title);
    }

    while ((m = snippetRegex.exec(html)) !== null && snippets.length < MAX_RESULTS) {
      snippets.push(m[1].replace(/<[^>]+>/g, '').trim());
    }

    if (titles.length > 0) {
      parts.push(`搜索 "${query}" 的结果:`);
      for (let i = 0; i < titles.length; i++) {
        const snippet = snippets[i] || '';
        const url = urls[i] || '';
        parts.push(`${i + 1}. ${titles[i]}${snippet ? '\n   ' + snippet : ''}${url ? '\n   来源: ' + url : ''}`);
        sources.push({ title: titles[i].substring(0, 80), url });
      }
    }

    // 如果 HTML 解析没找到结果，尝试从 API 兜底
    if (titles.length === 0) {
      parts.push(`搜索 "${query}" 未找到相关结果`);
    }

    const content = parts.join('\n');
    return { tool: 'web_search', ok: true, content, sources, metadata: { query, resultCount: sources.length } };
  } catch (e) {
    console.error('[SEARCH] Error:', e.message);
    return { tool: 'web_search', ok: false, content: `[搜索失败: ${e.message}]`, sources: [], metadata: { query, error: e.message } };
  }
}
