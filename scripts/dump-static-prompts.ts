/**
 * 构建时提示词提取脚本
 *
 * 在 Docker 构建阶段运行，从 free-code 的 prompts.ts 中提取
 * 静态提示词区块并保存为 JSON 文件。
 *
 * 用法: cd /free-code && bun run /app/scripts/dump-static-prompts.ts
 *
 * 前提: prompts.ts 已被注入 export 语句（在 Dockerfile 中完成）
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";

// 这些 import 在 Dockerfile 中通过注入 export 语句启用
import {
  getSimpleIntroSection,
  getSimpleSystemSection,
  getSimpleDoingTasksSection,
  getSimpleToneAndStyleSection,
  getOutputEfficiencySection,
} from "../src/constants/prompts.js";

function main() {
  const sections = {
    intro: getSimpleIntroSection(null),
    system: getSimpleSystemSection(),
    doingTasks: getSimpleDoingTasksSection(),
    toneAndStyle: getSimpleToneAndStyleSection(),
    outputEfficiency: getOutputEfficiencySection(),
  };

  const outDir = resolve("/app");
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  const outPath = resolve(outDir, "prompts-backend.json");
  writeFileSync(outPath, JSON.stringify(sections, null, 2));
  console.log(`[prompt-extractor] Static prompts written to ${outPath}`);
}

try {
  main();
} catch (err) {
  console.error("[prompt-extractor] Failed to extract prompts:", err);
  process.exit(1);
}
