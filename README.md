# Free Code Web

在浏览器中使用 Claude Code（移动端优化版）

## 快速部署

### Docker 部署（推荐）

```bash
# 克隆项目
git clone <your-repo-url> free-code-web
cd free-code-web

# 部署
chmod +x deploy.sh
./deploy.sh
```

然后访问 `http://localhost:3000`

### 云服务器部署

1. 在云服务器上安装 Docker
2. 上传项目文件或使用 Git 克隆
3. 运行 `./deploy.sh`
4. 配置 Nginx 反向代理 + HTTPS
5. 配置域名解析

### VPS 示例 (Ubuntu)

```bash
# 安装 Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# 克隆并部署
git clone <your-repo> free-code-web
cd free-code-web
./deploy.sh

# 配置防火墙
sudo ufw allow 3000
```

## 功能

- 📱 **移动端优化** - 响应式设计，触屏友好
- 💬 **AI 对话** - 使用 Claude Code 进行代码生成和修改
- 📁 **文件管理** - 浏览、编辑工作目录中的文件
- 🔒 **本地认证** - API Key 仅存储在浏览器本地
- 🔄 **实时交互** - WebSocket 实现实时终端输出

## 配置

环境变量:

| 变量 | 默认值 | 说明 |
|------|--------|------|
| PORT | 3000 | 服务端口 |
| HOST | 0.0.0.0 | 监听地址 |
| WORKSPACE_DIR | /workspace | 工作目录 |
| MAX_SESSIONS | 10 | 最大并发会话数 |

## API 接口

- `POST /api/session` - 创建新会话
- `GET /api/session/:id` - 获取会话信息
- `DELETE /api/session/:id` - 删除会话
- `GET /api/files` - 列出文件
- `GET /api/file` - 读取文件
- `POST /api/file` - 保存文件
- `GET /api/health` - 健康检查

## 安全注意

⚠️ 此应用设计为可信环境内使用。云部署时建议:
- 使用 HTTPS
- 配置认证中间件
- 限制 IP 访问
- 定期清理工作目录

## License

MIT
