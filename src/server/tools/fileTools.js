/**
 * 文件操作工具模块
 *
 * 集中管理所有文件操作工具的定义：
 * - instruction: 提示词指令（告诉 AI 如何输出）
 * - extract: 解析函数（从 AI 输出中提取工具调用）
 * - execute: 执行函数（执行文件操作）
 *
 * 工具列表：write_file, edit_file, delete_file, rename_file, list_files, read_file
 */

import fs from 'fs/promises';
import path from 'path';

// ===== 工具指令 =====

const FILE_TOOL_INSTRUCTIONS = {
  write_file: `You can write files directly to disk using Node.js fs.writeFile. Use this instead of bash echo/redirect when creating or overwriting files. Output in the following format:

\`\`\`write_file
path: relative/file/path
language: file_extension

The file content goes here...
\`\`\``,

  edit_file: `You can edit existing files using search-and-replace. Output in the following format:

\`\`\`edit_file
path: relative/file/path
<<<<<<< SEARCH
old content to replace
=======
new content to replace with
>>>>>>>
\`\`\``,

  delete_file: `You can delete files. Output in the following format:

\`\`\`delete_file
path: relative/file/path
\`\`\``,

  rename_file: `You can rename/move files. Output in the following format:

\`\`\`rename_file
path: old/relative/file/path
newPath: new/relative/file/path
\`\`\``,

  list_files: `You can list files in a directory. Output in the following format:

\`\`\`list_files
path: optional/sub/directory (omit path: to list root)
\`\`\``,

  read_file: `You can read files from disk. Output in the following format:

\`\`\`read_file
path: relative/file/path
\`\`\`

The file content will be returned to you for analysis.`
};

// ===== 解析函数 =====

/**
 * Extract write_file fenced blocks from AI output.
 */
