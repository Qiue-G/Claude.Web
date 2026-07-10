let compiledTools = null;
let loadAttempted = false;

/**
 * 加载 Docker 构建时编译的 free-code 工具
 */
export async function loadCompiledTools() {
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
        console.log(`[bridgeUtils] Loaded compiled tools from ${p}`);
        return compiledTools;
      }
    } catch {
      // 路径不存在或加载失败，尝试下一个
    }
  }

  console.log('[bridgeUtils] Compiled tools not available, using native fallback');
  return null;
}

/**
 * 桥接模式高阶函数
 * 优先使用编译版工具，失败时回退到原生实现
 * 
 * @param {Function} compiledToolFn - 编译版工具函数
 * @param {Function} nativeFn - 原生工具函数
 * @param {string} toolName - 工具名称（用于日志）
 * @returns {Function} 桥接函数
 */
export function withCompiledFallback(compiledToolFn, nativeFn, toolName) {
  return async (...args) => {
    const fc = await loadCompiledTools();
    
    if (fc && compiledToolFn(fc)) {
      try {
        return await compiledToolFn(fc)(...args);
      } catch (err) {
        console.warn(`[bridge] ${toolName} compiled version failed:`, err.message);
      }
    }
    
    return await nativeFn(...args);
  };
}
