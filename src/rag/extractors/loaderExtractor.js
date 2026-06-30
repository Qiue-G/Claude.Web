/**
 * LoaderExtractor 适配器
 *
 * 将 loader（{ canHandle(filePath), load(filePath) } 接口）
 * 适配为 ExtractorRegistry 所需的 { canHandle(input), extract(input) } 接口。
 */
export class LoaderExtractor {
  /**
   * @param {object} loader - 实现 { canHandle(filePath), load(filePath) } 的加载器
   */
  constructor(loader) {
    this.loader = loader;
  }

  canHandle(input) {
    return input.type === 'file' && this.loader.canHandle(input.source);
  }

  async extract(input) {
    try {
      return await this.loader.load(input.source);
    } catch (err) {
      return {
        content: '',
        metadata: { source: input.source, type: 'file', error: err.message },
      };
    }
  }
}