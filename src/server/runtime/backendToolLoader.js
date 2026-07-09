/**
 * 运行时工具 Schema 加载器
 *
 * 优先加载 Docker 构建时从 free-code 提取的 tools-backend.json，
 * 失败时返回 null（由调用方使用本地回退）
 */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

/** tools-backend.json 的搜索路径列表 */
const CANDIDATE_PATHS = [
  resolve(import.meta.dirname, '../../../tools-backend.dev.json'),  // 本地开发
  resolve('/app/tools-backend.json'),                                // Docker 生产
  resolve('/free-code/tools-backend.json'),                          // 备用路径
];

/**
 * @returns {{ tools: Array<{name:string,description:string,prompt:string,type:string,input_schema:object}> } | null}
 */
export function loadBackendTools() {
  for (const filePath of CANDIDATE_PATHS) {
    try {
      if (existsSync(filePath)) {
        const raw = readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw);

        if (!data.tools || !Array.isArray(data.tools)) {
          console.warn(`[backendToolLoader] Invalid format in ${filePath}, missing "tools" array`);
          continue;
        }

        console.log(`[backendToolLoader] Loaded ${data.tools.length} tools from ${filePath}`);
        return data;
      }
    } catch (err) {
      console.warn(`[backendToolLoader] Failed to load ${filePath}: ${err.message}`);
    }
  }
  return null;
}

/**
 * 通过工具名从后端 JSON 中查找单个工具的 Schema
 */
export function getToolSchemaFromBackend(name, backendData) {
  if (!backendData?.tools) return null;
  return backendData.tools.find(t => t.name === name) || null;
}

/**
 * 获取所有后端工具的简易 map（name → tool）
 */
export function getBackendToolMap(backendData) {
  if (!backendData?.tools) return new Map();
  return new Map(backendData.tools.map(t => [t.name, t]));
}
