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

export default { loadCompiledTools, globSearch, grepSearch };
