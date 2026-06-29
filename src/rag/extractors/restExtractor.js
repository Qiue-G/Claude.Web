/**
 * REST API 提取器
 *
 * 从 REST API 响应中按 dataPath 提取指定字段内容。
 * 支持 JSONPath 风格路径（通过 lodash.get），自动过滤非字符串类型。
 * Input: { type: 'rest', source: { url: string, dataPath?: string } }
 */
import get from 'lodash.get';
import { validateUrl } from '../../server/lib/urlValidator.js';

export class RestExtractor {
  canHandle(input) {
    return input.type === 'rest';
  }

  async extract(input) {
    try {
      const { url, dataPath } = typeof input.source === 'string'
        ? { url: input.source, dataPath: undefined }
        : input.source;

      if (!url) {
        return { content: '', metadata: { source: url || '', type: 'rest', error: 'Missing URL' } };
      }

      // 前置 URL 安全验证
      const urlCheck = validateUrl(url);
      if (!urlCheck.valid) {
        return { content: '', metadata: { source: url, type: 'rest', error: `URL验证失败: ${urlCheck.error}` } };
      }

      const response = await fetch(url, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; ClaudeBot/1.0)' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        return { content: '', metadata: { source: url, type: 'rest', error: `HTTP ${response.status}` } };
      }

      const body = await response.json();

      let extracted = dataPath ? get(body, dataPath, body) : body;

      // 展平非字符串数据：过滤出字符串类型字段
      if (typeof extracted !== 'string') {
        extracted = flattenToString(extracted);
      }

      if (!extracted.trim()) {
        return { content: '', metadata: { source: url, type: 'rest', error: 'No readable content found' } };
      }

      return {
        content: extracted,
        metadata: {
          source: url,
          type: 'rest',
          headers: [],
          char_count: extracted.length,
        },
      };
    } catch (err) {
      const src = typeof input.source === 'string' ? input.source : input.source?.url || '';
      return { content: '', metadata: { source: src, type: 'rest', error: `REST请求失败: ${err.message}` } };
    }
  }
}

/** 将对象/数组递归展平为纯文本 */
function flattenToString(data, depth = 0) {
  if (depth > 5) return '';
  if (typeof data === 'string') return data;
  if (typeof data === 'number' || typeof data === 'boolean') return String(data);
  if (data === null || data === undefined) return '';
  if (Array.isArray(data)) return data.map(item => flattenToString(item, depth + 1)).filter(Boolean).join('\n');
  if (typeof data === 'object') {
    return Object.entries(data)
      .map(([key, val]) => {
        const v = flattenToString(val, depth + 1);
        return v ? `${key}: ${v}` : '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}