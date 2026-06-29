/**
 * 提取器模块入口
 *
 * 导出默认注册的 ExtractorRegistry，以及各提取器实现。
 * 注册顺序决定优先级：PdfExtractor > TextFileExtractor (file 类型)
 * 后续可自由组合 WebExtractor / RestExtractor (非 file 类型)
 */
import { ExtractorRegistry } from './registry.js';
import { PdfExtractor } from './pdfExtractor.js';
import { TextFileExtractor } from './textFileExtractor.js';
import { WebExtractor } from './webExtractor.js';
import { RestExtractor } from './restExtractor.js';
import { readTextFile, isTextFile, detectEncoding, decodeBuffer } from './textExtractor.js';

export function createDefaultRegistry() {
  const registry = new ExtractorRegistry();
  registry.register(new PdfExtractor());
  registry.register(new TextFileExtractor());
  registry.register(new WebExtractor());
  registry.register(new RestExtractor());
  return registry;
}

export {
  ExtractorRegistry,
  PdfExtractor,
  TextFileExtractor,
  WebExtractor,
  RestExtractor,
  readTextFile,
  isTextFile,
  detectEncoding,
  decodeBuffer,
};