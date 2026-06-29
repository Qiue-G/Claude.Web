/**
 * 网页提取器
 *
 * 使用 fetch 获取 HTML，html-to-text 提取结构化纯文本。
 * 保留段落（p）、标题（h1-h6）、列表（li）、代码块（code/pre）。
 * 过滤导航、页脚等噪声（通过 html-to-text 的 format 回调）。
 */
import { convert } from 'html-to-text';
import { validateUrl } from '../../server/lib/urlValidator.js';

export class WebExtractor {
  canHandle(input) {
    return input.type === 'url';
  }

  async extract(input) {
    // 前置 URL 安全验证
    const urlCheck = validateUrl(input.source);
    if (!urlCheck.valid) {
      return { content: '', metadata: { source: input.source, type: 'url', error: `URL验证失败: ${urlCheck.error}` } };
    }

    try {
      const response = await fetch(input.source, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ClaudeBot/1.0)' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        return { content: '', metadata: { source: input.source, type: 'url', error: `HTTP ${response.status}` } };
      }
      const html = await response.text();

      const content = convert(html, {
        wordwrap: false,
        selectors: [
          { selector: 'a', options: { hideLinkHrefIfSameAsText: true, ignoreHref: true } },
          { selector: 'img', format: 'skip' },
          { selector: 'nav', format: 'skip' },
          { selector: 'footer', format: 'skip' },
          { selector: 'script', format: 'skip' },
          { selector: 'style', format: 'skip' },
          { selector: 'header', format: 'skip' },
        ],
      });

      if (!content.trim()) {
        return { content: '', metadata: { source: input.source, type: 'url', error: 'No readable content found' } };
      }

      return {
        content,
        metadata: {
          source: input.source,
          type: 'url',
          headers: [],
          char_count: content.length,
        },
      };
    } catch (err) {
      return { content: '', metadata: { source: input.source, type: 'url', error: `Web请求失败: ${err.message}` } };
    }
  }
}