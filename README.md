# ClaudeFree -- 免费 Claude Code Web 接入

通过浏览器在 OpenRouter、DeepSeek 等 OpenAI 兼容 Provider 上使用 Claude Code 的全部能力,免费、自托管、一键部署。

---

## 架构总览

```
浏览器 (Svelte 5 + Vite)
  │                        │
  │ WebSocket /ws          │ REST /api/*
  ▼                        ▼
┌─────────────────────────────────────────────┐
│               Express 服务端                 │
│                                             │
│  bootstrap.js ── 统一依赖注入入口             │
│    ├── db          SQLite (sql.js)           │
│    ├── sessionManager   会话生命周期          │
│    ├── messageStore      消息持久化           │
│    ├── mcpManager        MCP 工具接入         │
│    ├── rag             RAG 知识库引擎         │
│    ├── processPool       进程池 (E3)          │
│    ├── perfMetrics       性能监控             │
│    └── auditLog          审计日志             │
│                                             │
│  routes/ -- 11 个路由模块 + wsHandler         │
│  tools/  -- 代码解释器 / 文件工具 / 联网搜索   │
│  runtime/ -- prompt 构建 / hooks / filters    │
└─────────────────────────────────────────────┘
  │                    │
  │ spawn              │
  ▼                    ▼
┌──────────┐    ┌──────────────┐
│ or_proxy │    │ openai_proxy │
│  .mjs    │    │   .mjs       │
└──────────┘    └──────────────┘
  │                    │
  ▼                    ▼
OpenRouter / DeepSeek 等 OpenAI 兼容 Provider
```

## 快速开始

### 本地开发

```bash
npm install

# 复制并编辑模型配置
cp agent-config.json agent-config.local.json
# 修改 agent-config.json 中的 defaults.provider 和模型列表

# 必须设置安全环境变量
export JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
export ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# 启动 (需先 build 前端, 或另外开终端跑 npm run dev:client)
npm run build
node src/server/index.js
# 监听 http://localhost:3000
```

### Docker 部署

```bash
docker build -t claudefree .
docker run -p 3000:3000 \
  -e JWT_SECRET=<强随机字符串> \
  -e ENCRYPTION_KEY=<强随机字符串> \
  claudefree
```

Railway 会自动检测 `Dockerfile`,无需额外配置。

---

## 功能模块

### 会话管理

完整的会话生命周期:`创建 → WS 交互 → 持久化 → 超时清理`。支持多 Provider 动态切换,每个会话独立工作目录,会话间完全隔离。`bootstrap.js` 启动时自动恢复上次未完成的会话。

### 协议代理 -- `or_proxy.mjs` / `openai_proxy.mjs`

将 Anthropic 风格的 Messages API 请求翻译为 OpenAI Chat Completions 格式,支持主流 Provider (OpenRouter / DeepSeek / 任何 OpenAI 兼容端点)。

- 同模型最多重试 2 次 (指数退避 1s → 2s)
- 全部失败后自动切换 fallback 模型
- 错误友好化:返回 `code` + 中文 `zh_message`
- 支持流式 (`stream: true`) 和非流式
- 启动时校验 fallback 模型是否可用

### RAG 知识库引擎 (`src/rag/`)

完整的检索增强生成系统:

- **文档摄入**:支持文本、Markdown、PDF、Office (docx/xlsx/pptx)、CSV、JSON、Web 页面、REST API、代码文件
- **分块**:RecursiveCharacterTextSplitter,可配 chunk size / overlap
- **嵌入**:OpenAI 兼容 embedding API (默认 `text-embedding-3-small`, 256 维)
- **向量存储**:内存 (默认) + Qdrant 适配器
- **双通道检索**:BM25 (FTS5) + 向量相似度 → RRF 融合排序
- **API**:`POST /api/rag/ingest` / `GET /api/rag/search?q=...` / `DELETE /api/rag/collection/:name`

### MCP 工具接入 (`src/server/mcp/`)

