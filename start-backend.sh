#!/bin/bash

echo "Starting Termix Backend Services..."

# 设置环境变量
export NODE_ENV=${NODE_ENV:-production}
export DATA_PATH=${DATA_PATH:-./data}

# 检查是否已经构建
if [ ! -d "dist/backend" ]; then
    echo "Building backend..."
    npm run build:backend
fi

# 检查端口是否被占用的函数
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo "Port $port is already in use"
        return 1
    fi
    return 0
}

# 启动所有后端服务
echo "Starting backend services..."
echo "- Database API (8081)"
echo "- WebSocket Terminal (8082)" 
echo "- Tunnel Management (8083)"
echo "- File Manager (8084)"
echo "- Server Statistics (8085)"

# 检查关键端口
for port in 8081 8082 8083 8084 8085; do
    if ! check_port $port; then
        echo "Error: Port $port is in use. Please stop the conflicting service."
        exit 1
    fi
done

# 启动主服务（会自动启动所有其他服务）
echo "Starting all services via starter.js..."
node dist/backend/starter.js