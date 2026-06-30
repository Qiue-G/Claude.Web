/**
 * Office 文档提取器
 *
 * 处理 .docx / .pptx 文件格式，转换为纯文本/Markdown。
 *
 * 依赖：
 *   - mammoth: .docx → HTML/Markdown
 *   - officeparser: .pptx 文本提取（可选，无依赖时降级）
 */
import fs from 'fs';
import mammoth from 'mammoth';

const OFFICE_EXTENSIONS = /\.(docx|pptx)$/i;

export class OfficeExtractor {
  canHandle(input) {
    return input.type === 'file' && OFFICE_EXTENSIONS.test(input.source);
  }

  async extract(input) {
    const filePath = input.source;
    const fileName = filePath.replace(/^.*[/\\]/, '');
    const ext = fileName.split('.').pop().toLowerCase();

    try {
      const buffer = fs.readFileSync(filePath);

      if (ext === 'docx') {
        return await this.#extractDocx(buffer, filePath, fileName);
      } else if (ext === 'pptx') {
        return await this.#extractPptx(buffer, filePath, fileName);
      }

      return { content: '', metadata: { source: filePath, error: `Unsupported format: ${ext}` } };
    } catch (err) {
      return { content: '', metadata: { source: filePath, error: `${fileName}: ${err.message}` } };
    }
  }

  async #extractDocx(buffer, filePath, fileName) {
    const result = await mammoth.extractRawText({ buffer });
    const content = result.value || '';

    return {
      content,
      metadata: {
        source: filePath,
        type: 'docx',
        char_count: content.length,
        headings: [fileName, 'Document Content'],
        warnings: result.messages?.filter(m => m.type === 'warning').map(m => m.message),
      },
    };
  }

  async #extractPptx(buffer, filePath, fileName) {
    // .pptx 本质是 ZIP 包，遍历 xml 提取幻灯片文本
    // 使用轻量方式：通过 mammoth 提取（如果支持）或手动解压
    try {
      // 尝试用 mammoth 处理（部分 .pptx 兼容）
      const result = await mammoth.extractRawText({ buffer });
      if (result.value && result.value.length > 50) {
        return {
          content: result.value,
          metadata: { source: filePath, type: 'pptx', char_count: result.value.length, headings: [fileName, 'Presentation Content'] },
        };
      }
    } catch {
      // mammoth 不支持，继续用解压方式
    }

    // 手动解压 ZIP 提取幻灯片文本
    const content = await this.#extractPptxRaw(buffer, fileName);
    return {
      content,
      metadata: {
        source: filePath,
        type: 'pptx',
        char_count: content.length,
        headings: [fileName, 'Presentation Slides'],
      },
    };
  }

  async #extractPptxRaw(buffer, fileName) {
    try {
      // 使用 Node.js 内置 zlib 处理 ZIP
      const { extractPptxText } = await import('../loaders/pptxText.js');
      return await extractPptxText(buffer);
    } catch {
      // 降级：报告不支持
      return `[PPTX] ${fileName}\n\n(PPTX text extraction requires additional processing. Basic metadata only.)`;
    }
  }
}