通过 `@modelcontextprotocol/sdk` 连接外部 MCP stdio 服务器,自动发现工具并注入 AI 上下文。

在 `agent-config.json` 中声明 MCP 服务器:

```jsonc
{
  "mcpServers": [
    { "name": "my-tool", "command": "node", "args": ["path/to/server.js"] }
  ]
}
```

工具 ID 格式 `mcp_{serverName}_{toolName}`,前端 UI 中自动展示,AI 可直接调用。

### 并行模型调用 (`src/server/parallel/`)

将同一 prompt 同时发送给多个模型,独立运行,多路输出并行展示,支持单独中止任一模型。适合对比不同模型在同一个问题上的表现。

### 代码解释器 (`src/server/tools/`)

- 提取 AI 输出中的 Python 代码块并执行
- **Docker 沙箱模式**:代码在独立容器中运行,网络隔离
- **AST 安全检查**:静态扫描,拦截 `exec`/`eval`/`os.system`/`getattr`/`setattr` 等危险调用
- 可启用宽松模式 (permissive) 放行部分受限操作

### 文件管理

内置类 CodeBuddy 风格的文件工具,AI 可直接操作会话工作目录:

- `read_file` / `write_file` / `edit_file` / `glob` / `grep` / `list_files` / `delete_file` / `rename_file`
- `edit_file` 支持精确字符串替换 (old_string → new_string)
- 路径遍历防护,禁止访问工作目录外文件

### 协同编辑 (`src/server/collab/`)

基于 Yjs + y-websocket 的实时协同编辑,`activityLog` 记录协作活动。

### 用户认证 (`src/server/auth/`)

- JWT 认证 (8h 过期), bcrypt 密码哈希
- API Key 加密存储 (AES-256-GCM)
- 首次注册用户自动成为管理员
- 登录暴力破解防护 (IP 级失败计数,60s 封锁)
- 密码复杂度校验 (大小写字母+数字至少两类)

### 可扩展性

- **插件系统** (`src/server/runtime/hooksRunner.js`):在 `agent-config.json` 中声明插件,支持 `onUserPrompt` / `preToolUse` / `postToolUse` 三个阶段钩子,可匹配工具名称
- **过滤管道** (`src/server/runtime/filterPipeline.js`):流式输出过滤
- **Prompt 模板** (`src/server/runtime/promptBuilder.js`):从上游 free-code 提取静态提示词,支持系统提示词自定义

---

## 项目结构

