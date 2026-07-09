/**
 * free-code 工具桥接加载器
 *
 * 运行时加载 Docker 构建时编译的 free-code 工具
 * 如果编译的工具不可用，回退到原生实现
 */

let compiledTools = null;
let loadAttempted = false;

/**
 * 加载 Docker 构建时编译的 free-code 工具
 */
async function loadCompiledTools() {
  if (loadAttempted) return compiledTools;
  loadAttempted = true;

  // 在 Railway/Docker 环境中，编译后的工具存放在 /app/fc-tools/
  const possiblePaths = [
    '/app/fc-tools/index.js',
    '/app/fc-tools/tools.js',
    '/free-code/dist/web-bridge.js',
  ];

  for (const p of possiblePaths) {
    try {
      const mod = await import(p);
      if (mod && (mod.globFiles || mod.globSearch)) {
        compiledTools = mod;
        console.log(`[freeCodeBridge] Loaded compiled tools from ${p}`);
        return compiledTools;
      }
    } catch {
      // 路径不存在或加载失败，尝试下一个
    }
  }

  console.log('[freeCodeBridge] Compiled tools not available, using native fallback');
  return null;
}

// ===== Glob：文件搜索 =====

/**
 * 文件搜索 - 优先使用 free-code 编译版本，回退到原生 node-glob
 */
export async function globSearch(pattern, dir, cwd) {
  const fc = await loadCompiledTools();

  if (fc && fc.globSearch) {
    try {
      return await fc.globSearch(pattern, dir || cwd);
    } catch (err) {
      console.warn(`[freeCodeBridge] Compiled globSearch failed: ${err.message}, falling back`);
    }
  }

  // 原生回退：使用 node-glob
  const fs = await import('fs/promises');
  const path = await import('path');
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
}

/**
 * Grep 搜索 - 优先使用 free-code 编译版本，回退到原生实现
 */
export async function grepSearch(pattern, dir, cwd, globFilter, outputMode) {
  const fc = await loadCompiledTools();

  if (fc && fc.grepSearch) {
    try {
      return await fc.grepSearch(pattern, dir || cwd, globFilter, outputMode || 'files_with_matches');
    } catch (err) {
      console.warn(`[freeCodeBridge] Compiled grepSearch failed: ${err.message}, falling back`);
    }
  }

  // 原生回退：使用 Node.js readFile + RegExp
  const fs = await import('fs/promises');
  const path = await import('path');
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
}

export default { loadCompiledTools, globSearch, grepSearch, bridgeWriteFile, bridgeReadFile, bridgeEditFile, bridgeDeleteFile, bridgeRenameFile, bridgeListFiles };

// ===== 文件工具桥接 =====

/**
 * 写入文件 - 优先使用 free-code 编译版本，回退到原生实现
 */
export async function bridgeWriteFile(filePath, content, cwd) {
  const fc = await loadCompiledTools();

  if (fc && fc.writeFileTool) {
    try {
      return await fc.writeFileTool(filePath, content, cwd);
    } catch (err) {
      console.warn(`[freeCodeBridge] Compiled writeFileTool failed: ${err.message}, falling back`);
    }
  }

  // 原生回退
  const fs = await import('fs/promises');
  const path = await import('path');
  const fullPath = path.resolve(cwd, filePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf-8');
  return `文件已写入: ${filePath} (${content.length} 字符)`;
}

/**
 * 读取文件 - 优先使用 free-code 编译版本，回退到原生实现
 */
export async function bridgeReadFile(filePath, cwd) {
  const fc = await loadCompiledTools();

  if (fc && fc.readFileTool) {
    try {
      return await fc.readFileTool(filePath, cwd);
    } catch (err) {
      console.warn(`[freeCodeBridge] Compiled readFileTool failed: ${err.message}, falling back`);
    }
  }

  // 原生回退
  const fs = await import('fs/promises');
  const path = await import('path');
  const fullPath = path.resolve(cwd, filePath);
  const content = await fs.readFile(fullPath, 'utf-8');
  const stat = await fs.stat(fullPath);
  const size = stat.size > 1024 ? `${(stat.size / 1024).toFixed(1)} KB` : `${stat.size} B`;
  return `文件内容 (${filePath}, ${size}):\n\`\`\`\n${content}\n\`\`\``;
}

/**
 * 编辑文件（搜索替换）- 优先使用 free-code 编译版本，回退到原生实现
 */
export async function bridgeEditFile(filePath, oldString, newString, cwd) {
  const fc = await loadCompiledTools();

  if (fc && fc.editFileTool) {
    try {
      return await fc.editFileTool(filePath, oldString, newString, cwd);
    } catch (err) {
      console.warn(`[freeCodeBridge] Compiled editFileTool failed: ${err.message}, falling back`);
    }
  }

  // 原生回退
  const fs = await import('fs/promises');
  const path = await import('path');
  const fullPath = path.resolve(cwd, filePath);
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
}

/**
 * 删除文件 - 优先使用 free-code 编译版本，回退到原生实现
 */
export async function bridgeDeleteFile(filePath, cwd) {
  const fc = await loadCompiledTools();

  if (fc && fc.deleteFileTool) {
    try {
      return await fc.deleteFileTool(filePath, cwd);
    } catch (err) {
      console.warn(`[freeCodeBridge] Compiled deleteFileTool failed: ${err.message}, falling back`);
    }
  }

  // 原生回退
  const fs = await import('fs/promises');
  const path = await import('path');
  const fullPath = path.resolve(cwd, filePath);
  await fs.unlink(fullPath);
  return `文件已删除: ${filePath}`;
}

/**
 * 重命名文件 - 优先使用 free-code 编译版本，回退到原生实现
 */
export async function bridgeRenameFile(oldPath, newPath, cwd) {
  const fc = await loadCompiledTools();

  if (fc && fc.renameFileTool) {
    try {
      return await fc.renameFileTool(oldPath, newPath, cwd);
    } catch (err) {
      console.warn(`[freeCodeBridge] Compiled renameFileTool failed: ${err.message}, falling back`);
    }
  }

  // 原生回退
  const fs = await import('fs/promises');
  const path = await import('path');
  const oldFullPath = path.resolve(cwd, oldPath);
  const newFullPath = path.resolve(cwd, newPath);
  await fs.mkdir(path.dirname(newFullPath), { recursive: true });
  await fs.rename(oldFullPath, newFullPath);
  return `文件已重命名: ${oldPath} → ${newPath}`;
}

/**
 * 列出文件 - 优先使用 free-code 编译版本，回退到原生实现
 */
export async function bridgeListFiles(dir, cwd) {
  const fc = await loadCompiledTools();

  if (fc && fc.listFilesTool) {
    try {
      return await fc.listFilesTool(dir, cwd);
    } catch (err) {
      console.warn(`[freeCodeBridge] Compiled listFilesTool failed: ${err.message}, falling back`);
    }
  }

  // 原生回退
  const fs = await import('fs/promises');
  const path = await import('path');
  const fullPath = path.resolve(cwd, dir || '.');
  const entries = await fs.readdir(fullPath, { withFileTypes: true });
  return entries.map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`).join('\n');
}
