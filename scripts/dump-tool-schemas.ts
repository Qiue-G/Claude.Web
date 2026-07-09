/**
 * 构建时工具 Schema 提取脚本
 *
 * 遍历 free-code 各工具目录，从 prompt.ts 提取：
 *   - 工具名称
 *   - 描述
 *   - 提示词指令
 *   - 参数定义（Zod Schema → JSON Schema）
 *
 * 输出：/app/tools-backend.json（统一加载）
 *
 * 用法：bun run scripts/dump-tool-schemas.ts
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { resolve, basename, dirname } from "path";

// ===== 工具目录路径 =====
// Docker 构建时 free-code 在 /free-code，本地开发时在 ../../free-code
const FREE_CODE_DIR = existsSync("/free-code/src/tools")
  ? "/free-code/src/tools"
  : resolve(import.meta.dir, "../../free-code/src/tools");

const TOOLS_BACKEND_DIR = "/app";
const OUTPUT_PATH = resolve(TOOLS_BACKEND_DIR, "tools-backend.json");

// ===== 参数 Schema 模板 =====
// 从 free-code 各工具的 Zod Schema 提取（手动维护，更新频率低）
const KNOWN_TOOL_SCHEMAS: Record<string, {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}> = {
  FileWriteTool: {
    name: "write_file",
    description: "Write a file to the local filesystem. Creates the file if it does not exist, overwrites if it does.",
    input_schema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "要写入文件的绝对路径（必须是绝对路径）" },
        content: { type: "string", description: "要写入文件的内容" },
      },
      required: ["file_path", "content"],
    },
  },
  FileReadTool: {
    name: "read",
    description: "Read a file from the local filesystem. Supports text files, images, PDFs, and Jupyter notebooks.",
    input_schema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "要读取文件的绝对路径" },
        offset: { type: "number", description: "起始行号（可选，用于大文件）" },
        limit: { type: "number", description: "读取行数（可选）" },
      },
      required: ["file_path"],
    },
  },
  FileEditTool: {
    name: "edit",
    description: "Edit an existing file by replacing specific text. Uses search-and-replace for targeted changes.",
    input_schema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "要编辑文件的绝对路径" },
        old_string: { type: "string", description: "要替换的精确文本（必须在文件中唯一匹配）" },
        new_string: { type: "string", description: "替换后的新文本" },
      },
      required: ["file_path", "old_string", "new_string"],
    },
  },
  GlobTool: {
    name: "glob",
    description: "Fast file pattern matching tool that works with any codebase size. Supports glob patterns like **/*.js or src/**/*.ts.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "要匹配的 glob 模式（如 **/*.ts）" },
        path: { type: "string", description: "要搜索的目录路径（可选，默认使用工作目录）" },
      },
      required: ["pattern"],
    },
  },
  GrepTool: {
    name: "grep",
    description: "Search file contents using regular expressions. Supports multiline patterns, case-insensitive search, and file type filtering.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "要搜索的正则表达式模式" },
        path: { type: "string", description: "要搜索的目录路径（可选）" },
        glob: { type: "string", description: "文件过滤 glob（可选，如 *.js）" },
        output_mode: { type: "string", enum: ["content", "files_with_matches"], description: "输出模式" },
      },
      required: ["pattern"],
    },
  },
  BashTool: {
    name: "bash",
    description: "Execute a shell command in a sandboxed environment. Supports git, npm, and other CLI tools with configurable timeout.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "要执行的命令" },
        timeout: { type: "number", description: "超时时间（毫秒，可选）" },
        description: { type: "string", description: "命令说明" },
        run_in_background: { type: "boolean", description: "是否在后台运行" },
      },
      required: ["command"],
    },
  },
  WebSearchTool: {
    name: "web_search",
    description: "Search the web for up-to-date information about any topic. Returns search results with links and snippets.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索查询" },
        allowed_domains: { type: "array", items: { type: "string" }, description: "仅包含这些域名的结果" },
        blocked_domains: { type: "array", items: { type: "string" }, description: "排除这些域名的结果" },
      },
      required: ["query"],
    },
  },
  WebFetchTool: {
    name: "web_fetch",
    description: "Fetch content from a specified URL and return its contents in a readable format.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "要获取内容的 URL" },
      },
      required: ["url"],
    },
  },
  TodoWriteTool: {
    name: "todo_write",
    description: "Update the todo list for the current session. Use proactively to track progress in complex multi-step tasks.",
    input_schema: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              content: { type: "string", description: "任务描述（祈使句）" },
              status: { type: "string", enum: ["pending", "in_progress", "completed"] },
              priority: { type: "string", enum: ["high", "medium", "low"] },
            },
            required: ["content", "status"],
          },
          description: "要更新的任务列表",
        },
      },
      required: ["todos"],
    },
  },
  AgentTool: {
    name: "agent",
    description: "Launch a sub-agent to handle complex, multi-step tasks autonomously. Use for operations requiring dedicated agent coordination.",
    input_schema: {
      type: "object",
      properties: {
        task: { type: "string", description: "子 Agent 要执行的任务描述" },
      },
      required: ["task"],
    },
  },
  SkillTool: {
    name: "skill",
    description: "Invoke a system skill by name. Skills provide specialized capabilities and domain knowledge for specific tasks.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "要调用的技能名称" },
        body: { type: "string", description: "技能任务描述" },
      },
      required: ["name"],
    },
  },
  AskUserQuestionTool: {
    name: "ask_user_question",
    description: "Ask the user questions during execution to gather preferences, clarify ambiguous instructions, or make decisions.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "要询问用户的问题" },
        options: { type: "array", items: { type: "string" }, description: "选项列表（可选）" },
      },
      required: ["question"],
    },
  },
};