```
Claude.Web/
├── src/
│   ├── server/                  # Express + WebSocket 服务端
│   │   ├── index.js             # 入口:进程/WS/生命周期/超时清理
│   │   ├── app.js               # Express 路由装配
│   │   ├── bootstrap.js         # 依赖注入:DB/RAG/MCP/限流/审计/进程池
│   │   ├── cliRunner.js         # spawn CLI / callModel 核心
│   │   ├── sessionManager.js    # 会话 CRUD (持久化到 SQLite)
│   │   ├── messageStore.js      # 消息持久化 (SQLite)
│   │   ├── db.js                # SQLite 初始化 + 表迁移
│   │   ├── routes/              # 11 个路由模块
│   │   │   ├── sessionRoutes.js     # 会话 CRUD
│   │   │   ├── modelRoutes.js       # 模型发现
│   │   │   ├── healthRoutes.js      # 健康检查
│   │   │   ├── configRoutes.js      # 配置 & 工具定义
│   │   │   ├── fileRoutes.js        # 文件读写 (路径遍历防护)
│   │   │   ├── ragRoutes.js         # RAG:摄入/搜索/删除
│   │   │   ├── searchRoutes.js      # 全文搜索
│   │   │   ├── adminRoutes.js       # 管理后台 (ADMIN_TOKEN)
│   │   │   ├── templateRoutes.js    # Prompt 模板
│   │   │   ├── versionRoutes.js     # 文件版本历史
│   │   │   ├── wsHandler.js         # WebSocket 生命周期
│   │   │   └── wsHandlers/
│   │   │       └── messageHandlers.js  # 消息处理 + 工具循环
│   │   ├── auth/                # JWT + bcrypt 用户体系
│   │   ├── tools/               # 代码解释器 / 文件工具 / 联网搜索
│   │   ├── mcp/                 # MCP Client Manager
│   │   ├── parallel/            # 并行模型引擎
│   │   ├── runtime/             # prompt 构建 / hooks / filters
│   │   ├── pipelines/           # 数据处理管道
│   │   ├── collab/              # Yjs 协同 + activityLog
│   │   └── lib/                 # 工具库:限流/日志/审计/性能/进程池
│   ├── rag/                     # RAG 知识库引擎
│   │   ├── chunker.js           # 递归分块
│   │   ├── embedder.js          # OpenAI 兼容嵌入
│   │   ├── retrieval.js         # 混合检索 (BM25 + 向量 + RRF)
│   │   ├── vectorStore.js       # 向量存储 (内存 + Qdrant 适配)
│   │   ├── extractors/          # 多格式文档提取 (PDF/Office/Web/CSV/代码)
│   │   └── loaders/             # 结构化数据加载 (CSV/JSON/图片)
│   ├── client/                  # Svelte 5 前端
│   │   ├── App.svelte           # 根组件
│   │   ├── stores/              # 17 个 Svelte stores
│   │   ├── components/          # 按功能分组的组件
│   │   │   ├── chat/            # 聊天界面 / 消息 / 输入 / Diff 卡片
│   │   │   ├── files/           # 文件浏览 & 编辑
│   │   │   ├── models/          # 模型选择 & 参数面板
│   │   │   ├── rag/             # 知识库管理 UI
│   │   │   ├── parallel/        # 并行模式界面
│   │   │   ├── editor/          # 代码/文档编辑器
│   │   │   ├── admin/           # 管理面板
│   │   │   └── common/          # 通用组件
│   │   ├── lib/                 # i18n / websocket 客户端 / 工具函数
│   │   └── apis/                # REST API 封装
│   └── cache/                   # 缓存层
├── public/                      # Vite build 产物 (gitignored)
├── scripts/                     # 构建脚本
│   ├── dump-static-prompts.ts   # 提取上游 free-code 提示词
│   ├── dump-tool-schemas.ts     # 提取上游工具定义
│   └── migrate-encrypt-api-keys.js  # API Key 加密迁移
├── test/                        # 30+ 测试文件 (node:test + Vitest)
├── docs/                        # 优化报告 & 参考文档
├── docker/                      # Docker 沙箱配置
├── or_proxy.mjs                 # Anthropic → OpenAI 协议代理
├── openai_proxy.mjs             # 通用 OpenAI 代理
├── cli-ops.mjs                  # 运维命令行工具
├── agent-config.json            # 模型 / Provider / MCP / 插件配置
├── Dockerfile                   # 生产镜像构建
├── docker-compose.yml           # 本地容器化部署
└── deploy.sh                    # 一键 Docker Compose 部署
```

---

## API 参考

### 会话管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/session` | 创建会话。Body: `{ apiKey, model?, provider?, systemPrompt? }` |
| `GET` | `/api/session/:id` | 查询会话信息 (需 `x-session-token`) |
| `DELETE` | `/api/session/:id` | 删除会话 (需 `x-session-token` + `x-csrf-token`) |

### 模型发现

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/models/:provider` | 列出 provider 下所有模型 (免费优先,含上下文长度) |
| `GET` | `/api/models?provider=openrouter` | 同上,查询参数方式 |

### 文件管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/files/:sessionId` | 列出会话文件树 |
| `GET` | `/api/files/:sessionId/*` | 读取文件内容 |
| `POST` | `/api/files/:sessionId/*` | 写入文件 (需 `x-csrf-token`) |
| `DELETE` | `/api/files/:sessionId/*` | 删除文件 (需 `x-csrf-token`) |

