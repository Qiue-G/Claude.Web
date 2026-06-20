#!/bin/bash

# Free Code Web - 一键启动 + 内网穿透
# 支持手机数据网络访问

set -e

PORT=3000
TUNNEL_NAME="free-code-web"

echo "🚀 启动 Free Code Web..."

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 需要安装 Node.js: https://nodejs.org"
    exit 1
fi

# 检查 cloudflared
install_cloudflared() {
    echo "📦 安装 Cloudflare Tunnel..."
    if command -v brew &> /dev/null; then
        brew install cloudflare/cloudflare/cloudflared
    elif command -v apt &> /dev/null; then
        curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
        sudo dpkg -i cloudflared.deb
        rm cloudflared.deb
    elif command -v yum &> /dev/null; then
        curl -L --output cloudflared.rpm https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.rpm
        sudo rpm -i cloudflared.rpm
        rm cloudflared.rpm
    else
        # Windows
        curl -L --output cloudflared.exe https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
        echo "下载完成: cloudflared.exe"
    fi
}

if ! command -v cloudflared &> /dev/null && [ ! -f ./cloudflared.exe ]; then
    install_cloudflared
fi

# 启动 Web 服务
echo "▶️ 启动 Web 服务 (端口 $PORT)..."
node src/server/index.js &
SERVER_PID=$!

# 等待服务启动
sleep 2

# 启动 Cloudflare Tunnel
echo "🌐 启动内网穿透..."
echo ""
echo "📱 手机访问以下地址（数据网络可用）："
echo ""

if [ -f ./cloudflared.exe ]; then
    ./cloudflared.exe tunnel --url http://localhost:$PORT 2>&1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | head -1 &
else
    cloudflared tunnel --url http://localhost:$PORT 2>&1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | head -1 &
fi

# 等待 tunnel URL
sleep 5

# 显示完整 tunnel URL
if [ -f ./cloudflared.exe ]; then
    TUNNEL_URL=$(./cloudflared.exe tunnel --url http://localhost:$PORT 2>&1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | head -1)
else
    TUNNEL_URL=$(cloudflared tunnel --url http://localhost:$PORT 2>&1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | head -1)
fi

if [ -n "$TUNNEL_URL" ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🔗 $TUNNEL_URL"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "复制上面的地址到手机浏览器打开"
fi

echo ""
echo "按 Ctrl+C 停止服务"

# 等待退出
trap "kill $SERVER_PID 2>/dev/null; echo '已停止'; exit" INT TERM
wait
