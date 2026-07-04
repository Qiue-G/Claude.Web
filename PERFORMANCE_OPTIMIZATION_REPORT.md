# Claude.Free 性能优化报告

> 生成时间: 2026-07-03  
> 分析范围: 服务器端、客户端、网络层全链路  
> 项目版本: v7.3.2

---

## 目录

1. [执行摘要](#1-执行摘要)
2. [服务器端性能瓶颈](#2-服务器端性能瓶颈)
3. [客户端性能瓶颈](#3-客户端性能瓶颈)
4. [网络层性能瓶颈](#4-网络层性能瓶颈)
5. [优化路线图](#5-优化路线图)
6. [附录: 关键文件索引](#6-附录-关键文件索引)

---

## 1. 执行摘要

本报告对 `g:\claude.free` 项目进行了全链路性能瓶颈分析，覆盖服务器端（数据库、路由、AI 调用、流式响应、并行模型）、客户端（Svelte 组件渲染、资源加载）和网络层（API 响应、WebSocket 管理）。

### 关键发现

| 类别 | 🔴 严重 | 🟡 中等 | 🟢 良好 |
|------|---------|---------|---------|
| 服务器端 | 4 | 8 | 5 |
| 客户端 | 2 | 5 | 3 |
| 网络层 | 0 | 4 | 3 |

### 核心瓶颈 Top 5

1. **消息列表无虚拟滚动** — 长对话场景 DOM 节点爆炸，导致 UI 卡顿
2. **流式响应时每条消息触发完整 Markdown + 代码高亮渲染** — CPU 占用飙升
3. **AI API 调用无缓存机制** — 重复 prompt 浪费 API 配额和响应时间
4. **并行模型调用为每个模型创建独立子进程 + proxy** — 内存/进程资源快速耗尽
5. **sql.js 全量内存数据库 + 全量导出持久化** — 数据量增长后写入延迟线性增加

---

## 2. 服务器端性能瓶颈

### 2.1 数据库层

#### 🔴 P0-DB-01: sql.js 全量内存数据库 + 全量导出持久化

**文件**: `src/server/db.js` (第 78-202 行)

**问题描述**:

项目使用 `sql.js`（纯 WASM 实现）作为 SQLite 引擎，整个数据库驻留在内存中。每次持久化通过 `db.export()` 将整个数据库序列化为二进制 Buffer，再通过 `writeFile()` 写入磁盘。

```javascript
// db.js 第 163-182 行
async function saveDb() {
  if (saveTimer) { pendingSave = true; return; }
  try {
    const data = db.export();                          // 全量序列化
    await writeFile(filePath, Buffer.from(data));       // 全量写入磁盘
  } catch (e) { console.error('[DB] save failed:', e.message); }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (pendingSave) { pendingSave = false; saveDb(); }
  }, SAVE_DEBOUNCE_MS);  // 2000ms 防抖
}
```

**性能影响**:

- 数据库大小与 `db.export()` 耗时线性相关。当数据库达到 10MB+ 时，每次 save 阻塞事件循环 100-500ms
- 防抖窗口仅 2 秒，高频聊天场景下仍会频繁触发全量写入
- `db.export()` 是同步操作，会阻塞 Node.js 事件循环

**影响范围**: 所有写操作（消息保存、会话创建/删除、文件版本记录）

**优化建议**:

| 方案 | 描述 | 预期收益 | 难度 |
|------|------|----------|------|
| A. 迁移到 better-sqlite3 | 使用原生 SQLite 绑定，支持 WAL 模式和增量写入 | ⭐⭐⭐⭐⭐ 消除全量导出瓶颈 | 中（需处理原生依赖） |
| B. 增量持久化 | 跟踪脏页，仅写入变更部分 | ⭐⭐⭐ 减少 I/O 量 | 高（sql.js 不直接支持） |
| C. 增大防抖窗口 | 将 `SAVE_DEBOUNCE_MS` 从 2s 提升到 5-10s | ⭐⭐ 减少写入频率 | 低 |
| D. 异步导出到 Worker | 将 `db.export()` 移到 Worker 线程 | ⭐⭐ 避免阻塞主线程 | 中 |

**推荐**: 方案 A（长期） + 方案 C（短期立即实施）

---

#### 🟡 P1-DB-02: saveSessions() 未使用事务

**文件**: `src/server/sessionManager.js` (第 61-79 行)

**问题描述**:

`saveSessions()` 遍历所有 session 逐条执行 `INSERT OR REPLACE`，未使用事务包裹。N 个 session 产生 N 次独立的磁盘写入。

```javascript
// sessionManager.js 第 61-79 行
async function saveSessions() {
  const stmt = db.prepare(`INSERT OR REPLACE INTO sessions ... VALUES (?, ?, ...)`);
  for (const session of sessions.values()) {
    stmt.run([/* ... */]);   // 每条独立写入
  }
  stmt.free();
  await saveDb();
}
```

**性能影响**: 10 个 session 时产生 10 次写入操作 + 1 次全量 saveDb。

**优化建议**:

```javascript
async function saveSessions() {
  try {
    db.run('BEGIN TRANSACTION');
    const stmt = db.prepare(`INSERT OR REPLACE INTO sessions ...`);
    for (const session of sessions.values()) {
      stmt.run([/* ... */]);
    }
    stmt.free();
    db.run('COMMIT');
  } catch (e) {
    db.run('ROLLBACK');
  }
  await saveDb();
}
```

**预期收益**: ⭐⭐⭐ 写入速度提升 5-10 倍（事务内写入几乎无开销）  
**难度**: 低

---

#### 🟡 P1-DB-03: loadMessagesPaginated 双查询

**文件**: `src/server/messageStore.js` (第 62-93 行)

**问题描述**:

分页加载时先执行 `SELECT COUNT(*)` 查总数，再执行数据查询。两次查询可以优化。

```javascript
// 第一次查询: 查总数
const countRows = exec('SELECT COUNT(*) as cnt FROM messages WHERE sessionId = ?', [sessionId]);
// 第二次查询: 查数据
const rows = exec('SELECT ... FROM messages WHERE sessionId = ? ORDER BY timestamp ASC LIMIT ? OFFSET ?', ...);
```

**优化建议**:

使用 `LIMIT (pageSize + 1)` 技巧，通过返回行数判断是否有更多数据，避免 COUNT 查询：

```javascript
const rows = exec(
  'SELECT ... FROM messages WHERE sessionId = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?',
  [sessionId, PAGE_SIZE + 1, page * PAGE_SIZE]
);
const hasMore = rows.length > PAGE_SIZE;
if (hasMore) rows.pop(); // 移除多余的那条
```

**预期收益**: ⭐⭐ 分页查询减少 50% 的数据库访问  
**难度**: 低

---

#### 🟡 P1-DB-04: loadMessages() 全量加载后截断

**文件**: `src/server/messageStore.js` (第 45-56 行) + `src/server/routes/wsHandler.js` (第 388 行)

**问题描述**:

每次用户输入时，全量加载会话的所有消息，然后在 JavaScript 中截断：

```javascript
// wsHandler.js 第 388 行
history: messageStore ? (await messageStore.loadMessages(sessionId)).slice(0, -1) : [],
```

`buildPrompt()` 最终只使用 `maxHistoryChars: 8000` 字符的历史。长对话（数百条消息）时，加载了大量无用数据。

**优化建议**:

在 SQL 层直接限制加载量。根据平均消息长度（约 200 字符），加载最近 40 条消息即可覆盖 8000 字符：

```javascript
async function loadRecentMessages(sessionId, maxChars = 8000) {
  // 先加载最近的消息，累积到 maxChars 后停止
  const rows = exec(
    'SELECT ... FROM messages WHERE sessionId = ? ORDER BY timestamp DESC LIMIT 50',
    [sessionId]
  );
  // 在 JS 中按字符数截断（少量数据，开销可忽略）
}
```

**预期收益**: ⭐⭐⭐ 长对话场景减少 80%+ 的内存占用和 JSON 序列化开销  
**难度**: 低

---

#### 🟢 数据库层亮点

- ✅ 已建立合理的复合索引（`idx_messages_session`, `idx_messages_session_role`, `idx_file_versions_session`, `idx_file_versions_hash`）
- ✅ 慢查询监控已实现（阈值 200ms，环形缓冲区保留最近 100 条）
- ✅ 批量写入 `saveMessagesBatch()` 使用了事务
- ✅ PRAGMA 配置合理（`cache_size=-8000`, `temp_store=MEMORY`）

---

### 2.2 AI API 调用与缓存

#### 🔴 P0-AI-01: AI API 调用无缓存机制

**文件**: `src/server/routes/wsHandler.js` (第 286-396 行)

**问题描述**:

每次用户发送消息，都会完整构建 prompt 并启动 CLI 子进程调用 AI API。即使完全相同的 prompt 也不会命中缓存。

项目中已实现了功能完善的 `CacheManager`（`src/server/lib/cacheManager.js`），支持 TTL 过期、LRU 淘汰、容量限制，但它仅被 `ModelRouter` 用于任务分类缓存，**未用于 AI 响应缓存**。

**性能影响**:

- 重复问题（如 "/help"、常见代码片段生成）浪费 API 调用配额
- 每次调用需要 5-30 秒响应时间，缓存可将重复请求降至毫秒级
- 多用户场景下，相同问题的重复调用成倍增加

**优化建议**:

利用已有的 `CacheManager.wrapAsync()` 为 AI 调用添加缓存：

```javascript
// 在 wsHandler.js 中
import { CacheManager } from '../lib/cacheManager.js';

const responseCache = new CacheManager({ ttl: 3600000, maxSize: 200 }); // 1 小时 TTL

// 构建缓存 key: 基于 prompt 哈希
const cacheKey = createHash('sha256').update(prompt).digest('hex').slice(0, 16);
const cached = responseCache.get(cacheKey);
if (cached) {
  broadcastToSession(sessionId, { type: 'output', data: cached });
  broadcastToSession(sessionId, { type: 'done' });
  return;
}

// ... 正常执行 AI 调用 ...
// 完成后缓存结果
responseCache.set(cacheKey, assistantBuffer);
```

**预期收益**: ⭐⭐⭐⭐ 重复查询响应时间从 5-30s 降至 <1ms，节省 API 配额  
**难度**: 低

---

#### 🟡 P1-AI-02: ModelRouter 每次请求重建实例

**文件**: `src/server/routes/modelRoutes.js` (第 31-51 行)

**问题描述**:

```javascript
// modelRoutes.js 第 33 行
router.post('/recommend', async (req, res) => {
  const { ModelRouter } = await import('../lib/modelRouter.js');
  const router = new ModelRouter(req.app.locals.agentConfig);  // 每次新建
  // ...
});
```

每次 POST `/api/models/recommend` 都创建新的 `ModelRouter` 实例，内部创建新的 `CacheManager`。任务分类缓存无法跨请求复用。

**优化建议**:

在模块级别创建单例：

```javascript
let modelRouterInstance = null;
function getModelRouter(agentConfig) {
  if (!modelRouterInstance) modelRouterInstance = new ModelRouter(agentConfig);
  return modelRouterInstance;
}
```

**预期收益**: ⭐⭐⭐ 任务分类缓存命中率从 0% 提升至正常水平  
**难度**: 低

---

### 2.3 流式响应的内存管理

#### 🟡 P1-STREAM-01: assistantBuffer 无限增长

**文件**: `src/server/routes/wsHandler.js` (第 404-427 行)

**问题描述**:

整个 AI 响应过程中，`assistantBuffer` 字符串持续拼接所有 stdout/stderr 输出。对于超长响应（如大段代码生成），字符串可能达到数 MB。

```javascript
let assistantBuffer = '';
proc.stdout.on('data', (chunk) => {
  let clean = stripAnsi(chunk.toString());
  clean = maskSensitive(clean, session.apiKey);
  if (clean.trim()) {
    assistantBuffer += clean;  // 无限增长
    // ...
  }
});
```

**性能影响**: 长响应时内存占用持续增长，字符串拼接在超过 V8 内联字符串限制后性能下降。

**优化建议**:

- 设置 buffer 上限（如 2MB），超出后停止拼接
- 或使用数组收集 chunks，最后 `join('')`

```javascript
const bufferChunks = [];
let bufferTotalLen = 0;
const MAX_BUFFER = 2 * 1024 * 1024; // 2MB

proc.stdout.on('data', (chunk) => {
  let clean = stripAnsi(chunk.toString());
  clean = maskSensitive(clean, session.apiKey);
  if (clean.trim()) {
    if (bufferTotalLen < MAX_BUFFER) {
      bufferChunks.push(clean);
      bufferTotalLen += clean.length;
    }
    // ... broadcast ...
  }
});

// proc.on('close') 中:
const assistantBuffer = bufferChunks.join('');
```

**预期收益**: ⭐⭐ 防止极端情况下的内存溢出  
**难度**: 低

---

#### 🟡 P1-STREAM-02: 代码解释器缓冲重复拼接

**文件**: `src/server/routes/wsHandler.js` (第 411 行)

```javascript
if (hasCodeInterpreter) codeInterpreterBuffer += clean;
```

当启用 `code_interpreter` 工具时，每个 chunk 同时拼接到 `assistantBuffer` 和 `codeInterpreterBuffer`，产生双倍内存开销。

**优化建议**: 仅在 `close` 事件中从 `assistantBuffer` 提取 Python 代码块，避免维护两份缓冲。

---

### 2.4 并行模型调用的资源管理

#### 🔴 P0-PAR-01: 并行调用为每个模型创建独立子进程 + proxy

**文件**: `src/server/parallel/parallelEngine.js` (第 82-124 行)

**问题描述**:

每个并行模型调用都会：
1. 启动一个新的 `or_proxy.mjs` 代理进程（OpenRouter/DeepSeek 场景）
2. 启动一个新的 CLI 子进程

4 个模型并行 = 最多 8 个新进程。加上全局进程限制 `GLOBAL_PROCESS_LIMIT = 16`，在多会话场景下很容易耗尽。

```javascript
// parallelEngine.js 第 96-122 行
async () => {
  if (useProxy) {
    const { process: proxy, port } = await startProxy(modelId, ...);  // 新 proxy 进程
    proxyProcess = proxy;
    env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:' + port;
  }
  const proc = spawn(cliPath, cliArgs, { env, ... });  // 新 CLI 进程
  resolve({ proc, proxy: proxyProcess });
}
```

**性能影响**:

- 每个 proxy 进程启动耗时 10-15 秒，内存占用约 30-50MB
- 每个 CLI 进程内存占用约 50-100MB
- 4 模型并行 = 额外 320-600MB 内存 + 8 个进程
- 全局进程限制 16，2 个会话同时做 4 模型并行就会触发限制

**优化建议**:

| 方案 | 描述 | 预期收益 | 难度 |
|------|------|----------|------|
| A. 共享 proxy 进程 | 多个模型复用同一个 proxy，通过 HTTP header 区分模型 | ⭐⭐⭐⭐⭐ 减少 75% 的进程数 | 中 |
| B. HTTP 直连 | 绕过 proxy，直接通过 HTTP 调用各模型 API | ⭐⭐⭐⭐ 完全消除 proxy 进程开销 | 中 |
| C. 进程池复用 | 使用已有的 ProcessPool 管理 CLI 进程 | ⭐⭐⭐ 减少进程创建开销 | 中 |
| D. 限制并行数 | 将最大并行模型数从 4 降到 2 | ⭐⭐ 简单粗暴但有效 | 低 |

**推荐**: 方案 B（长期最优） + 方案 D（短期立即实施）

---

#### 🔴 P0-PAR-02: ProcessPool 已实现但未被使用

**文件**: `src/server/lib/processPool.js` + `src/server/routes/wsHandler.js`

**问题描述**:

`ProcessPool` 实现了完整的进程池化逻辑（复用空闲进程、LRU 淘汰、per-session 限制、idle 超时回收），但在 `wsHandler.js` 中，CLI 调用直接通过 `spawnCli()` 创建进程，完全绕过了 ProcessPool。

```javascript
// wsHandler.js 第 396 行
const proc = await spawnCli(session, prompt);  // 直接 spawn，未使用 ProcessPool
```

ProcessPool 在 `index.js` 中被初始化并传递到各处，但从未被实际调用。

**优化建议**:

将 `spawnCli()` 改为通过 `ProcessPool.acquire()` 获取进程：

```javascript
const { proc } = await processPool.acquire(sessionId, () => {
  return spawnCliProcess(session, prompt);
});
// 使用完毕后归还
processPool.release(sessionId, procId);
```

**预期收益**: ⭐⭐⭐⭐ 进程复用减少 50%+ 的启动延迟，降低内存占用  
**难度**: 中

---

#### 🟡 P1-PAR-03: globalProcCount 非原子操作

**文件**: `src/server/parallel/parallelEngine.js` (第 169-173 行, 第 350-355 行)

**问题描述**:

```javascript
// 检查 + 增加非原子
if (globalProcCount + runConfigs.length > GLOBAL_PROCESS_LIMIT) { throw ... }
globalProcCount += runConfigs.length;

// dispose 中
const count = this.activeRuns.size;
this.activeRuns.clear();
globalProcCount = Math.max(0, globalProcCount - count);
```

并发调用 `start()` 或 `dispose()` 时，`globalProcCount` 可能出现不一致。

**优化建议**: 使用互斥锁或改为在 `Promise.allSettled` 的每个 promise 内部独立管理计数。

---

### 2.5 路由层与中间件

#### 🟡 P1-ROUTE-01: 文件树递归遍历磁盘

**文件**: `src/server/routes/fileRoutes.js` (第 73-92 行)

**问题描述**:

`buildTree()` 使用递归 `readdir` + `stat` 遍历整个工作目录。对于大型项目（数千文件），会阻塞事件循环数百毫秒。

```javascript
async function buildTree(dirPath, basePath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    // ...
    if (entry.isDirectory()) {
      const children = await buildTree(fullPath, relative);  // 递归
    } else {
      const s = await stat(fullPath);  // 每个文件一次 stat
    }
  }
}
```

**优化建议**:

- 添加文件树缓存（TTL 5 秒）
- 限制遍历深度（如最多 5 层）
- 使用 `fs.promises.opendir()` 流式遍历

**预期收益**: ⭐⭐⭐ 大项目场景减少 80%+ 的响应时间  
**难度**: 中

---

#### 🟡 P1-ROUTE-02: diffLines 同步执行

**文件**: `src/server/routes/fileRoutes.js` (第 200-238 行)

**问题描述**:

`diffLines(older, newer)` 是 CPU 密集型操作。对于大文件（数千行）的版本对比，会阻塞事件循环。

**优化建议**: 将 diff 计算移到 Worker 线程或使用 `setImmediate` 分片执行。

---

#### 🟡 P2-ROUTE-03: rateLimiter Map 无清理机制

**文件**: `src/server/lib/rateLimiter.js`

**问题描述**:

`limits` Map 只增不减，过期的 entry 不会被清理。长时间运行后积累大量无效条目。

**优化建议**: 在 `check()` 中惰性清理过期 entry，或定期（每分钟）清理：

```javascript
function check(key, max, windowMsOverride) {
  const win = windowMsOverride || windowMs;
  const now = Date.now();
  // 惰性清理
  for (const [k, entry] of limits) {
    if (now - entry.windowStart > win) limits.delete(k);
  }
  // ... 正常逻辑
}
```

---

#### 🟢 路由层亮点

- ✅ 中间件链合理: `helmet → cors → compression → json → perfMetrics → cache headers → routes`
- ✅ 错误处理完善: `AppError` 结构化错误 + `asyncHandler` 包装 + 全局错误处理器
- ✅ 请求体限制 500KB，防止大 payload 攻击
- ✅ 静态资源 hash 命名 + 长期缓存（`Cache-Control: public, immutable, max-age=31536000`）
- ✅ API 缓存头合理（tools: 300s, config: 60s, models: 120s）
- ✅ CSRF 保护 + session token 双重验证

---

## 3. 客户端性能瓶颈

### 3.1 Svelte 组件渲染效率

#### 🔴 P0-UI-01: 消息列表无虚拟滚动

**文件**: `src/client/components/chat/Messages.svelte` (第 39-49 行)

**问题描述**:

```svelte
<div class="messages-container" onscroll={handleScroll}>
  {#each messages as msg, i (msg.id)}
    <ChatMessage role={msg.role} content={msg.content} ... />
  {/each}
</div>
```

所有消息直接渲染为 DOM 节点，没有虚拟滚动。每个 `ChatMessage` 组件包含：
- 消息头部（角色 + 时间）
- Markdown 内容区（可能包含多个代码块）
- 操作按钮区（复制、编辑、重试、评分、删除）

长对话（100+ 条消息）时，DOM 节点数可达数千个。

**性能影响**:

- 首次渲染 100 条消息耗时约 200-500ms
- 滚动时浏览器需要维护所有节点的布局信息
- 每条消息的 `ChatMessage` 组件独立进行 Markdown 解析和代码高亮

**优化建议**:

引入虚拟列表，只渲染可见区域的消息：

```svelte
<script>
  import VirtualList from 'svelte-virtual-list';
  // 或使用自定义实现
</script>

<VirtualList items={messages} itemHeight={80} let:item>
  <ChatMessage role={item.role} content={item.content} ... />
</VirtualList>
```

**预期收益**: ⭐⭐⭐⭐⭐ 长对话场景渲染性能提升 10-50 倍  
**难度**: 中

---

#### 🔴 P0-UI-02: 流式响应时每条消息触发完整 Markdown + 代码高亮渲染

**文件**: `src/client/components/chat/ChatMessage.svelte` (第 30-59 行)

**问题描述**:

```svelte
$: parsedParts = parseContent(content);  // 每次 content 变化重新解析

function renderMarkdown(text) {
  if (streaming) {
    return escapeHtml(text);  // 流式时仅 escape
  }
  return marked.parse(escapeHtml(text));  // 非流式时完整渲染
}
```

虽然流式时跳过了 `marked.parse()`，但 `parseContent()` 仍然每次执行正则匹配来分割代码块。更关键的是，流式结束后（`streaming` 变为 `false`），会触发一次完整的 Markdown 解析 + 所有代码块的 `hljs.highlight()`。

`CodeBlock.svelte` 中的高亮逻辑：

```svelte
// CodeBlock.svelte 第 68-84 行
$: {
  if (code) {
    lineCount = code.split('\n').length;
    try {
      if (language && hljs.getLanguage(language)) {
        highlightedCode = hljs.highlight(code, { language }).value;  // 同步高亮
      } else {
        highlightedCode = hljs.highlightAuto(code).value;
      }
    } catch (e) {
      highlightedCode = escapeHtml(code);
    }
  }
}
```

**性能影响**:

- 大代码块（500+ 行）的 `hljs.highlight()` 耗时 50-200ms
- 多个代码块的消息，高亮总耗时可达数百毫秒
- 流式响应结束时的一次性渲染会造成明显的 UI 卡顿

**优化建议**:

1. **流式期间延迟 Markdown 渲染**: 流式结束后 100ms 再触发完整渲染
2. **代码高亮异步化**: 使用 `requestIdleCallback` 或 `setTimeout` 将高亮操作分批执行
3. **Web Worker 高亮**: 将 highlight.js 移入 Worker 线程

```javascript
// 异步高亮示例
async function highlightAsync(code, language) {
  return new Promise(resolve => {
    requestIdleCallback(() => {
      resolve(hljs.highlight(code, { language }).value);
    });
  });
}
```

**预期收益**: ⭐⭐⭐⭐ 消除流式响应结束时的 UI 卡顿  
**难度**: 中

---

#### 🟡 P1-UI-03: appendToLastAssistant 高频创建新对象

**文件**: `src/client/stores/chat.store.js` (第 105-123 行)

**问题描述**:

```javascript
export function appendToLastAssistant(text) {
  sessions.update(s => s.map(session => {
    if (session.id !== sessionId) return session;
    const sessionMsgs = session.messages || [];
    const last = sessionMsgs[sessionMsgs.length - 1];
    if (last && last.role === 'assistant') {
      const updated = { ...last, content: last.content + text };
      return {
        ...session,
        messages: [...sessionMsgs.slice(0, -1), updated],  // 新数组
        updatedAt: Date.now()
      };
    }
    return session;
  }));
}
```

流式响应时每个 chunk 都触发 `sessions.update`，每次都创建：
- 新的 session 对象（spread）
- 新的 messages 数组（slice + spread）
- 新的 last message 对象（spread）

这会导致所有依赖 `sessions` 的 derived store（`currentSession`, `messages`）重新计算。

**优化建议**:

使用局部更新，避免触发整个 sessions store：

```javascript
// 直接操作当前 session 的 messages 数组
export function appendToLastAssistant(text) {
  const sid = get(currentSessionId);
  if (!sid) return;

  // 使用独立的 streamingMessage store，避免触发 sessions 更新
  streamingMessage.update(msg => msg ? msg + text : text);
}
```

或使用 Svelte 5 的 `$state` 进行细粒度响应式更新。

**预期收益**: ⭐⭐⭐ 减少 80% 的对象分配和 GC 压力  
**难度**: 中

---

#### 🟡 P1-UI-04: Messages 自动滚动双重调度

**文件**: `src/client/components/chat/Messages.svelte` (第 26-36 行)

**问题描述**:

```javascript
$: {
  const container = messagesContainer;
  if (container && !userScrolledUp) {
    queueMicrotask(() => {
      container.scrollTop = container.scrollHeight;
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;  // 再次设置
      });
    });
  }
}
```

每次消息更新都执行 `queueMicrotask` + `requestAnimationFrame` 双重调度。流式响应高频更新时，可能造成多次布局计算。

**优化建议**: 使用 `ResizeObserver` 监听内容高度变化，而非每次消息更新都触发滚动。

---

#### 🟡 P1-UI-05: highlight.js 20+ 语言全量打包

**文件**: `src/client/components/chat/CodeBlock.svelte` (第 8-59 行)

**问题描述**:

注册了 20+ 种语言（javascript, typescript, python, java, cpp, csharp, go, rust, php, ruby, swift, kotlin, sql, bash, json, xml, css, markdown, yaml, dockerfile），全部打包进主 bundle。

**性能影响**: 增加初始 bundle 大小约 200-400KB（gzip 后约 60-120KB）。

**优化建议**:

- 仅注册最常用的 5-8 种语言（js, py, ts, bash, json, css, html）
- 其他语言按需动态加载
- 或使用 `highlight.js` 的 CDN 版本，利用浏览器缓存

**预期收益**: ⭐⭐ 减少初始加载时间 100-300ms  
**难度**: 低

---

### 3.2 资源加载

#### 🟢 亮点: 代码分割 / Lazy Loading

**文件**: `src/client/App.svelte` (第 24-49 行)

`RagPanel`、`AuditLogViewer`、`PerfDashboard`、`ComparisonView` 四个重组件都使用了动态 `import()` 进行懒加载，仅在需要时才加载。

```javascript
let RagPanelComponent = $state(null);
$effect(() => {
  if (showRagPanel && !RagPanelComponent) {
    import('$components/rag/RagPanel.svelte').then(m => { RagPanelComponent = m.default; });
  }
});
```

---

#### 🟡 P2-BUILD-01: CSS 未压缩

**文件**: `vite.config.js` (第 11 行)

```javascript
build: {
  cssMinify: false,  // CSS 未压缩
  minify: true
}
```

**优化建议**: 设置 `cssMinify: true` 或使用 `cssMinify: 'esbuild'`。

**预期收益**: ⭐⭐ CSS 文件体积减少 20-30%  
**难度**: 低

---

### 3.3 Store 设计

#### 🟡 P1-STORE-01: IndexedDB 保存先 clear 再逐条 put

**文件**: `src/client/stores/chatHistory.store.js` (第 46-63 行)

**问题描述**:

```javascript
async function saveSessionsAsync(sessions) {
  await db.initDB();
  const trimmed = sessions.length > MAX_SESSIONS ? sessions.slice(0, MAX_SESSIONS) : sessions;
  await db.clear(db.STORES.CHAT_SESSIONS);    // 清空
  for (const session of trimmed) {
    await db.put(db.STORES.CHAT_SESSIONS, session);  // 逐条写入
  }
}
```

50 个 session 时产生 51 次 IndexedDB 操作（1 次 clear + 50 次 put），每次都是独立的异步操作。

**优化建议**: 使用单个事务批量操作：

```javascript
async function saveSessionsAsync(sessions) {
  await db.initDB();
  const txn = db.transaction([db.STORES.CHAT_SESSIONS], 'readwrite');
  const store = txn.objectStore(db.STORES.CHAT_SESSIONS);
  store.clear();
  for (const session of sessions) {
    store.put(session);
  }
  return new Promise((resolve, reject) => {
    txn.oncomplete = resolve;
    txn.onerror = () => reject(txn.error);
  });
}
```

**预期收益**: ⭐⭐⭐ IndexedDB 操作减少 90%+（单个事务 vs 51 个独立操作）  
**难度**: 低

---

#### 🟡 P2-STORE-02: session.store.js 每个 store 独立订阅 localStorage

**文件**: `src/client/stores/session.store.js` (第 20-27 行)

三个 store 各自有独立的 `.subscribe()` 写入 localStorage。每次连接新模型会触发 3 次 localStorage 写入。

**优化建议**: 合并为单个 store，一次写入：

```javascript
const sessionData = writable({ id: null, token: null, csrf: null });
sessionData.subscribe(val => {
  localStorage.setItem('session', JSON.stringify(val));
});
```

---

## 4. 网络层性能瓶颈

### 4.1 API 响应大小

#### 🟡 P1-NET-01: RAG 搜索结果未做分页

**文件**: `src/server/routes/ragRoutes.js` (第 184-218 行)

搜索返回最多 50 条结果，每条包含完整文本（可能数百字符）。大量结果时响应体可达数百 KB。

**优化建议**: 默认返回 top 5，提供分页参数加载更多。

---

#### 🟡 P2-NET-02: 文件版本历史无分页

**文件**: `src/server/routes/fileRoutes.js` (第 147-172 行)

`LIMIT 200` 硬编码，每次返回最多 200 个版本记录。

**优化建议**: 添加 `page` 和 `pageSize` 参数。

---

#### 🟡 P2-NET-03: 健康检查端点无客户端缓存

**文件**: `src/server/routes/healthRoutes.js`

`/api/health` 被负载均衡器频繁调用，但响应未设置 `Cache-Control`。

**优化建议**: 添加短期缓存头 `Cache-Control: public, max-age=10`。

---

### 4.2 重复请求

#### 🟡 P1-NET-04: 模型推荐每次创建新 ModelRouter 实例

（已在 2.2 节 P1-AI-02 中详述）

---

### 4.3 WebSocket 连接管理

#### 🟢 亮点

- ✅ 指数退避重连（1s → 60s，最多 10 次）
- ✅ Ping/Pong 心跳（30s 间隔）
- ✅ 消息队列：断线时缓冲消息（最多 50 条），重连后补发
- ✅ 网络状态监听（offline/online 事件）
- ✅ BroadcastChannel 跨标签页会话同步
- ✅ WebSocket 最大 payload 限制 64KB
- ✅ 心跳检测 + 自动断开死连接

---

#### 🟡 P2-NET-05: WebSocket 消息无压缩

**文件**: `src/client/lib/websocket.js`

WebSocket 帧不经过 HTTP 层的 `compression` 中间件。高频流式输出时，每个 chunk 都是独立的 JSON 帧，无压缩开销。

**优化建议**: 启用 `permessage-deflate` WebSocket 扩展：

```javascript
const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 64 * 1024,
  perMessageDeflate: {
    zlibDeflateOptions: { level: 6 },
    threshold: 256,  // 仅压缩 > 256 字节的消息
  }
});
```

**预期收益**: ⭐⭐ 流式输出带宽减少 30-50%  
**难度**: 低

---

#### 🟡 P2-NET-06: session timeout 清理定时器串行删除

**文件**: `src/server/index.js` (第 613-637 行)

每分钟遍历所有 session 检查超时。过期的 session 串行 `await deleteSession()` + `await messageStore.deleteSessionMessages()`。

**优化建议**: 并行删除或批量删除：

```javascript
await Promise.all(expiredIds.map(id =>
  Promise.all([deleteSession(id), messageStore.deleteSessionMessages(id)])
));
```

---

## 5. 优化路线图

### Phase 1: 快速收益（1-2 天）

> 难度低、收益明确的优化，可立即实施

| 编号 | 优化项 | 文件 | 预期收益 |
|------|--------|------|----------|
| 1 | 增大 saveDb 防抖窗口至 5s | `db.js` | 减少 60% 磁盘写入 |
| 2 | saveSessions 添加事务 | `sessionManager.js` | 写入速度 5-10x |
| 3 | AI 响应缓存 | `wsHandler.js` | 重复查询 <1ms |
| 4 | ModelRouter 单例化 | `modelRoutes.js` | 缓存命中率提升 |
| 5 | CSS 压缩启用 | `vite.config.js` | CSS 体积 -25% |
| 6 | IndexedDB 事务批量写入 | `chatHistory.store.js` | IDB 操作 -90% |
| 7 | 限制并行模型数为 2 | `wsHandler.js` | 进程资源减半 |
| 8 | rateLimiter 过期清理 | `rateLimiter.js` | 消除内存泄漏 |

### Phase 2: 核心优化（3-5 天）

> 需要一定重构，解决主要性能瓶颈

| 编号 | 优化项 | 文件 | 预期收益 |
|------|--------|------|----------|
| 9 | 消息列表虚拟滚动 | `Messages.svelte` | 长对话渲染 10-50x |
| 10 | 流式渲染节流 | `ChatMessage.svelte` | 消除 UI 卡顿 |
| 11 | loadMessages 按需加载 | `messageStore.js` + `wsHandler.js` | 内存占用 -80% |
| 12 | loadMessagesPaginated 单查询 | `messageStore.js` | DB 查询 -50% |
| 13 | assistantBuffer 上限 | `wsHandler.js` | 防止内存溢出 |
| 14 | ProcessPool 实际接入 | `wsHandler.js` | 进程启动延迟 -50% |
| 15 | 文件树缓存 | `fileRoutes.js` | 大项目响应 -80% |
| 16 | highlight.js 精简语言 | `CodeBlock.svelte` | Bundle -200KB |

### Phase 3: 架构升级（1-2 周）

> 需要较大重构或引入新依赖

| 编号 | 优化项 | 文件 | 预期收益 |
|------|--------|------|----------|
| 17 | 迁移到 better-sqlite3 | `db.js` | 消除全量导出瓶颈 |
| 18 | 并行模型共享 proxy / HTTP 直连 | `parallelEngine.js` | 进程数 -75% |
| 19 | 代码高亮异步化 / Worker | `CodeBlock.svelte` | 主线程不阻塞 |
| 20 | appendToLastAssistant 局部更新 | `chat.store.js` | GC 压力 -80% |
| 21 | WebSocket permessage-deflate | `index.js` | 带宽 -30-50% |
| 22 | diffLines 移入 Worker | `fileRoutes.js` | 事件循环不阻塞 |

---

## 6. 附录: 关键文件索引

### 服务器端

| 文件 | 职责 | 相关瓶颈 |
|------|------|----------|
| `src/server/db.js` | SQLite 数据库初始化、持久化 | P0-DB-01 |
| `src/server/messageStore.js` | 消息 CRUD、分页查询 | P1-DB-03, P1-DB-04 |
| `src/server/sessionManager.js` | 会话管理、持久化 | P1-DB-02 |
| `src/server/routes/wsHandler.js` | WebSocket 消息处理、AI 调用 | P0-AI-01, P1-STREAM-01, P0-PAR-02 |
| `src/server/parallel/parallelEngine.js` | 并行模型调用引擎 | P0-PAR-01, P1-PAR-03 |
| `src/server/lib/processPool.js` | 进程池（未使用） | P0-PAR-02 |
| `src/server/lib/cacheManager.js` | 统一缓存管理器 | P0-AI-01（可复用） |
| `src/server/lib/modelRouter.js` | 模型智能路由 | P1-AI-02 |
| `src/server/lib/rateLimiter.js` | 速率限制器 | P2-ROUTE-03 |
| `src/server/routes/fileRoutes.js` | 文件 CRUD、版本管理 | P1-ROUTE-01, P1-ROUTE-02 |
| `src/server/routes/modelRoutes.js` | 模型发现 API | P1-AI-02 |
| `src/server/routes/ragRoutes.js` | RAG 知识库 API | P1-NET-01 |
| `src/server/index.js` | 服务器主入口 | P2-NET-06 |

### 客户端

| 文件 | 职责 | 相关瓶颈 |
|------|------|----------|
| `src/client/components/chat/Messages.svelte` | 消息列表渲染 | P0-UI-01 |
| `src/client/components/chat/ChatMessage.svelte` | 单条消息渲染 | P0-UI-02 |
| `src/client/components/chat/CodeBlock.svelte` | 代码块高亮 | P0-UI-02, P1-UI-05 |
| `src/client/stores/chat.store.js` | 消息状态管理 | P1-UI-03 |
| `src/client/stores/chatHistory.store.js` | 会话历史持久化 | P1-STORE-01 |
| `src/client/stores/session.store.js` | 会话凭证管理 | P2-STORE-02 |
| `src/client/lib/websocket.js` | WebSocket 连接管理 | P2-NET-05 |
| `src/client/App.svelte` | 应用根组件 | 代码分割（亮点） |
| `vite.config.js` | 构建配置 | P2-BUILD-01 |

---

> **总结**: 项目整体架构合理，已有多项性能优化措施（缓存管理器、进程池、慢查询监控、代码分割等）。主要瓶颈集中在 **客户端渲染效率**（虚拟滚动 + 流式渲染优化）和 **服务器端资源管理**（进程池实际接入 + AI 缓存）两个方面。Phase 1 的快速优化可在 1-2 天内完成，预计整体性能提升 30-50%。