### 版本历史

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/versions/:sessionId/*` | 获取文件版本列表 |
| `GET` | `/api/versions/:sessionId/*?version=N` | 获取指定版本内容 |
| `POST` | `/api/versions/:sessionId/*/rollback` | 回滚到指定版本 |

### 搜索

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/search?q=...&sessionId=...` | FTS5 全文搜索会话消息 |

### RAG 知识库

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/rag/ingest` | 摄入文档 (文本/文件/URL/API) |
| `GET` | `/api/rag/search?q=...&collection=...` | 混合搜索 (BM25 + 向量 + RRF) |
| `DELETE` | `/api/rag/collection/:name` | 删除知识库集合 |

### 用户认证

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/auth/register` | 注册 (首次用户自动成为管理员) |
| `POST` | `/api/auth/login` | 登录,返回 JWT |
| `GET` | `/api/auth/me` | 获取当前用户 (需 `Authorization: Bearer <jwt>`) |

### 配置 & 健康

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/config` | 返回 Provider 列表、工具定义、MCP 工具、版本 |
| `GET` | `/api/tools` | 仅返回工具定义 (含 MCP 工具) |
| `GET` | `/api/health` | 基础健康:版本/会话数/运行时间 |
| `GET` | `/api/health/detailed` | 详细:每模型成功率、每会话状态、RAG 状态 (需 `ENABLE_DETAILED_HEALTH`) |
| `GET` | `/api/perf` | 性能指标快照 |

### 管理后台 (需 `x-admin-token`)

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/admin/sessions` | 所有活跃会话列表 |
| `DELETE` | `/api/admin/sessions/:id` | 强制终止会话 |
| `GET` | `/api/admin/models` | 模型统计 |
| `GET` | `/api/admin/audit` | 审计日志 |

### WebSocket

`ws://host:port/ws` -- 消息格式:

```json
{ "type": "input", "sessionId": "...", "token": "...", "data": "用户指令" }
```

服务端推送类型:`output` / `stderr` / `exit` (含 `code`) / `error` / `model_update` / `session_expired`

---

## `agent-config.json` -- 模型 & 集成配置

```jsonc
{
  "defaults": { "provider": "openrouter", "model": "google/gemini-2.0-flash-lite-001" },
  "providers": {
    "openrouter": {
      "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
      "fallbackModel": "google/gemini-2.0-flash-lite-001",
      "modelAliases": { "sonnet": "anthropic/claude-sonnet-4" },
      "models": [
        { "id": "...", "name": "...", "tier": "free", "context": 128000 }
      ]
    }
  },
  "mcpServers": [
    { "name": "example", "command": "node", "args": ["server.js"] }
  ],
  "plugins": {
    "my-plugin": {
      "enabled": true,
      "hooks": {
        "onUserPrompt": { "instruction": "额外的上下文提示..." },
        "postToolUse": { "matcher": "write_file", "instruction": "写文件后自动执行的指令..." }
      }
    }
  }
}
```

修改后无需重写代码,重启服务即生效。

---

## 会话流程