// ===== prompt.ts 解析 =====

interface ToolExtract {
  directory: string;
  toolName: string;
  description: string;
  promptText: string;
  schema: Record<string, unknown>;
}

function readFileSafe(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function extractToolName(content: string, dirName: string, toolDir: string): string {
  // 1) 查找 TOOL_NAME 导出（如 GLOB_TOOL_NAME = 'Glob'）
  const nameMatch = content.match(/(\w+_TOOL_NAME)\s*[=:]\s*['"](\w+)['"]/);
  if (nameMatch) return nameMatch[2];

  // 2) 从 directory 名称推断 (FileWriteTool → write_file, BashTool → bash)
  const base = dirName.replace(/Tool$/, "");
  return base.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
}

function extractDescription(content: string, lines: string[]): string {
  // FIND: export const DESCRIPTION = `...` or '...'
  const descMatch = content.match(/export\s+(const|let|var)\s+DESCRIPTION\s*[=:]\s*`([\s\S]*?)`\s*(?:\n|$|;)/);
  if (descMatch) return descMatch[2].trim();

  // Look for string literal
  const strMatch = content.match(/export\s+(const|let|var)\s+DESCRIPTION\s*[=:]\s*'([^']*)'\s*(?:\n|$|;)/);
  if (strMatch) return strMatch[2].trim();

  // Fallback: look for function that returns description
  const fnMatch = content.match(/export\s+function\s+get\w*Descript/);
  if (fnMatch) {
    // Extract from function body
    return "TODO: runtime function - not extracted at build time";
  }

  return "";
}

function extractPromptText(content: string, lines: string[]): string {
  // 1) PROMPT = `...`
  const promptConst = content.match(/export\s+(const|let|var)\s+(PROMPT|TOOL_PROMPT)\s*[=:]\s*`([\s\S]*?)`\s*(?:\n|$|;)/);
  if (promptConst) {
    const text = promptConst[3].trim();
    return text.length > 2000 ? text.slice(0, 2000) + "\n...(truncated)..." : text;
  }

  // 2) Fallback: DESCRIPTION is detailed enough
  const desc = extractDescription(content, lines);
  if (desc && desc.length > 50) return desc;

  // 3) Look for any function that returns string prompt
  const renderFn = content.match(/export\s+function\s+render\w*Prompt/);
  if (renderFn) {
    return "TODO: runtime prompt template - extracted at runtime";
  }
  const getFn = content.match(/export\s+function\s+get\w*(Prompt|Description)/);
  if (getFn) {
    return "TODO: runtime function - extracted at runtime";
  }

  return "";
}

function inferToolType(dirName: string): string {
  const map: Record<string, string> = {
    FileWriteTool: "core",
    FileReadTool: "core",
    FileEditTool: "core",
    GlobTool: "core",
    GrepTool: "core",
    BashTool: "core",
    REPLTool: "core",
    WebSearchTool: "approval",
    WebFetchTool: "approval",
    AgentTool: "core",
    SkillTool: "core",
    TodoWriteTool: "core",
    AskUserQuestionTool: "core",
    LSPTool: "core",
    ToolSearchTool: "core",
    ConfigTool: "core",
  };
  return map[dirName] || "other";
}

function main() {
  if (!existsSync(FREE_CODE_DIR)) {
    console.error(`[tool-extractor] free-code not found at ${FREE_CODE_DIR}, skipping`);
    process.exit(0);
  }

  // 创建输出目录
  try {
    const outDir = dirname(OUTPUT_PATH);
    if (!existsSync(outDir)) {
      // On Docker, /app should exist; if not, try creating
    }
  } catch { }

  const dirs = readdirSync(FREE_CODE_DIR)
    .filter((d) => d.endsWith("Tool"))
    .sort();

  const tools: Array<{
    name: string;
    description: string;
    prompt: string;
    type: string;
    input_schema: Record<string, unknown>;
  }> = [];
  const errors: string[] = [];

  for (const dir of dirs) {
    const dirPath = resolve(FREE_CODE_DIR, dir);
    if (!statSync(dirPath).isDirectory()) continue;

    const promptPath = resolve(dirPath, "prompt.ts");
    const promptContent = readFileSafe(promptPath);

    if (!promptContent) {
      errors.push(`${dir}: no prompt.ts found`);
      continue;
    }

    const lines = promptContent.split("\n");
    const rawToolName = extractToolName(promptContent, dir, dirPath);
    const description = extractDescription(promptContent, lines);
    const promptText = extractPromptText(promptContent, lines);
    const schema = KNOWN_TOOL_SCHEMAS[dir]?.input_schema || null;
    const type = inferToolType(dir);

    // Determine description: use KNOWN schema description if available, or extracted
    const finalDesc = schema
      ? (KNOWN_TOOL_SCHEMAS[dir] as { input_schema: { description?: string } })?.input_schema?.description || description
      : description;

    const toolEntry = {
      name: KNOWN_TOOL_SCHEMAS[dir]?.name || rawToolName,
      description: finalDesc || `${dir} tool`,
      prompt: promptText || description || `${dir} tool`,
      type,
      input_schema: schema || { type: "object", properties: {} },
    };

    tools.push(toolEntry);
    console.log(`  [${type}] ${toolEntry.name} ← ${dir}`);
  }

  const output = { tools, extracted_at: new Date().toISOString(), source_dir: FREE_CODE_DIR };

  // Try writing to /app first
  const paths = [OUTPUT_PATH, resolve(import.meta.dir, "../prompts-backend.json.tools-backup")];
  for (const p of paths) {
    try {
      writeFileSync(p, JSON.stringify(output, null, 2));
      console.log(`\n[tool-extractor] Written to ${p}`);
      break;
    } catch (e) {
      // Try next path
    }
  }

  // Also write to local for dev
  try {
    const localPath = resolve(import.meta.dir, "../tools-backend.dev.json");
    writeFileSync(localPath, JSON.stringify(output, null, 2));
    console.log(`[tool-extractor] Also written to ${localPath} (dev)`);
  } catch { }

  console.log(`\n[tool-extractor] Total: ${tools.length} tools, ${errors.length} errors`);
  if (errors.length > 0) {
    for (const e of errors) console.error(`  ⚠  ${e}`);
  }
}

try {
  main();
} catch (err) {
  console.error("[tool-extractor] Fatal error:", err);
  process.exit(1);
}
