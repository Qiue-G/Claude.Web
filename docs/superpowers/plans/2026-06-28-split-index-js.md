# index.js 模块拆分实施计划

**目标：** 将 index.js 中的 File API 路由和 WebSocket 处理逻辑拆为独立模块，使 index.js 从 ~897 行降到 ~250 行。

## 拆分方案

### 模块结构

```
src/server/
├── index.js              ← ~250行：启动、中间件、session 路由、models/health/config 路由
├── routes/
│   ├── fileRoutes.js     ← 新增：File API 全部路由
│   └── wsHandler.js      ← 新增：WebSocket 消息处理逻辑
├── runtime/
│   └── promptBuilder.js
└── tools/
    ├── registry.js
    ├── webSearch.js
    ├── codeInterpreter.js
    └── fileAnalysis.js
```

### Task 1: 拆 File API 路由

**文件：** 新建 `src/server/routes/fileRoutes.js`

提取代码块：
- CSRF 中间件（检查 x-csrf-token）
- File API rate limiter 中间件
- GET /api/files/:sessionId — 文件树
- GET /api/files/:sessionId/* — 读取文件
- POST /api/files/:sessionId/* — 写入文件
- DELETE /api/files/:sessionId/* — 删除文件

需要从 index.js 导入的依赖：
- `getSession`（session 管理）
- `checkRateLimit`（rate limiter）
- `sessions` Map（CSRF 校验用）
- `join`, `pathResolve`, `pathDirname`, `existsSync`, `readFile`, `writeFile`, `mkdir`, `unlink`, `rm`, `stat`
- `RATE_WINDOW`, `RATE_MAX_FILE` 常量

方案：将 `getSession`, `checkRateLimit`, `sessions` 作为参数传入，或直接引用。由于这些是模块级别的导出，我改用一个导出的 context 对象或直接 import 共享模块。

实际上最简单的方式是：新建 `src/server/sessionManager.js`，把 sessions Map / getSession / createSession 等移到里面，然后 fileRoutes 和 index.js 都 import 它。

但为了最小改动，不如直接把函数传进去，或者让 fileRoutes.js export 一个 `createFileRouter(getSession, sessions, checkRateLimit, RATE_WINDOW, RATE_MAX_FILE)` 工厂函数。

思路：使用 Express Router.factory 模式。

**依赖注入模式：**

```js
// fileRoutes.js
import { Router } from 'express';
import { join, resolve as pathResolve, dirname as pathDirname } from 'path';
import { existsSync } from 'fs';
import { readFile, writeFile, mkdir, unlink, rm, stat } from 'fs/promises';

export function createFileRouter(deps) {
  const router = Router();
  const { getSession, sessions, checkRateLimit, RATE_WINDOW, RATE_MAX_FILE } = deps;

  // CSRF middleware
  router.use((req, res, next) => { ... });
  // rate limiter middleware
  router.use((req, res, next) => { ... });
  // GET file tree
  router.get('/:sessionId', ...);
  // GET file content
  router.get('/:sessionId/*', ...);
  // POST file write
  router.post('/:sessionId/*', ...);
  // DELETE file delete
  router.delete('/:sessionId/*', ...);

  return router;
}
```

然后在 index.js 中：
```js
import { createFileRouter } from './routes/fileRoutes.js';
app.use('/api/files', createFileRouter({ getSession, sessions, checkRateLimit, RATE_WINDOW, RATE_MAX_FILE }));
```

### Task 2: 拆 WebSocket 处理器

**文件：** 新建 `src/server/routes/wsHandler.js`

提取代码块：wss.on('connection') 内部的全部逻辑

需要从 index.js 导入的依赖：
- `getSession`, `sessions`, `sessionProcesses`, `sessionProxies`, `sessionClients`, `wsProcCount`
- `broadcastToSession`
- `spawnCli`, `maskSensitive`, `stripAnsi`
- `searchWeb`, `executePython`, `extractPythonBlocks`
- `analyzeFilesFromPromptContext`, `stripFileBlocksFromPrompt`
- `buildPrompt`, `getToolInstructions`
- `RATE_WINDOW`, `RATE_MAX_INPUT`
- `sessionClients`

同样使用工厂函数模式：

```js
// wsHandler.js
export function createWsHandler(deps) {
  return function handleConnection(ws, req) {
    // ... existing code
  };
}
```

然后在 index.js 中：
```js
import { createWsHandler } from './routes/wsHandler.js';
wss.on('connection', createWsHandler({
  getSession, sessions, sessionProcesses, sessionProxies, sessionClients, wsProcCount,
  broadcastToSession, spawnCli, maskSensitive, stripAnsi,
  searchWeb, executePython, extractPythonBlocks,
  analyzeFilesFromPromptContext, stripFileBlocksFromPrompt,
  buildPrompt, getToolInstructions,
  ALLOWED_ORIGINS, RATE_WINDOW, RATE_MAX_INPUT
}));
```
