/**
 * free-code 工具移植模块
 *
 * 基于 free-code (Claude Code) 的工具实现移植
 * 提供文件搜索、内容搜索、任务管理等核心工具
 */

import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import { globSearch as bridgeGlobSearch, grepSearch as bridgeGrepSearch } from './freeCodeBridge.js';

// ===== GlobTool：文件搜索 =====

const GLOB_TOOL_INSTRUCTION = `Glob is a fast file pattern matching tool that works with any codebase size.
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns

Output format:
\`\`\`glob
pattern: **/*.js
path: optional/directory (omit to search root)
\`\`\``;

function extractGlobBlocks(text) {
  const blocks = [];
  const regex = /```glob\n?([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const block = match[1].trim();
    const lines = block.split('\n');
    const patternIdx = lines.findIndex(l => l.startsWith('pattern:'));
    if (patternIdx === -1) continue;
    const pattern = lines[patternIdx].slice(8).trim();
    const pathIdx = lines.findIndex(l => l.startsWith('path:'));
    const searchPath = pathIdx !== -1 ? lines[pathIdx].slice(5).trim() : '.';
    blocks.push({ pattern, path: searchPath || '.' });
  }
  return blocks;
}

export async function executeGlob(input, session) {
  const { pattern, path: searchPath = '.' } = input;
  const resolvedSessionDir = path.resolve(session.dir);
  const fullPath = path.resolve(session.dir, searchPath);

  // 安全检查
  if (!fullPath.startsWith(resolvedSessionDir) && fullPath !== resolvedSessionDir) {
    throw new Error(`路径 ${searchPath} 不在允许的工作目录内`);
  }

  // 优先使用桥接（可能加载了编译的 free-code 实现）
  try {
    const result = await bridgeGlobSearch(pattern, fullPath, session.dir);
    if (result && result.filenames) {
      return `找到 ${result.numFiles} 个匹配文件:\n${result.filenames.join('\n')}${result.truncated ? '\n(结果已截断，超过 100 个文件)' : ''}${result.durationMs > 0 ? `\n(耗时 ${result.durationMs}ms)` : ''}`;
    }
  } catch {
    // 桥接失败，回退到原生实现
  }

  // 原生回退
  const files = await glob(pattern, {
    cwd: fullPath,
    nodir: true,
    stat: true,
  });

  const filesWithStats = await Promise.all(
    files.map(async (f) => {
      const stat = await fs.stat(path.join(fullPath, f));
      return { path: f, mtime: stat.mtimeMs };
    })
  );

  filesWithStats.sort((a, b) => b.mtime - a.mtime);

  const result = filesWithStats.map(f => f.path).join('\n');
  return `找到 ${files.length} 个匹配文件:\n${result}`;
}

// ===== GrepTool：内容搜索 =====

const GREP_TOOL_INSTRUCTION = `Grep is a powerful search tool for finding patterns in files.
- Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
- Filter files with glob parameter (e.g., "*.js", "**/*.tsx")
- Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default)

Output format:
\`\`\`grep
pattern: search regex
path: optional/directory
glob: *.js (optional)
output: content|files_with_matches (optional)
\`\`\``;

