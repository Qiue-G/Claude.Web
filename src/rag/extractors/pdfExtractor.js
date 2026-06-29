/**
 * PDF 提取器
 *
 * 直接使用 pdfjs-dist 解析 PDF，避免 pdf-parse 的 Worker 线程兼容问题。
 * 使用 fake worker 模式（WorkerMessageHandler 直接注入全局）。
 * 书签降级：若 PDF 无 outline，取前 5 个非平凡行作为 headers。
 */
import { readFile } from 'node:fs/promises';

// 动态导入 pdfjs-dist 并注入 fake worker 以规避 Worker 线程兼容问题
let pdfjs;
async function getPdfjs() {
  if (!pdfjs) {
    // 先加载 worker 模块注入全局，再加载主模块
    const workerModule = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    globalThis.pdfjsWorker = workerModule;
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '';
  }
  return pdfjs;
}

export class PdfExtractor {
  canHandle(input) {
    return input.type === 'file' && /\.pdf$/i.test(input.source);
  }

  async extract(input) {
    try {
      const buffer = await readFile(input.source);
      return await this.extractFromBuffer(buffer, input.source);
    } catch (err) {
      return { content: '', metadata: { source: input.source, type: 'file', error: `PDF解析失败: ${err.message}` } };
    }
  }

  /**
   * 从 Buffer 提取 PDF 文本（便于测试，无需真实文件）
   */
  async extractFromBuffer(buffer, source) {
    const pdfjsLib = await getPdfjs();
    try {
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
      let fullText = '';
      const pages = [];

      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map(item => item.str).join(' ');
        fullText += pageText + '\n\n';
        pages.push(i);
        page.cleanup();
      }

      // 尝试获取 outline（书签）
      let headers = [];
      try {
        const outline = await doc.getOutline();
        headers = outline?.map(o => o.title) || [];
      } catch (_) { /* no outline */ }

      // 降级：取前 5 个非平凡行作为结构线索
      if (headers.length === 0) {
        const lines = fullText.split('\n').filter(l => l.trim().length > 10);
        headers = lines.slice(0, 5).map(l => l.trim().slice(0, 60));
      }

      await doc.destroy();

      return {
        content: fullText,
        metadata: {
          source,
          type: 'file',
          pages,
          headers,
          char_count: fullText.length,
        },
      };
    } catch (err) {
      return { content: '', metadata: { source, type: 'file', error: `PDF解析失败: ${err.message}` } };
    }
  }
}