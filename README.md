---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: aedfae8fca5f7535908186dc16ca4a07_21204fa46eee11f184585254007bceed
    ReservedCode1: MwjXXiLeLd8R5boydt55/3INHBLIl0EF8ZqjCWa1NQQaDAzcUqhBOhI/5KGewzeXP5HfKTe4iiVMvVchzUO1Fk6ONw8TGg5XspWuOTCvQENeyl3CCzqEnQqvl8GRt8gzN9ETcztIx3vRaGERVc+VUQj4fyNPM+H1GXIA3c6+xq/vKhgQJNhXO+aJcWM=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: aedfae8fca5f7535908186dc16ca4a07_21204fa46eee11f184585254007bceed
    ReservedCode2: MwjXXiLeLd8R5boydt55/3INHBLIl0EF8ZqjCWa1NQQaDAzcUqhBOhI/5KGewzeXP5HfKTe4iiVMvVchzUO1Fk6ONw8TGg5XspWuOTCvQENeyl3CCzqEnQqvl8GRt8gzN9ETcztIx3vRaGERVc+VUQj4fyNPM+H1GXIA3c6+xq/vKhgQJNhXO+aJcWM=
---

# 🆓 ClaudeFree — 免费 Claude Code Web 接入

通过 OpenRouter / DeepSeek 等 Provider 路由，在浏览器中使用 Claude Code CLI 的全部能力。

## 架构

```
浏览器 (index.html)
   │ WebSocket
   ▼
index.js ─── 服务端核心
   ├── spawn CLI (cli-dev)         ← 执行 Claude Code 指令
   ├── spawn Proxy (or_proxy.mjs)  ← OpenRouter/DeepSeek 协议适配
   ├── WebSocket 终端 + 模型健康推送
   └── REST API (会话/文件/健康)
```

## 快速开始

```bash
# 1. 安装依赖
cd free-code
npm install

# 2. 配置（可选，默认内置 openrouter 预设）
cp agent-config.example.json agent-config.json
# 编辑 agent-config.json 按需增减模型

# 3. 启动
node index.js
# 监听 http://0.0.0.0:3000
```

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | HTTP 服务端口 |
| `HOST` | `0.0.0.0` | 绑定地址 |
| `WORKSPACE_DIR` | `../../workspace` | 会话工作目录 |
| `MAX_SESSIONS` | `10` | 最大并发会话数 |
| `FREE_CODE_DIR` | `/free-code` | CLI 和 Proxy 脚本目录 |
| `AGENT_CONFIG_PATH` | `/free-code/agent-config.json` | 模型配置文件路径 |
| `ALLOWED_ORIGINS` | — | 逗号分隔的 CORS 白名单 |

## 文件说明

```
free-code/
├── index.js              # 服务端入口 (Express + WebSocket)
├── or_proxy.mjs          # 协议代理 (Anthropic ↔ OpenRouter/DeepSeek)
├── agent-config.json     # 模型/Provider 配置
├── cli-ops.mjs           # 运维命令行工具
├── index.html            # 前端 UI
├── index.js (前端)        # 前端逻辑
└── cli-dev               # Claude Code CLI 二进制
```

## API 参考

### 会话管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/session` | 创建会话。Body: `{ apiKey, model?, provider? }` |
| `GET` | `/api/session/:id` | 查询会话信息 (需 `x-session-token`) |
| `DELETE` | `/api/session/:id` | 删除会话 (需 `x-session-token` + `x-csrf-token`) |

### 模型发现

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/models?provider=openrouter` | 列出 provider 下所有模型 (免费优先) |
| `GET` | `/api/models/:provider` | 同上，路径参数方式 |

### 文件管理 (CSRF 保护)

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/files/:sessionId` | 列出会话目录文件树 |
| `GET` | `/api/files/:sessionId/*` | 读取文件内容 |
| `POST` | `/api/files/:sessionId/*` | 写入文件 (需 `x-csrf-token`) |
| `DELETE` | `/api/files/:sessionId/*` | 删除文件 (需 `x-csrf-token`) |

