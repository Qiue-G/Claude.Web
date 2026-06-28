# Claude.Web — 上游仓库重新分析与实施计划

> 分析日期：2026-06-28
> 分析目标：[Kun](https://github.com/Qiue-G/Kun) (forked from KunAgent/Kun) · [open-webui](https://github.com/Qiue-G/open-webui) (forked from open-webui/open-webui)

---

## 一、上游仓库最新状态

### Kun (Qiue-G/Kun)

| 项目 | 值 |
|---|---|
| 上次同步 | Jun 26, 2026（commit `fdb0f6b`）|
| 落后上游 | **95 commits** (KunAgent/Kun:master) |
| 技术栈 | React 19 + Electron + TypeScript + Vite |
| 状态 | 活跃开发，桌面应用 |

**最新关键更新**（上游 KunAgent/Kun 近期的能力）：  
- **需求先行工作流**：需求草稿 → 设计稿 → 实施计划 → Todo → Agent 编码 → 验收
- **可视化工作流**：Create Loop 节点编排画布 (n8n/Dify 风格)
- **MCP 集成**：`@modelcontextprotocol/sdk` 原生支持
- **多模态**：Whisper ASR、图片/音乐/视频生成
- **工具审批 + 权限模式**：工具审批、文件系统权限、内联 diff
- **UI 插件系统**：`examples/ui-plugins/` 插件工坊
- **Git 工作树**：worktree 支持、分支管理增强

### open-webui (Qiue-G/open-webui)

| 项目 | 值 |
|---|---|
| 上次同步 | Jun 2, 2026（commit `02dc3e6`）|
| 落后上游 | **0 commits**（与上游同步） |
| 技术栈 | Svelte 5 + Python FastAPI + SQLite/PostgreSQL |
| 状态 | 超活跃开发（16,810 commits），企业级 |

**最新关键更新**：  
- **Valkey 向量数据库支持**：新增 Valkey 作为向量存储后端（2026-06-02）
- **RAG 增强**：PaddleOCR-vl 加载器、检索路由器
- **Firecrawl v2 API**：Web 抓取重构
- **SSRF 安全修复**：阻止私有 IP webhook URL
- **企业版**：自定义主题、SLA 支持、LTS 版本
- **Pyodide 浏览器端 Python**：浏览器内代码执行

---

## 二、Claude.Web 当前状态复盘

### ✅ 已完成

| 模块 | 说明 |
|---|---|
| 路由拆分 | `index.js` → `sessionRoutes`, `modelRoutes`, `healthRoutes`, `configRoutes`, `fileRoutes`, `wsHandler` |
| 会话持久化 | SQLite (`sql.js`) → `sessions` + `messages` 表 |
| 工具审批层 | 后端等待 Promise + 30s 超时 + 前端弹窗（批准/拒绝/全部拒绝） |
| CI/CD | GitHub Actions (`npm ci → build → test`, 44/44) |
| Railway 部署 | 生产环境运行正常（健康检查 ✅） |
| 工具系统 | Web Search, Code Interpreter, Image Generation, File Analysis |

### ❌ 未完成 / 可改进

| 模块 | 现状 | 差距 |
|---|---|---|
| **MCP 集成** | 4 个硬编码内置工具 | Kun 的 `@modelcontextprotocol/sdk` 可扩展 |
| **RAG/知识库** | 无 | open-webui 的 SQLite + 向量检索 |
| **前端体验** | 基本的 Svelte 5 | open-webui 的 Svelte 5 UI 组件可参考 |
| **测试覆盖** | 44 个测试（路由 + 工具） | 缺少前端 + 集成测试 |
| **i18n 多语言** | 之前有但被移除 | open-webui 有完整的 i18n 体系 |
| **文件版本管理** | 简单文件读写 | Kun 的 Git worktree 集成 |
| **Swagger/API 文档** | 无 | 调试和对接成本高 |
| **搜索功能** | 前端基本搜索 | 后端 API 搜索缺失 |

---

## 三、调整后的优先级路线图

### P0 — 高价值低风险（1-2 天）

| # | 任务 | 借鉴来源 | 工作量 |
|---|---|---|---|
| 1 | **前端会话重建** — 刷新页面自动恢复已保存的模型+Session | 自研（基于 SQLite） | ~2h |
| 2 | **搜索 API** — 后端对话/消息搜索接口 | open-webui 搜索设计 | ~3h |
| 3 | **i18n 修复** — 恢复多语言支持（中文/英文） | open-webui i18n 架构参考 | ~4h |

### P1 — 核心功能增强（3-5 天）

| # | 任务 | 借鉴来源 | 工作量 | 说明 |
|---|---|---|---|---|
| 1 | **MCP 集成** — 接入 `@modelcontextprotocol/sdk` 替代硬编码工具 | Kun 原生 MCP | ~2d | **最高 ROI**：工具系统从 4 个变成无限扩展 |
| 2 | **测试覆盖增强** — 前端组件测试 + WebSocket 集成测试 | 自研 | ~1d | 提升 CI 信心，减少回归 |
| 3 | **错误处理统一** — 全局错误中间件 + 前端错误提示 | 自研 | ~1d | 目前错误处理散布在各路由 |

### P2 — 高级功能（1-2 周）

| # | 任务 | 借鉴来源 | 工作量 | 说明 |
|---|---|---|---|---|
| 1 | **RAG 知识库** — 文档上传 → 向量化 → 语义检索 | open-webui 检索架构 | ~1w | 需要选择向量库（sqlite-vec / chromadb）|
| 2 | **文件版本管理** — 文件快照、diff 对比、回滚 | Kun Git worktree | ~3d | 依赖 MCP 完成 |
| 3 | **UI 插件系统** — 前端组件可插拔架构 | Kun 插件工坊 | ~5d | 需要架构设计 |

### P3 — 远期探索

| # | 任务 | 借鉴来源 |
|---|---|---|
| 1 | 可视化工作流（Create Loop） | Kun 节点编排 |
| 2 | 多模态支持（图片/语音） | Kun + open-webui |
| 3 | 企业版功能（SSO/Audit/RBAC） | open-webui 企业版 |

---

## 四、优先级建议与推荐路径

**我的推荐路径（基于当前项目现状）：**

### 第一步：P0 #1 — 前端会话重建（半天）

**为什么先做这个：**
- 当前刷新页面会丢失已保存的模型，用户需手动点"保存的模型"重连
- SQLite 已存储 session 数据，前端只差读取和恢复逻辑
- **改动范围最小、用户体验提升最明显**

**实施方案：**
1. `websocket.js` 启动时调用 `/api/session/last` 获取最后活动 session
2. 如有有效 session → 自动用其 token 重连 WebSocket
3. 无 session 或过期 → 保持"未连接"状态

### 第二步：P1 #1 — MCP 集成（2 天）

**为什么优先于 RAG：**
- MCP 让工具系统从 4 个内置工具 → 任意 MCP 服务器
- 可复用社区大量现成的 MCP（GitHub, 文件系统, Puppeteer, 数据库等）
- 是 Kun 的核心架构优势之一，移植到 Express 可行

**实施方案：**
1. `npm install @modelcontextprotocol/sdk`
2. 创建 `src/server/mcp/` 目录，管理 MCP 客户端连接
3. 将 `tools/registry.js` 改造为支持 MCP + 内置工具的混合模式
4. 前端 `Tools & Skills` 面板增加 MCP 服务器配置 UI

### 第三步：P1 #2 — 测试覆盖增强（1 天）

### 第四步：P2 #1 — RAG 知识库（1 周）

**借鉴 open-webui 的设计：**
- 文档上传 → 解析（PDF/Markdown/Text）
- 向量化（sql.js + 轻量向量或用 OpenAI/DeepSeek embedding API）
- 语义检索 → 结果作为 `system prompt` 上下文注入

---

## 五、技术兼容性速查

| 能力 | Kun 方案 | open-webui 方案 | Claude.Web 可行方案 |
|---|---|---|---|
| MCP | `@modelcontextprotocol/sdk` | ❌ 无 | ✅ **可直接复用 npm 包** |
| 向量检索 | ❌ 无 | `chromadb`, `pgvector`, `Valkey` | `sql.js` + 余弦相似度（轻量）或 ChromaDB |
| 文件解析 | Git diff | `pypdf`, `python-docx` | `pdf-parse` npm + tree-sitter |
| 前端状态 | Zustand 5 | Svelte stores | Svelte stores（已有） |
| i18n | react-i18next | svelte-i18next | svelte-i18next 可复用 |

---

## 六、结论

**核心判断：**
1. **Kun 最有价值的是 MCP 集成方式** — Express 中可原样使用 `@modelcontextprotocol/sdk`
2. **open-webui 最有价值的是 RAG 架构设计** — 虽然后端是 Python，但其 Session-Knowledge-Retrieval 三层架构可以在 Node.js 中复现
3. **代码复用率很低（<10%）** — 两个上游的技术栈与 Claude.Web 差异太大，应以"设计模式参考"为主
4. **短期目标应聚焦 MCP 集成** — 这是投入产出比最高的任务

**建议立即开始：P0 #1 前端会话重建**
