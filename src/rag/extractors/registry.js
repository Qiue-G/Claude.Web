/**
 * 提取器注册表
 *
 * 统一管理内容提取器，按 input.type 自动分发到对应提取器。
 * 每个提取器实现 canHandle(input) / extract(input) 接口。
 */
export class ExtractorRegistry {
  #extractors = [];

  /**
   * 注册提取器（按注册顺序优先匹配）
   * @param {object} extractor - { canHandle(input) → boolean, extract(input) → Promise<{content, metadata}> }
   */
  register(extractor) {
    this.#extractors.push(extractor);
  }

  /**
   * 提取内容（自动分派到第一个匹配的提取器）
   * @param {{ type: string, source: string|object }} input
   * @returns {Promise<{ content: string, metadata: object }>}
   */
  async extract(input) {
    for (const ex of this.#extractors) {
      if (ex.canHandle(input)) {
        try {
          return await ex.extract(input);
        } catch (err) {
          return { content: '', metadata: { error: err.message } };
        }
      }
    }
    return { content: '', metadata: { error: 'No extractor can handle this input' } };
  }
}