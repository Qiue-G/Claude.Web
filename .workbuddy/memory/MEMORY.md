# 项目记忆 · ClaudeFree (free-code-web)

## 基本信息
- GitHub: `git@github.com:Qiue-G/Claude.Web.git`
- 部署平台: Railway(自动检测 Dockerfile)
- 版本: v7.3.2

## 部署方式
- Docker 化部署,Dockerfile 基于 `node:22-slim`
- 构建过程中 clone 上游 `github.com/paoloanzn/free-code` 编译 CLI 工具和提取 prompts
- `bootstrap.js` 中通过 `RAILWAY_PUBLIC_DOMAIN` / `RAILWAY_STATIC_URL` 自动加入 CORS 白名单
- Docker Compose 限制 2G 内存 / 2 CPU / no-new-privileges / 剥离所有 capabilities
- 本地开发: `node src/server/index.js` (直接跑)
- 本地/自托管部署: `docker-compose up` 或 `./deploy.sh`

## 环境变量要点
- `JWT_SECRET`、`ENCRYPTION_KEY`:必须设置,缺失则进程拒绝启动
- `WORKSPACE_DIR`、`FREE_CODE_DIR`、`AGENT_CONFIG_PATH`:路径配置
- `SESSION_TIMEOUT`:默认 1 小时超时
- `RAILWAY_PUBLIC_DOMAIN` / `RAILWAY_STATIC_URL`:生产环境自动注入,用于 CORS

## 项目现状
- 约 34,400 行 src 代码(js/svelte/py)
- README 严重滞后于实际代码(缺少 RAG/MCP/协同/并行/auth 等模块说明)
- 根目录有未 gitignore 的 CI 日志和测试日志文件
- 正处在对标 Kun/open-webui 的优化迭代中(docs/ 下有多份优化计划)
- 当前有 10 个文件本地修改未提交
