#!/bin/bash

set -e

echo "🚀 部署 Free Code Web"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker 未安装，请先安装 Docker"
    exit 1
fi

# Check if docker-compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ docker-compose 未安装，请先安装"
    exit 1
fi

# Build and start the container
echo "📦 构建 Docker 镜像..."
docker-compose build

echo "▶️ 启动服务..."
docker-compose up -d

echo ""
echo "✅ 部署完成!"
echo ""
echo "📍 访问地址: http://localhost:3000"
echo ""
echo "常用命令:"
echo "  查看日志: docker-compose logs -f"
echo "  停止服务: docker-compose down"
echo "  重启服务: docker-compose restart"
echo "  重新部署: ./deploy.sh"
