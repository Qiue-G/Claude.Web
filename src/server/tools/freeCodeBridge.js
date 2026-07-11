/**
 * free-code 工具桥接加载器
 *
 * 运行时加载 Docker 构建时编译的 free-code 工具
 * 如果编译的工具不可用，回退到原生实现
 */

import path from 'path';
import { withCompiledFallback } from './bridgeUtils.js';

/**
 * 安全路径解析：将 filePath 解析为 cwd 下的绝对路径，并检查是否在 cwd 内
 * 防止模型传入绝对路径（如 /Users/...）导致路径逃逸
 */
function resolveSafePath(filePath, cwd) {
  // 将绝对路径转为相对路径：去掉前导 /
  let safeFilePath = filePath;
  if (path.isAbsolute(filePath)) {
    safeFilePath = filePath.replace(/^\/+/, '');
  }
  const fullPath = path.resolve(cwd, safeFilePath);
  const resolvedCwd = path.resolve(cwd);
  const relativePath = path.relative(resolvedCwd, fullPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`路径越界: ${filePath} 不在工作目录内`);
  }
  return fullPath;
}

// ===== Glob：文件搜索 =====

/**
 * 文件搜索 - 优先使用 free-code 编译版本，回退到原生 node-glob
 */
export const globSearch = withCompiledFallback(
  (fc) => fc.globSearch,
  async (pattern, dir, cwd) => {
    // 原生回退：使用 node-glob
    const fs = await import('fs/promises');
    const { glob } = await import('glob');

    const searchDir = dir || cwd;
    const files = await glob(pattern, { cwd: searchDir, nodir: true, stat: true });

    const filesWithStats = await Promise.all(
      files.map(async (f) => {
        const stat = await fs.stat(path.join(searchDir, f));
        return { path: f, mtime: stat.mtimeMs };
      })
    );

    filesWithStats.sort((a, b) => b.mtime - a.mtime);

    return {
      filenames: filesWithStats.map(f => f.path),
      numFiles: files.length,
      truncated: files.length > 100,
      durationMs: 0,
    };
  },
  'globSearch'
);

/**
 * Grep 搜索 - 优先使用 free-code 编译版本，回退到原生实现
 */
export const grepSearch = withCompiledFallback(
  (fc) => fc.grepSearch,
  async (pattern, dir, cwd, globFilter, outputMode) => {
    // 原生回退：使用 Node.js readFile + RegExp
    const fs = await import('fs/promises');
    const { glob } = await import('glob');

    const searchDir = dir || cwd;
    const files = await glob(globFilter || '**/*', { cwd: searchDir, nodir: true });
    const results = [];
    const regex = new RegExp(pattern, 'g');

    for (const file of files) {
      try {
        const content = await fs.readFile(path.join(searchDir, file), 'utf-8');
        const lines = content.split('\n');
        const matches = [];

        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            matches.push({ line: i + 1, content: lines[i].trim() });
            regex.lastIndex = 0;
          }
        }

        if (matches.length > 0) {
          if (outputMode === 'files_with_matches') {
            results.push(file);
          } else {
            results.push(`${file}:\n${matches.map(m => `  ${m.line}: ${m.content}`).join('\n')}`);
          }
        }
      } catch {
        // 忽略读取错误
      }
    }

    return results;
  },
  'grepSearch'
);

// ===== 文件工具桥接 =====

/**
 * 写入文件 - 优先使用 free-code 编译版本，回退到原生实现
 */
export const bridgeWriteFile = withCompiledFallback(
  (fc) => fc.writeFileTool,
  async (filePath, content, cwd) => {
    const fs = await import('fs/promises');
    const fullPath = resolveSafePath(filePath, cwd);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
    return `文件已写入: ${filePath} (${content.length} 字符)`;
  },
  'bridgeWriteFile'
);

/**
 * 读取文件 - 优先使用 free-code 编译版本，回退到原生实现
 */
export const bridgeReadFile = withCompiledFallback(
  (fc) => fc.readFileTool,
  async (filePath, cwd) => {
    const fs = await import('fs/promises');
    const fullPath = resolveSafePath(filePath, cwd);
    const content = await fs.readFile(fullPath, 'utf-8');
    const stat = await fs.stat(fullPath);
    const size = stat.size > 1024 ? `${(stat.size / 1024).toFixed(1)} KB` : `${stat.size} B`;
    return `文件内容 (${filePath}, ${size}):\n\`\`\`\n${content}\n\`\`\``;
  },
  'bridgeReadFile'
);

/**
 * 编辑文件（搜索替换）- 优先使用 free-code 编译版本，回退到原生实现
 */
export const bridgeEditFile = withCompiledFallback(
  (fc) => fc.editFileTool,
  async (filePath, oldString, newString, cwd) => {
    const fs = await import('fs/promises');
    const fullPath = resolveSafePath(filePath, cwd);
    let content = await fs.readFile(fullPath, 'utf-8');
    if (!content.includes(oldString)) {
      throw new Error(`未找到匹配的原文`);
    }
    const newContent = content.replace(oldString, newString);
    if (newContent === content) {
      throw new Error(`替换后内容无变化`);
    }
    await fs.writeFile(fullPath, newContent, 'utf-8');
    return `文件已编辑: ${filePath}`;
  },
  'bridgeEditFile'
);

/**
 * 删除文件 - 优先使用 free-code 编译版本，回退到原生实现
 */
export const bridgeDeleteFile = withCompiledFallback(
  (fc) => fc.deleteFileTool,
  async (filePath, cwd) => {
    const fs = await import('fs/promises');
    const fullPath = resolveSafePath(filePath, cwd);
    await fs.unlink(fullPath);
    return `文件已删除: ${filePath}`;
  },
  'bridgeDeleteFile'
);

/**
 * 重命名文件 - 优先使用 free-code 编译版本，回退到原生实现
 */
export const bridgeRenameFile = withCompiledFallback(
  (fc) => fc.renameFileTool,
  async (oldPath, newPath, cwd) => {
    const fs = await import('fs/promises');
    const oldFullPath = resolveSafePath(oldPath, cwd);
    const newFullPath = resolveSafePath(newPath, cwd);
    await fs.mkdir(path.dirname(newFullPath), { recursive: true });
    await fs.rename(oldFullPath, newFullPath);
    return `文件已重命名: ${oldPath} → ${newPath}`;
  },
  'bridgeRenameFile'
);

/**
 * 列出文件 - 优先使用 free-code 编译版本，回退到原生实现
 */
export const bridgeListFiles = withCompiledFallback(
  (fc) => fc.listFilesTool,
  async (dir, cwd) => {
    const fs = await import('fs/promises');
    const fullPath = resolveSafePath(dir || '.', cwd);
    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    return entries.map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`).join('\n');
  },
  'bridgeListFiles'
);
