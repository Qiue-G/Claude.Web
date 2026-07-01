/**
 * Pipelines 系统入口
 *
 * 导出加载器和执行引擎。
 *
 * 使用方式：
 * ```js
 * import { loadPipelines, runPipelines } from './pipelines/index.js';
 *
 * const pipelines = await loadPipelines();
 * const result = await runPipelines('input', userMessage, { session }, pipelines);
 * ```
 */
export { loadPipelines } from './loader.js';
export { runPipelines } from './engine.js';