### 健康检查

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/health` | 基础健康：版本/会话数/运行时间 |
| `GET` | `/api/health/detailed` | 详细：每模型成功率、每会话状态 |

### WebSocket

| 路径 | 说明 |
|------|------|
| `ws://host:port/ws` | 终端交互通道。消息格式: `{ type, sessionId, token, data? }` |

服务端推送类型：
- `output` — CLI 标准输出
- `stderr` — CLI 错误输出
- `exit` — 进程结束 (含 `code`)
- `error` — 错误消息
- `model_update` — 模型健康状态变更

## 会话流程

```
1. POST /api/session  → 获取 sessionId + token + csrfToken
2. ws://host:port/ws   → 发送 { type:'input', sessionId, token, data:'用户指令' }
3. 服务端 spawn CLI → 通过 Proxy 调用 AI → 实时推送 output
4. 完成后收到 { type:'exit', code }
5. DELETE /api/session/:id → 清理
```

## or_proxy.mjs — 协议代理

将 Anthropic Messages API 请求翻译为 OpenRouter / DeepSeek 格式。

**特性**：
- 同模型最多重试 2 次（指数退避 1s → 2s）
- 全部失败后自动切换 fallback 模型
- 错误友好化：返回 `code` + `zh_message` 中文提示
- 支持流式 (`stream: true`) 和非流式

**启动参数**：
```
node or_proxy.mjs --model <model_id> [--fallback-model <id>] [--base-url <url>]
```

**错误码**：

| code | HTTP | 中文说明 |
|------|------|----------|
| `invalid_api_key` | 401 | API Key 无效或已过期 |
| `insufficient_balance` | 402 | 账户余额不足 |
| `model_not_authorized` | 403 | 无权访问该模型 |
| `rate_limited` | 429 | 请求频率过高 |
| `provider_error` | 500 | 服务商内部错误 |
| `provider_unavailable` | 502 | 服务商网关不可用 |
| `provider_overloaded` | 503 | 服务商过载 |

## cli-ops.mjs — 运维工具

```bash
node cli-ops.mjs status       # 服务器总览
node cli-ops.mjs sessions     # 活跃会话列表
node cli-ops.mjs models       # 模型成功率统计
node cli-ops.mjs kill <id>    # 终止会话
node cli-ops.mjs tail         # 持续监控
```

环境变量：`OPS_BASE_URL` (默认 `http://127.0.0.1:3000`)、`OPS_INTERVAL` (tail 刷新间隔，默认 5000ms)

## agent-config.json — 模型配置

```jsonc
{
  "defaults": { "provider": "openrouter", "model": "..." },
  "providers": {
    "openrouter": {
      "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
      "fallbackModel": "google/gemini-2.0-flash-lite-001",
      "modelAliases": { "sonnet": "anthropic/claude-sonnet-4", ... },
      "models": [
        { "id": "...", "name": "...", "tier": "free|paid", "context": 128000 }
      ]
    }
  }
}
```

修改模型列表只需编辑此文件，无需改代码。服务启动时自动加载。

## 安全措施

- **CSRF 保护**：所有写操作需 `x-csrf-token`（创建会话时返回）
- **API Key 脱敏**：终端输出自动遮蔽 Key（`sk-ant-a***xxxx`）
- **路径遍历防护**：文件 API 禁止访问会话目录外路径
- **速率限制**：IP 级创建限制 (5/min)、WebSocket 输入限制 (20/min)、文件 API 限制 (60/min)
- **CORS 白名单**：仅允许配置的 Origin
- **Helmet 安全头**：XSS/点击劫持/嗅探防护
- **WebSocket Origin 校验**

## 版本历史

| 版本 | 变更 |
|------|------|
| 7.3.0 | Agent 配置标准化 (`agent-config.json`) |
| 7.2.0 | 运维 CLI (`cli-ops.mjs`) |
| 7.1.0 | API Key 脱敏 |
| 7.0.0 | 错误友好化 + 健康统计 |
| 6.0.0 | 模型发现 API + 前端健康指示灯 |
| 5.0.0 | 线路健康降级 (重试+fallback) |
| 4.0.0 | CSRF 保护 + CORS 死代码清理 |
*（内容由AI生成，仅供参考）*
