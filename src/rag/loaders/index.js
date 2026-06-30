/**
 * 文档加载器注册表
 *
 * 提供统一的文件类型加载器注册和分发能力。
 * 每个加载器实现 { canHandle(filePath), load(filePath) } 接口。
 * 与 ExtractorRegistry 配合使用，加载器负责格式解析，提取器负责内容提取。
 */
export class LoaderRegistry {
  #loaders = [];

  register(loader) {
    this.#loaders.push(loader);
  }

  /**
   * 查找第一个匹配的加载器
   * @param {string} filePath
   * @returns {object|null}
   */
  findLoader(filePath) {
    for (const loader of this.#loaders) {
      if (loader.canHandle(filePath)) return loader;
    }
    return null;
  }

  /**
   * 获取所有支持的扩展名
   * @returns {string[]}
   */
  supportedExtensions() {
    return this.#loaders.flatMap(l => l.extensions?.() || []);
  }

  get loaders() {
    return this.#loaders;
  }
}