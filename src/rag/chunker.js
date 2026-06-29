/**
 * 递归字符文本分割器（RecursiveCharacterTextSplitter）
 *
 * 借鉴 Open WebUI 的分块策略，支持：
 * - 按 Markdown 标题层级感知分割
 * - 递归回退到更粗的分隔符
 * - 可配置 chunk_size / chunk_overlap
 * - 内容哈希用于 RRF 去重
 */
import crypto from 'crypto';

const SEPARATORS = [
  '\n## ',    // Markdown H2
  '\n### ',   // Markdown H3
  '\n\n',     // 段落
  '\n',       // 行
  '. ',       // 句子
  ' ',        // 词
  '',         // 字符
];

const DEFAULT_CHUNK_SIZE = 512;
const DEFAULT_CHUNK_OVERLAP = 128;

export class RecursiveCharacterTextSplitter {
  /**
   * @param {object} options
   * @param {number} [options.chunkSize=512]    每块最大字符数
   * @param {number} [options.chunkOverlap=128]  块间重叠字符数（≤ chunkSize）
   * @param {string[]} [options.separators]      分隔符优先级列表
   * @param {boolean} [options.keepSeparator=false] 是否在块中保留分隔符
   */
  constructor(options = {}) {
    this.chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    this.chunkOverlap = Math.min(options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP, this.chunkSize);
    this.separators = options.separators ?? SEPARATORS;
    this.keepSeparator = options.keepSeparator ?? false;
  }

  /**
   * 拆分文本为文档块
   * @param {string} text
   * @param {object} [baseMetadata={}] 附加元数据（如 source, filename）
   * @returns {Array<{ text: string, metadata: object, hash: string }>}
   */
  splitText(text, baseMetadata = {}) {
    const chunks = this._split(text, this.separators, 0);
    return chunks.map(chunk => {
      const trimmed = chunk.trim();
      if (!trimmed) return null;
      return {
        text: trimmed,
        metadata: { ...baseMetadata },
        hash: crypto.createHash('sha256').update(trimmed).digest('hex'),
      };
    }).filter(Boolean);
  }

  /**
   * 递归分割，从最粗的分隔符开始，逐步回退
   */
  _split(text, separators, depth) {
    if (text.length <= this.chunkSize) return [text];

    const separator = separators[depth];
    if (!separator) {
      // 回退到字符级分割（最后一个 separator 是 ''）
      return this._splitByChar(text);
    }

    const parts = text.split(separator);

    // 如果只有一个片段（分隔符没命中），尝试更细的分隔符
    if (parts.length === 1) {
      return this._split(text, separators, depth + 1);
    }

    const chunks = [];
    let current = '';

    for (const part of parts) {
      const candidate = current
        ? current + separator + part
        : (this.keepSeparator ? separator + part : part);

      if (candidate.length <= this.chunkSize) {
        current = candidate;
      } else {
        if (current) {
          chunks.push(current.trim());
        }
        // 尝试用更细的分隔符拆分这一部分
        const subChunks = this._split(part, separators, depth + 1);
        // 如果 subChunks 只有一个且仍然太长，用当前分隔符继续
        if (subChunks.length === 1 && subChunks[0].length > this.chunkSize) {
          current = part;
        } else {
          chunks.push(...subChunks);
          current = '';
        }
      }
    }

    if (current) {
      chunks.push(current.trim());
    }

    // 应用重叠
    return this._applyOverlap(chunks);
  }

  _splitByChar(text) {
    const chunks = [];
    for (let i = 0; i < text.length; i += this.chunkSize - this.chunkOverlap) {
      const chunk = text.slice(i, i + this.chunkSize);
      if (chunk.trim()) chunks.push(chunk.trim());
    }
    return chunks;
  }

  _applyOverlap(chunks) {
    if (chunks.length <= 1 || this.chunkOverlap <= 0) return chunks;

    const result = [];
    for (let i = 0; i < chunks.length; i++) {
      if (i === 0) {
        result.push(chunks[i]);
      } else {
        // 前一块的尾部 + 当前块
        const prev = chunks[i - 1];
        const overlapText = prev.slice(-this.chunkOverlap);
        result.push(overlapText + chunks[i]);
      }
    }
    return result;
  }
}