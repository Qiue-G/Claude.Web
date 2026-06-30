/**
 * 提取器模块入口
 *
 * 导出默认注册的 ExtractorRegistry，以及各提取器实现。
 * 注册顺序决定优先级：
 *   1. PdfExtractor（PDF 专用）
 *   2. OfficeExtractor（.docx / .pptx）
 *   3. CsvLoader（.csv）
 *   4. JsonLoader（.json / .jsonl）
 *   5. CodeLoader（代码文件）
 *   6. ImageLoader（图片 OCR）
 *   7. TextFileExtractor（通用纯文本，兜底）
 *   8. WebExtractor / RestExtractor（非 file 类型）
 *
 * 高优先级加载器通过 LoaderExtractor 适配到 ExtractorRegistry 接口。
 */
import { ExtractorRegistry } from './registry.js';
import { PdfExtractor } from './pdfExtractor.js';
import { OfficeExtractor } from './officeExtractor.js';
import { TextFileExtractor } from './textFileExtractor.js';
import { WebExtractor } from './webExtractor.js';
import { RestExtractor } from './restExtractor.js';
import { LoaderExtractor } from './loaderExtractor.js';
import { CsvLoader } from '../loaders/csvLoader.js';
import { JsonLoader } from '../loaders/jsonLoader.js';
import { CodeLoader } from '../loaders/codeLoader.js';
import { ImageLoader } from '../loaders/imageLoader.js';
import { readTextFile, isTextFile, detectEncoding, decodeBuffer } from './textExtractor.js';

export function createDefaultRegistry() {
  const registry = new ExtractorRegistry();

  // 专用格式优先（按特异性排列）
  registry.register(new PdfExtractor());
  registry.register(new OfficeExtractor());

  // 专用加载器（通过适配器接入）
  registry.register(new LoaderExtractor(new CsvLoader()));
  registry.register(new LoaderExtractor(new JsonLoader()));
  registry.register(new LoaderExtractor(new CodeLoader()));
  registry.register(new LoaderExtractor(new ImageLoader()));

  // 通用文本文件兜底
  registry.register(new TextFileExtractor());

  // 非 file 类型处理器
  registry.register(new WebExtractor());
  registry.register(new RestExtractor());

  return registry;
}

export {
  ExtractorRegistry,
  PdfExtractor,
  OfficeExtractor,
  TextFileExtractor,
  WebExtractor,
  RestExtractor,
  LoaderExtractor,
  readTextFile,
  isTextFile,
  detectEncoding,
  decodeBuffer,
};