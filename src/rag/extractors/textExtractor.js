/**
 * 文本/代码文件提取器
 *
 * 借鉴 Open WebUI 的 CJK 编码检测策略：
 * 1. UTF-8 快速路径
 * 2. GB18030 / Big5 / EUC-KR / EUC-JP 回退
 * 3. latin-1 兜底（ftfy 下游修复）
 */
import { readFile } from 'fs/promises';

const KNOWN_SOURCE_EXT = [
  'go', 'py', 'java', 'sh', 'bat', 'ps1', 'cmd', 'js', 'ts', 'css',
  'cpp', 'hpp', 'h', 'c', 'cs', 'sql', 'log', 'ini', 'pl', 'pm', 'r',
  'dart', 'dockerfile', 'env', 'php', 'hs', 'lua', 'conf', 'rb', 'rs',
  'scala', 'bash', 'swift', 'vue', 'svelte', 'tsx', 'jsx', 'erl',
  'json', 'yaml', 'yml', 'toml', 'md', 'mdx', 'txt', 'cfg', 'xml',
];

/**
 * 检测是否为文本/源码文件
 */
export function isTextFile(filename, mimeType) {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (KNOWN_SOURCE_EXT.includes(ext)) return true;
  if (mimeType?.startsWith('text/') && !mimeType.includes('html')) return true;
  return false;
}

/**
 * 检测文本文件编码（CJK 感知）
 * @param {Buffer} raw
 * @returns {string} 检测到的编码
 */
export function detectEncoding(raw) {
  if (!raw || raw.length === 0) return 'utf-8';

  // 第1层：UTF-8 快速路径
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(raw);
    return 'utf-8';
  } catch {
    // 解码失败，继续向下试探其他编码
  }

  // 第2层：CJK 编码试探
  const CJK_ORDER = ['gb18030', 'big5', 'euc-kr', 'euc-jp', 'shift_jis'];
  for (const enc of CJK_ORDER) {
    try {
      const text = new TextDecoder(enc, { fatal: true }).decode(raw);
      if (hasCJK(text, 0.05)) return enc;
    } catch {
      // 继续下一个
    }
  }

  // 第3层：latin-1 兜底
  return 'latin-1';
}

/**
 * CJK 字符比例检查
 */
export function hasCJK(text, threshold = 0.05) {
  if (!text) return false;
  let cjk = 0, total = 0;
  for (const ch of text) {
    if (ch === ' ' || ch === '\n' || ch === '\t') continue;
    total++;
    const cp = ch.charCodeAt(0);
    if (
      (cp >= 0x4E00 && cp <= 0x9FFF) ||  // CJK 统一表意文字
      (cp >= 0x3040 && cp <= 0x309F) ||  // 平假名
      (cp >= 0x30A0 && cp <= 0x30FF) ||  // 片假名
      (cp >= 0xAC00 && cp <= 0xD7AF)     // 谚文
    ) cjk++;
  }
  return total > 0 && (cjk / total) >= threshold;
}

/**
 * 读取文本文件，自动检测编码
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export async function readTextFile(filePath) {
  const raw = await readFile(filePath);
  const encoding = detectEncoding(raw);
  return new TextDecoder(encoding, { fatal: false }).decode(raw);
}

/**
 * 从 Buffer 读取文本
 */
export function decodeBuffer(raw) {
  const encoding = detectEncoding(raw);
  return new TextDecoder(encoding, { fatal: false }).decode(raw);
}