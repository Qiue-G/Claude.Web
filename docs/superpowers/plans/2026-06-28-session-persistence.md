# 会话持久化实施计划

**目标：** 将 `sessions` Map 持久化到 JSON 文件，服务器重启后会话不丢失。

**方案：** 创建 `src/server/sessionManager.js`，封装 session CRUD + JSON 文件持久化。

**持久化文件：** `WORKSPACE_DIR/_sessions.json`

**不持久化的数据：** `sessionProcesses`, `sessionProxies`, `sessionClients`, `wsProcCount`, `modelStats` 等运行时状态保持内存 Map。

**文件变更：**
- Create: `src/server/sessionManager.js`
- Modify: `src/server/index.js` — 替换局部实现为模块导入
- (fileRoutes.js 和 wsHandler.js 通过 DI 接收依赖，无需修改)

---

### Task 1: 创建 sessionManager.js

```js
// src/server/sessionManager.js
// 封装 sessions Map + JSON 文件持久化

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { dirname as pathDirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = pathDirname(__filename);

const SESSION_FILE = 'sessions.json';

export function createSessionManager(workspaceDir) {
  const sessions = new Map();
  const filePath = join(workspaceDir, '_' + SESSION_FILE);

  async function loadSessions() {
    try {
      if (!existsSync(filePath)) return;
      const raw = await readFile(filePath, 'utf-8');
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return;
      for (const item of data) {
        sessions.set(item.id, item);
      }
      console.log('[SESSION] loaded ' + sessions.size + ' sessions from ' + filePath);
    } catch (e) {
      console.log('[SESSION] no saved sessions to load (' + e.message + ')');
    }
  }

  async function saveSessions() {
    try {
      const dir = pathDirname(filePath);
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });
      const data = JSON.stringify(Array.from(sessions.values()));
      await writeFile(filePath, data, 'utf-8');
    } catch (e) {
      console.error('[SESSION] save failed:', e.message);
    }
  }

  async function createSession(apiKey, model, provider, maxSessions) {
    if (sessions.size >= maxSessions) return null;
    const sessionId = uuidv4();
    const sessionToken = uuidv4();
    const csrfToken = uuidv4();
    const sessionDir = join(workspaceDir, sessionId);
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(sessionDir, { recursive: true });
    const session = {
      id: sessionId, token: sessionToken, csrfToken,
      apiKey, model, provider,
      dir: sessionDir,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      currentModel: model,
      modelHealth: 'connecting'
    };
    sessions.set(sessionId, session);
    await saveSessions();
    return session;
  }

  function getSession(sessionId, token) {
    const session = sessions.get(sessionId);
    if (session) {
      if (token && session.token !== token) return null;
      session.lastActivity = Date.now();
    }
    return session;
  }

  async function deleteSession(sessionId) {
    sessions.delete(sessionId);
    await saveSessions();
  }

  return { sessions, createSession, getSession, deleteSession, loadSessions };
}
```

然后在 index.js 中：
- 用 `const { sessions, createSession, getSession, deleteSession, loadSessions } = createSessionManager(WORKSPACE_DIR);` 替换原来的直接创建
- 在启动时调用 `await loadSessions();`
- 所有引用 `sessions` 映射的地方改用返回的 `sessions`
- 替代原来的 `sessions.delete()` 调用改为 `deleteSession()`
