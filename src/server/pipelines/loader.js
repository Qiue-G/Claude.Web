/**
 * Pipelines 加载器
 *
 * 从 `PIPELINES_DIR` 环境变量指定目录动态加载 `.js` 管道脚本。
 * 每个脚本应导出 `meta` 和 `pipe`：
 *
 * ```js
 * export const meta = {
 *   id: 'my-pipe',
 *   name: 'My Pipe',
 *   description: '...',
 *   type: 'input',       // 'input' | 'output' | 'both'
 * };
 *
 * export async function pipe({ content, session, context }) {
 *   return { content };
 * }
 * ```
 *
 * 如果未配置 `PIPELINES_DIR`，返回空数组。
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const DEFAULT_PIPELINES_DIR = 'pipelines';

/**
 * 加载所有管道脚本
 * @param {object} [options]
 * @param {string} [options.dir] - 管道目录（默认 process.env.PIPELINES_DIR || '<cwd>/pipelines'）
 * @returns {Promise<Array<{ id: string, name: string, description: string, type: string, pipe: Function }>>}
 */
export async function loadPipelines(options = {}) {
  const dir = options.dir || process.env.PIPELINES_DIR || path.join(process.cwd(), DEFAULT_PIPELINES_DIR);
  const resolvedDir = path.resolve(dir);

  let entries;
  try {
    entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
  } catch {
    // 目录不存在时静默返回空
    return [];
  }

  const jsFiles = entries.filter(
    e => e.isFile() && e.name.endsWith('.js') && !e.name.startsWith('_')
  );

  if (jsFiles.length === 0) return [];

  const results = [];

  for (const file of jsFiles) {
    const filePath = path.join(resolvedDir, file.name);
    const fileUrl = pathToFileURL(filePath).href;
    try {
      const mod = await import(fileUrl);

      if (!mod.meta || !mod.pipe) {
        console.warn(`[PIPELINES] Skipping "${file.name}": missing meta or pipe export`);
        continue;
      }

      if (!mod.meta.id || !mod.meta.type) {
        console.warn(`[PIPELINES] Skipping "${file.name}": meta must include id and type`);
        continue;
      }

      const validTypes = ['input', 'output', 'both'];
      if (!validTypes.includes(mod.meta.type)) {
        console.warn(`[PIPELINES] Skipping "${file.name}": invalid type "${mod.meta.type}" (must be input|output|both)`);
        continue;
      }

      results.push({
        id: mod.meta.id,
        name: mod.meta.name || mod.meta.id,
        description: mod.meta.description || '',
        type: mod.meta.type,
        pipe: mod.pipe,
        filePath,
      });

      console.log(`[PIPELINES] Loaded: ${mod.meta.id} (${mod.meta.type}) from ${file.name}`);
    } catch (err) {
      console.warn(`[PIPELINES] Failed to load "${file.name}": ${err.message}`);
    }
  }

  return results;
}
