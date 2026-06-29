/**
 * Markdown/MDX 分割器
 *
 * 按 Markdown 标题层级感知分割，保留标题作为 metadata.headings。
 * 借鉴 Open WebUI 的 headings 元数据用于内容富化和 BM25 加权。
 */
import crypto from 'crypto';

/**
 * 按 Markdown 标题分割文档
 * @param {string} text
 * @param {object} [options]
 * @param {number} [options.maxChunkSize=2048] - 每块最大字符数
 * @param {number} [options.minChunkSize=256]  - 每块最小字符数
 * @returns {Array<{ text: string, metadata: object, hash: string }>}
 */
export function splitMarkdown(text, options = {}) {
  const maxChunkSize = options.maxChunkSize ?? 2048;
  const minChunkSize = options.minChunkSize ?? 256;

  if (!text || !text.trim()) return [];

  // 用正则匹配所有标题行及其层级
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  const sections = [];
  let lastIndex = 0;
  let lastHeading = null;
  let lastLevel = 0;
  const headingStack = []; // 跟踪当前章节层级

  let match;
  while ((match = headingRegex.exec(text)) !== null) {
    const level = match[1].length;
    const headingText = match[2].trim();

    // 前一个章节的内容
    if (lastHeading !== null) {
      const content = text.slice(lastIndex, match.index).trim();
      if (content) {
        sections.push({
          heading: lastHeading,
          headings: [...headingStack],
          level: lastLevel,
          content,
        });
      }
    }

    lastIndex = match.index;
    lastHeading = headingText;
    lastLevel = level;

    // 更新 headingStack
    while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
      headingStack.pop();
    }
    headingStack.push({ text: headingText, level });
  }

  // 最后一节
  if (lastHeading !== null) {
    const content = text.slice(lastIndex).trim();
    if (content) {
      sections.push({
        heading: lastHeading,
        headings: [...headingStack],
        level: lastLevel,
        content,
      });
    }
  }

  // 如果没有标题，整段返回
  if (sections.length === 0) {
    const trimmed = text.trim();
    if (trimmed) {
      return [{
        text: trimmed,
        metadata: {},
        hash: crypto.createHash('sha256').update(trimmed).digest('hex'),
      }];
    }
    return [];
  }

  // 合并小章节到 >= minChunkSize
  const merged = mergeSections(sections, maxChunkSize, minChunkSize);

  // 转换为最终块格式
  const result = [];
  for (const section of merged) {
    const headingsText = section.headings.map(h => h.text);
    const enrichedText = buildEnrichedText(section.content, {
      headings: headingsText,
    });

    result.push({
      text: enrichedText,
      metadata: {
        headings: headingsText,
        heading: section.heading,
      },
      hash: crypto.createHash('sha256').update(enrichedText).digest('hex'),
    });
  }

  return result;
}

function mergeSections(sections, maxChunkSize, minChunkSize) {
  const merged = [];
  let buffer = null;

  for (const section of sections) {
    if (!buffer) {
      buffer = { ...section };
      continue;
    }

    // 如果 buffer 内容够小，尝试合并
    if (buffer.content.length < minChunkSize) {
      buffer.content += '\n\n' + section.content;
      // 合并 headings
      const seen = new Set(buffer.headings.map(h => h.text));
      for (const h of section.headings) {
        if (!seen.has(h.text)) {
          buffer.headings.push(h);
          seen.add(h.text);
        }
      }
      continue;
    }

    // buffer 够大，触发新章节
    merged.push(buffer);
    buffer = { ...section };
  }

  if (buffer) merged.push(buffer);

  // 拆分超长章节
  const final = [];
  for (const section of merged) {
    if (section.content.length > maxChunkSize) {
      // 简单按段落拆分
      const paragraphs = section.content.split('\n\n');
      for (let i = 0; i < paragraphs.length; i += 2) {
        const chunk = paragraphs.slice(i, i + 2).join('\n\n');
        if (chunk.trim()) {
          final.push({
            heading: section.heading,
            headings: section.headings,
            content: chunk,
          });
        }
      }
    } else {
      final.push(section);
    }
  }

  return final;
}

/**
 * 构建富化文本（将标题注入正文提升 BM25 质量）
 */
function buildEnrichedText(content, { headings }) {
  const parts = [content];

  if (headings && headings.length > 0) {
    // 章节路径反序（最细粒度在前）
    const headingLine = headings.slice().reverse().join(' > ');
    parts.push(`[Section: ${headingLine}]`);
  }

  return parts.join('\n\n');
}