```
1. POST /api/session    →   获取 sessionId + token + csrfToken
2. ws://host:port/ws    →   发送 { type:"input", sessionId, token, data:"提示词" }
3. 服务端构建 prompt → spawn or_proxy → 调用 LLM → 实时推送 output
4. AI 工具调用循环 (最多 10 轮):代码执行 / 文件操作 / 联网搜索 / RAG / MCP
5. 完成后接收 { type:"exit", code }
6. DELETE /api/session/:id   →   清理进程 + 工作目录
```

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | HTTP 服务端口 |
| `HOST` | `0.0.0.0` | 绑定地址 |
| `WORKSPACE_DIR` | `./workspace` | 会话工作目录 (自动创建) |
| `MAX_SESSIONS` | `10` | 最大并发会话数 |
| `SESSION_TIMEOUT` | `3600000` | 会话超时 (ms,默认 1 小时) |
| `FREE_CODE_DIR` | `./` (Linux: `/free-code`) | CLI 和代理脚本目录 |
| `AGENT_CONFIG_PATH` | `agent-config.json` | 模型配置文件路径 |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | 逗号分隔 CORS 白名单 |
| `JWT_SECRET` | **必填** | JWT 签名密钥 (32 字节随机 hex) |
| `ENCRYPTION_KEY` | **必填** | API Key 加密密钥 (32 字节随机 hex) |
| `ADMIN_TOKEN` | -- | 管理后台 API 访问令牌 |
| `RAILWAY_PUBLIC_DOMAIN` | -- | Railway 自动注入,用于 CORS |
| `ENABLE_DETAILED_HEALTH` | `false` | 是否暴露详细健康数据 |
| `MCP_SERVERS` | -- | JSON 格式 MCP 服务器配置 (覆盖 agent-config) |
| `OPENAI_API_KEY` | -- | RAG embedding 接口 API Key |
| `OPENAI_BASE_URL` | -- | RAG embedding 接口 Base URL |
| `RAG_CHUNK_SIZE` | `512` | RAG 分块大小 |
| `RAG_CHUNK_OVERLAP` | `128` | RAG 分块重叠 |
| `VECTOR_STORE_TYPE` | `memory` | 向量存储类型 (`memory` 或 `qdrant`) |
| `MAX_GLOBAL_PROCESSES` | `16` | 全局进程数上限 |
| `MODEL_TIMEOUT_MS` | `300000` | 单模型调用超时 (ms) |

---

## 安全措施

- **JWT_SECRET / ENCRYPTION_KEY 强制校验**:启动时缺失直接退出
- **API Key 加密存储**:AES-256-GCM,密钥从 `ENCRYPTION_KEY` 派生
- **API Key 脱敏**:终端输出自动遮蔽 (`sk-***xxxx`)
- **CSRF 保护**:写操作需 `x-csrf-token` (创建会话时返回)
- **路径遍历防护**:文件 API 禁止访问会话工作目录外路径
- **多级速率限制**:IP 级创建 (5/min)、WS 输入 (20/min)、文件 API (60/min)
- **登录爆破防护**:IP 级失败计数,60s 封锁
- **密码复杂度**:要求大写/小写/数字至少两类
- **CORS 白名单 + WebSocket Origin 校验**
- **Helmet 安全头**:XSS / 点击劫持 / 嗅探防护
- **子进程安全环境**:仅传递白名单环境变量 (`safeEnv.js`)
- **代码执行沙箱**:Docker 隔离 + Python AST 静态拦截
- **容器安全**:`no-new-privileges`,剥离所有 capabilities,限制 2G 内存

---

## 运维工具 -- `cli-ops.mjs`

```bash
node cli-ops.mjs status        # 服务器总览
node cli-ops.mjs sessions      # 活跃会话列表
node cli-ops.mjs models        # 模型成功率统计
node cli-ops.mjs kill <id>     # 终止会话
node cli-ops.mjs tail          # 持续监控
```

环境变量:`OPS_BASE_URL` (默认 `http://127.0.0.1:3000`)、`OPS_INTERVAL` (tail 刷新间隔,默认 5000ms)

---

## 技术栈

| 层 | 技术 |
|---|---|
| 运行时 | Node.js 22 (ESM) |
| 服务端 | Express 4 + `ws` |
| 前端 | Svelte 5 + Vite 8 |
| 持久化 | SQLite (sql.js, WASM 内嵌) |
| 协同 | Yjs + y-websocket |
| MCP | `@modelcontextprotocol/sdk` v1.29 |
| 协议代理 | 自研 `or_proxy.mjs` / `openai_proxy.mjs` |
| 代码高亮 | Shiki |
| 测试 | node:test + Vitest |
| 容器化 | Docker + Docker Compose |
| 部署 | Railway (自动检测 Dockerfile) |

---

## 许可

MIT
