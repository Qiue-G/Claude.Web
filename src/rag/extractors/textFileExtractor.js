/**
 * 文本文件提取器
 *
 * 处理 .txt / .md / .json / .csv / .yaml 等纯文本格式文件。
 * 使用 CJK 感知编码检测（utf-8 → gb18030 → big5 → latin-1 兜底）。
 * 仅当 PDF 提取器不匹配时启用（通过注册顺序控制优先级）。
 */
import { readTextFile } from './textExtractor.js';

const TEXT_EXTENSIONS = /\.(txt|md|json|csv|yaml|yml|xml|html|htm|log|env|ini|cfg|conf|toml|sql|sh|bat|ps1)$/i;

export class TextFileExtractor {
  canHandle(input) {
    return input.type === 'file' && TEXT_EXTENSIONS.test(input.source);
  }

  async extract(input) {
    try {
      const content = await readTextFile(input.source);
      return {
        content,
        metadata: {
          source: input.source,
          type: 'file',
          headers: [],
          char_count: content.length,
        },
      };
    } catch (err) {
      return { content: '', metadata: { source: input.source, type: 'file', error: `文件读取失败: ${err.message}` } };
    }
  }
}