function extractGrepBlocks(text) {
  const blocks = [];
  const regex = /```grep\n?([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const block = match[1].trim();
    const lines = block.split('\n');
    const patternIdx = lines.findIndex(l => l.startsWith('pattern:'));
    if (patternIdx === -1) continue;
    const pattern = lines[patternIdx].slice(8).trim();
    const pathIdx = lines.findIndex(l => l.startsWith('path:'));
    const searchPath = pathIdx !== -1 ? lines[pathIdx].slice(5).trim() : '.';
    const globIdx = lines.findIndex(l => l.startsWith('glob:'));
    const globFilter = globIdx !== -1 ? lines[globIdx].slice(5).trim() : null;
    const outputIdx = lines.findIndex(l => l.startsWith('output:'));
    const outputMode = outputIdx !== -1 ? lines[outputIdx].slice(7).trim() : 'files_with_matches';
    blocks.push({ pattern, path: searchPath || '.', glob: globFilter, output: outputMode });
  }
  return blocks;
}

export async function executeGrep(input, session) {
  const { pattern, path: searchPath = '.', glob: globFilter, output = 'files_with_matches' } = input;
  const resolvedSessionDir = path.resolve(session.dir);
  const fullPath = path.resolve(session.dir, searchPath);

  // 安全检查
  if (!fullPath.startsWith(resolvedSessionDir) && fullPath !== resolvedSessionDir) {
    throw new Error(`路径 ${searchPath} 不在允许的工作目录内`);
  }

  // 优先使用桥接（可能加载了编译的 free-code 实现）
  try {
    const results = await bridgeGrepSearch(pattern, fullPath, session.dir, globFilter, output);
    if (results && Array.isArray(results)) {
      if (output === 'files_with_matches') {
        return `找到 ${results.length} 个匹配文件:\n${results.join('\n')}`;
      }
      return `搜索结果:\n${results.join('\n\n')}`;
    }
  } catch {
    // 桥接失败，回退到原生实现
  }

  // 原生回退：使用 Node.js readFile + RegExp
  const files = await glob(globFilter || '**/*', { cwd: fullPath, nodir: true });
  const results = [];
  const regex = new RegExp(pattern, 'g');

  for (const file of files) {
    try {
      const content = await fs.readFile(path.join(fullPath, file), 'utf-8');
      const lines = content.split('\n');
      const matches = [];

      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          matches.push({ line: i + 1, content: lines[i].trim() });
          regex.lastIndex = 0; // 重置正则
        }
      }

      if (matches.length > 0) {
        if (output === 'files_with_matches') {
          results.push(file);
        } else {
          results.push(`${file}:\n${matches.map(m => `  ${m.line}: ${m.content}`).join('\n')}`);
        }
      }
    } catch {
      // 忽略读取错误
    }
  }

  return output === 'files_with_matches'
    ? `找到 ${results.length} 个匹配文件:\n${results.join('\n')}`
    : `搜索结果:\n${results.join('\n\n')}`;
}

// ===== TodoWrite：任务管理 =====

const TODO_WRITE_INSTRUCTION = `TodoWrite is a task management tool for tracking progress on complex tasks.
- Create and update a structured task list
- Mark tasks as completed when done
- Track progress throughout the conversation

Output format:
\`\`\`todo_write
todos:
- content: Task description
  status: pending|in_progress|completed
  priority: high|medium|low
\`\`\`

Or update existing tasks:
\`\`\`todo_write
update:
- id: task_id
  status: completed
\`\`\``;

function extractTodoWriteBlocks(text) {
  const blocks = [];
  const regex = /```todo_write\n?([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const block = match[1].trim();
    // 简化解析：将 YAML-like 格式转换为对象
    const lines = block.split('\n');
    const todosIdx = lines.findIndex(l => l.startsWith('todos:'));
    const updateIdx = lines.findIndex(l => l.startsWith('update:'));

    if (todosIdx !== -1) {
      // 创建新任务列表
      const todoLines = lines.slice(todosIdx + 1).filter(l => l.startsWith('-'));
      const todos = todoLines.map(line => {
        const contentMatch = line.match(/content:\s*(.+)/);
        const statusMatch = line.match(/status:\s*(\w+)/);
        const priorityMatch = line.match(/priority:\s*(\w+)/);
        return {
          content: contentMatch ? contentMatch[1].trim() : '',
          status: statusMatch ? statusMatch[1] : 'pending',
          priority: priorityMatch ? priorityMatch[1] : 'medium'
        };
      });
      blocks.push({ action: 'create', todos });
    } else if (updateIdx !== -1) {
      // 更新任务
      const updateLines = lines.slice(updateIdx + 1).filter(l => l.startsWith('-'));
      const updates = updateLines.map(line => {
        const idMatch = line.match(/id:\s*(\d+)/);
        const statusMatch = line.match(/status:\s*(\w+)/);
        return {
          id: idMatch ? parseInt(idMatch[1]) : null,
          status: statusMatch ? statusMatch[1] : null
        };
      });
      blocks.push({ action: 'update', updates });
    }
  }
  return blocks;
}

// 任务列表存储（简化实现，实际应该持久化）
const sessionTodoLists = new Map();

export async function executeTodoWrite(input, session) {
  const { action, todos, updates } = input;

  if (action === 'create') {
    const todoList = todos.map((t, i) => ({
      id: i + 1,
      ...t,
      created_at: Date.now()
    }));
    sessionTodoLists.set(session.id, todoList);
    return `任务列表已创建，共 ${todoList.length} 个任务`;
  } else if (action === 'update') {
    const existingTodos = sessionTodoLists.get(session.id) || [];
    for (const u of updates) {
      const todo = existingTodos.find(t => t.id === u.id);
      if (todo) {
        todo.status = u.status;
      }
    }
    sessionTodoLists.set(session.id, existingTodos);
    const completed = existingTodos.filter(t => t.status === 'completed').length;
    return `任务已更新，${completed}/${existingTodos.length} 已完成`;
  }

  return '未知操作';
}

// ===== 工具定义 =====

export const FREE_CODE_TOOL_DEFINITIONS = [
  {
    id: 'glob',
    label: 'Glob',
    description: '文件搜索（glob 模式）',
    icon: 'search',
    instruction: GLOB_TOOL_INSTRUCTION,
    extract: extractGlobBlocks,
    execute: executeGlob,
    configured: () => true
  },
  {
    id: 'grep',
    label: 'Grep',
    description: '内容搜索（正则匹配）',
    icon: 'search',
    instruction: GREP_TOOL_INSTRUCTION,
    extract: extractGrepBlocks,
    execute: executeGrep,
    configured: () => true
  },
  {
    id: 'todo_write',
    label: 'TodoWrite',
    description: '任务管理（创建/更新任务列表）',
    icon: 'list',
    instruction: TODO_WRITE_INSTRUCTION,
    extract: extractTodoWriteBlocks,
    execute: executeTodoWrite,
    configured: () => true
  }
];

/**
 * 获取 free-code 工具的指令文本
 */
export function getFreeCodeToolInstructions() {
  return FREE_CODE_TOOL_DEFINITIONS
    .filter(tool => tool.configured())
    .map(tool => tool.instruction)
    .join('\n\n');
}

/**
 * 获取 free-code 工具定义
 */
export function getFreeCodeToolDefinitions() {
  return FREE_CODE_TOOL_DEFINITIONS.map(tool => ({
    id: tool.id,
    label: tool.label,
    description: tool.description,
    icon: tool.icon,
    configured: tool.configured(),
    instruction: tool.instruction
  }));
}

/**
 * 从 AI 输出中提取并执行 free-code 工具调用
 */
export async function extractAndExecuteFreeCodeTools(text, session) {
  const results = [];

  for (const tool of FREE_CODE_TOOL_DEFINITIONS) {
    if (!tool.extract || !tool.execute) continue;

    const blocks = tool.extract(text);
    for (const block of blocks) {
      try {
        const result = await tool.execute(block, session);
        results.push({ tool: tool.id, ok: true, result, input: block });
      } catch (err) {
        results.push({ tool: tool.id, ok: false, error: err.message, input: block });
      }
    }
  }

  return results;
}

/**
 * 获取会话的任务列表
 */
export function getSessionTodos(sessionId) {
  return sessionTodoLists.get(sessionId) || [];
}