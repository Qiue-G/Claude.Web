/**
 * 后端提示词加载器
 *
 * 从 free-code 提取的 JSON 文件中加载系统提示词。
 * 构建时由 Dockerfile 中的提取脚本生成。
 *
 * 环境变量 PROMPTS_BACKEND_PATH 可覆盖 JSON 路径
 * 默认搜索路径：
 *   1. /app/prompts-backend.json (Docker 生产)
 *   2. 项目根目录/prompts-backend.json (本地开发)
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

/** prompts-backend.json 的搜索路径列表 */
const CANDIDATE_PATHS = [
  process.env.PROMPTS_BACKEND_PATH,
  '/app/prompts-backend.json',
  resolve(import.meta.dirname, '../../../prompts-backend.json'),
].filter(Boolean);

/** JSON 缓存 */
let cachedSections = null;

/**
 * 从 JSON 文件加载提示词区块
 * @returns {{ intro: string, system: string, doingTasks: string, toneAndStyle: string, outputEfficiency: string } | null}
 */
function loadSections() {
  if (cachedSections) return cachedSections;

  for (const filePath of CANDIDATE_PATHS) {
    if (!existsSync(filePath)) continue;

    try {
      const raw = readFileSync(filePath, 'utf-8');
      cachedSections = JSON.parse(raw);
      console.log(`[backendPromptLoader] Loaded prompts from ${filePath}`);
      return cachedSections;
    } catch (err) {
      console.warn(`[backendPromptLoader] Failed to load ${filePath}: ${err.message}`);
    }
  }

  console.warn(`[backendPromptLoader] prompts-backend.json not found in any candidate path`);
  return null;
}

/**
 * 构建完整的系统提示词前缀（等价于旧版 systemPrompts.js 的 buildSystemPromptPrefix）
 * @returns {string | null} 拼接后的提示词，失败返回 null
 */
export function buildBackendSystemPromptPrefix() {
  const sections = loadSections();
  if (!sections) return null;

  const { intro, system, doingTasks, toneAndStyle, outputEfficiency } = sections;

  return [
    intro.trim(),
    '',
    system,
    '',
    doingTasks,
    '',
    toneAndStyle,
    '',
    outputEfficiency,
  ].join('\n');
}

export default buildBackendSystemPromptPrefix;