function extractWriteFileBlocks(text) {
  const blocks = [];
  const regex = /```write_file\n?([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const block = match[1].trim();
    const lines = block.split('\n');
    const pathIdx = lines.findIndex(l => l.startsWith('path:'));
    if (pathIdx === -1) continue;
    const filePath = lines[pathIdx].slice(5).trim();
    const contentLines = lines.slice(pathIdx + 1).filter((l, i, arr) => {
      if (i === 0 && l.trim() === '') return false;
      return true;
    });
    let start = 0;
    while (start < contentLines.length && contentLines[start].trim() === '') start++;
    const content = contentLines.slice(start).join('\n');
    blocks.push({ path: filePath, content });
  }
  return blocks;
}

/**
 * Extract edit_file fenced blocks from AI output.
 */
function extractEditFileBlocks(text) {
  const blocks = [];
  const regex = /```edit_file\n?([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const block = match[1].trim();
    const lines = block.split('\n');
    const pathIdx = lines.findIndex(l => l.startsWith('path:'));
    if (pathIdx === -1) continue;
    const filePath = lines[pathIdx].slice(5).trim();
    const searchStart = lines.findIndex(l => l.includes('<<<<<<< SEARCH') || l.includes('<<<<<<<'));
    const divider = lines.findIndex(l => l.startsWith('======='));
    const replaceEnd = lines.findIndex(l => l.startsWith('>>>>>>>'));
    if (searchStart === -1 || divider === -1 || replaceEnd === -1) continue;
    const searchStr = lines.slice(searchStart + 1, divider).join('\n').trim();
    const replaceStr = lines.slice(divider + 1, replaceEnd).join('\n').trim();
    if (!searchStr) continue;
    blocks.push({ path: filePath, searchStr, replaceStr });
  }
  return blocks;
}

/**
 * Extract delete_file fenced blocks from AI output.
 */
function extractDeleteFileBlocks(text) {
  const blocks = [];
  const regex = /```delete_file\n?([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const block = match[1].trim();
    const lines = block.split('\n');
    const pathIdx = lines.findIndex(l => l.startsWith('path:'));
    if (pathIdx === -1) continue;
    const filePath = lines[pathIdx].slice(5).trim();
    if (!filePath) continue;
    blocks.push({ path: filePath });
  }
  return blocks;
}

/**
 * Extract rename_file fenced blocks from AI output.
 */
function extractRenameFileBlocks(text) {
  const blocks = [];
  const regex = /```rename_file\n?([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const block = match[1].trim();
    const lines = block.split('\n');
    const pathIdx = lines.findIndex(l => l.startsWith('path:'));
    if (pathIdx === -1) continue;
    const oldPath = lines[pathIdx].slice(5).trim();
    const newPathIdx = lines.findIndex(l => l.startsWith('newPath:'));
    if (newPathIdx === -1) continue;
    const newPath = lines[newPathIdx].slice(8).trim();
    if (!oldPath || !newPath) continue;
    blocks.push({ path: oldPath, newPath });
  }
  return blocks;
}

/**
 * Extract list_files fenced blocks from AI output.
 */
function extractListFilesBlocks(text) {
  const blocks = [];
  const regex = /```list_files\n?([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const block = match[1].trim();
    const lines = block.split('\n');
    const pathIdx = lines.findIndex(l => l.startsWith('path:'));
    const dirPath = pathIdx !== -1 ? lines[pathIdx].slice(5).trim() : '';
    blocks.push({ path: dirPath || '.' });
  }
  return blocks;
}

/**
 * Extract read_file fenced blocks from AI output.
 */
function extractReadFileBlocks(text) {
  const blocks = [];
  const regex = /```read_file\n?([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const block = match[1].trim();
    const lines = block.split('\n');
    const pathIdx = lines.findIndex(l => l.startsWith('path:'));
    if (pathIdx === -1) continue;
    const filePath = lines[pathIdx].slice(5).trim();
    if (!filePath) continue;
    blocks.push({ path: filePath });
  }
  return blocks;
}

// ===== 执行函数 =====

/**
 * 安全检查：路径是否在允许的工作目录内
 */
function isPathInDir(filePath, allowedDir) {
  const resolvedDir = path.resolve(allowedDir) + path.sep;
  return filePath === path.resolve(allowedDir) || filePath.startsWith(resolvedDir);
}

/**
 * Recursively list files in a directory, returning relative paths.
 */
async function listFilesRecursive(dirPath, basePath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relPath = path.relative(basePath, fullPath);
    if (entry.isDirectory()) {
      results.push(relPath + '/');
      const sub = await listFilesRecursive(fullPath, basePath);
      results.push(...sub);
    } else {
      const stat = await fs.stat(fullPath);
      const size = stat.size > 1024 ? `${(stat.size / 1024).toFixed(1)} KB` : `${stat.size} B`;
      results.push(`${relPath} (${size})`);
    }
  }
  return results.sort();
}

/**
 * Execute file tool calls.
 * @param {string} toolName - Tool name (write_file, edit_file, etc.)
 * @param {object} input - Tool input parameters
 * @param {object} session - Session object with dir property
 * @returns {Promise<string>} - Result message
 */
export async function executeFileTool(toolName, input, session) {
  const resolvedSessionDir = path.resolve(session.dir);

  switch (toolName) {
    case 'write_file': {
      const { path: filePath, content } = input;
      const fullPath = path.resolve(session.dir, filePath);
      if (!isPathInDir(fullPath, resolvedSessionDir)) {
        throw new Error(`路径 ${filePath} 不在允许的工作目录内`);
      }
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf-8');
      return `文件已写入: ${filePath} (${content.length} 字符)`;
    }

    case 'edit_file': {
      const { path: filePath, searchStr, replaceStr } = input;
      const fullPath = path.resolve(session.dir, filePath);
      if (!isPathInDir(fullPath, resolvedSessionDir)) {
        throw new Error(`路径 ${filePath} 不在允许的工作目录内`);
      }
      const currentContent = await fs.readFile(fullPath, 'utf-8');
      if (!currentContent.includes(searchStr)) {
        throw new Error(`未找到匹配的原文`);
      }
      const newContent = currentContent.replace(searchStr, replaceStr);
      if (newContent === currentContent) {
        throw new Error(`替换后内容无变化`);
      }
      await fs.writeFile(fullPath, newContent, 'utf-8');
      return `文件已编辑: ${filePath}`;
    }

    case 'delete_file': {
      const { path: filePath } = input;
      const fullPath = path.resolve(session.dir, filePath);
      if (!isPathInDir(fullPath, resolvedSessionDir)) {
        throw new Error(`路径 ${filePath} 不在允许的工作目录内`);
      }
      await fs.unlink(fullPath);
      return `文件已删除: ${filePath}`;
    }

    case 'rename_file': {
      const { path: oldPath, newPath } = input;
      const oldFullPath = path.resolve(session.dir, oldPath);
      const newFullPath = path.resolve(session.dir, newPath);
      if (!isPathInDir(oldFullPath, resolvedSessionDir) || !isPathInDir(newFullPath, resolvedSessionDir)) {
        throw new Error(`路径不在允许的工作目录内`);
      }
      await fs.mkdir(path.dirname(newFullPath), { recursive: true });
      await fs.rename(oldFullPath, newFullPath);
      return `文件已重命名: ${oldPath} → ${newPath}`;
    }

    case 'list_files': {
      const { path: dirPath = '' } = input;
      const fullDirPath = path.resolve(session.dir, dirPath);
      if (!isPathInDir(fullDirPath, resolvedSessionDir)) {
        throw new Error(`路径 ${dirPath} 不在允许的工作目录内`);
      }
      const files = await listFilesRecursive(fullDirPath, session.dir);
      return `目录列表:\n${files.join('\n')}`;
    }

    case 'read_file': {
      const { path: filePath } = input;
      const fullPath = path.resolve(session.dir, filePath);
      if (!isPathInDir(fullPath, resolvedSessionDir)) {
        throw new Error(`路径 ${filePath} 不在允许的工作目录内`);
      }
      const content = await fs.readFile(fullPath, 'utf-8');
      const stat = await fs.stat(fullPath);
      const size = stat.size > 1024 ? `${(stat.size / 1024).toFixed(1)} KB` : `${stat.size} B`;
      return `文件内容 (${filePath}, ${size}):\n\`\`\`\n${content}\n\`\`\``;
    }

    default:
      throw new Error(`未知文件工具: ${toolName}`);
  }
}

// ===== 工具定义 =====

/**
 * 文件操作工具完整定义列表
 * 每个工具包含：id, instruction, extract, execute, label, description, icon
 */
export const FILE_TOOL_DEFINITIONS = [
  {
    id: 'write_file',
    label: 'Write File',
    description: '创建或覆盖文件',
    icon: 'file-plus',
    instruction: FILE_TOOL_INSTRUCTIONS.write_file,
    extract: extractWriteFileBlocks,
    execute: executeFileTool,
    configured: () => true
  },
  {
    id: 'edit_file',
    label: 'Edit File',
    description: '编辑现有文件（搜索替换）',
    icon: 'edit',
    instruction: FILE_TOOL_INSTRUCTIONS.edit_file,
    extract: extractEditFileBlocks,
    execute: executeFileTool,
    configured: () => true
  },
  {
    id: 'delete_file',
    label: 'Delete File',
    description: '删除文件',
    icon: 'trash',
    instruction: FILE_TOOL_INSTRUCTIONS.delete_file,
    extract: extractDeleteFileBlocks,
    execute: executeFileTool,
    configured: () => true
  },
  {
    id: 'rename_file',
    label: 'Rename File',
    description: '重命名或移动文件',
    icon: 'move',
    instruction: FILE_TOOL_INSTRUCTIONS.rename_file,
    extract: extractRenameFileBlocks,
    execute: executeFileTool,
    configured: () => true
  },
  {
    id: 'list_files',
    label: 'List Files',
    description: '列出目录中的文件',
    icon: 'folder',
    instruction: FILE_TOOL_INSTRUCTIONS.list_files,
    extract: extractListFilesBlocks,
    execute: executeFileTool,
    configured: () => true
  },
  {
    id: 'read_file',
    label: 'Read File',
    description: '读取文件内容',
    icon: 'file-text',
    instruction: FILE_TOOL_INSTRUCTIONS.read_file,
    extract: extractReadFileBlocks,
    execute: executeFileTool,
    configured: () => true
  }
];

/**
 * 获取文件工具的指令文本（用于注入提示词）
 * @returns {string}
 */
export function getFileToolInstructions() {
  return FILE_TOOL_DEFINITIONS
    .filter(tool => tool.configured())
    .map(tool => tool.instruction)
    .join('\n\n');
}

/**
 * 获取文件工具定义（用于 API 返回）
 * @returns {Array}
 */
export function getFileToolDefinitions() {
  return FILE_TOOL_DEFINITIONS.map(tool => ({
    id: tool.id,
    label: tool.label,
    description: tool.description,
    icon: tool.icon,
    configured: tool.configured(),
    instruction: tool.instruction
  }));
}

/**
 * 从 AI 输出中提取所有文件工具调用并执行
 * @param {string} text - AI 输出文本
 * @param {object} session - Session 对象
 * @returns {Promise<Array<{tool: string, result: string, error?: string}>>}
 */
export async function extractAndExecuteFileTools(text, session) {
  const results = [];

  for (const tool of FILE_TOOL_DEFINITIONS) {
    if (!tool.extract || !tool.execute) continue;

    const blocks = tool.extract(text);
    for (const block of blocks) {
      try {
        const result = await tool.execute(tool.id, block, session);
        results.push({ tool: tool.id, ok: true, result, input: block });
      } catch (err) {
        results.push({ tool: tool.id, ok: false, error: err.message, input: block });
      }
    }
  }

  return results;
}

// 导出安全检查函数供外部使用
export { isPathInDir };