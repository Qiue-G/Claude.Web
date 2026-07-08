/**
 * 后端提示词加载器
 *
 * 从 free-code 提取的 JSON 文件中加载系统提示词。
 * 构建时由 Dockerfile 中的提取脚本生成。
 *
 * 环境变量 PROMPTS_BACKEND_PATH 可覆盖 JSON 路径（默认 /app/prompts-backend.json）
 */

import { readFileSync, existsSync } from 'fs';

const BACKEND_PATH = process.env.PROMPTS_BACKEND_PATH || '/app/prompts-backend.json';

/** JSON 缓存 */
let cachedSections = null;

/**
 * 从 JSON 文件加载提示词区块
 * @returns {{ intro: string, system: string, doingTasks: string, toneAndStyle: string, outputEfficiency: string } | null}
 */
function loadSections() {
  if (cachedSections) return cachedSections;

  if (!existsSync(BACKEND_PATH)) {
    console.warn(`[backendPromptLoader] prompts-backend.json not found at ${BACKEND_PATH}`);
    return null;
  }

  try {
    const raw = readFileSync(BACKEND_PATH, 'utf-8');
    cachedSections = JSON.parse(raw);
    console.log(`[backendPromptLoader] Loaded prompts from ${BACKEND_PATH}`);
    return cachedSections;
  } catch (err) {
    console.error(`[backendPromptLoader] Failed to load prompts:`, err.message);
    return null;
  }
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
