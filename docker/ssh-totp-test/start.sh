#!/bin/bash

echo "================================"
echo "SSH TOTP 测试服务器 - 启动脚本"
echo "================================"
echo ""

# 检查Docker是否运行
if ! docker info > /dev/null 2>&1; then
    echo "❌ 错误: Docker未运行，请先启动Docker"
    exit 1
fi

# 检查端口2222是否被占用
if netstat -an 2>/dev/null | grep -q ":2222 "; then
    echo "⚠️  警告: 端口2222已被占用"
    echo "请执行以下命令停止旧容器："
    echo "  docker stop ssh-totp-test"
    echo "  docker rm ssh-totp-test"
    exit 1
fi

# 进入脚本所在目录
cd "$(dirname "$0")"

echo "🔨 步骤1/4: 构建Docker镜像..."
docker build -t ssh-totp-test . || {
    echo "❌ 构建失败"
    exit 1
}

echo ""
echo "🚀 步骤2/4: 启动容器..."
docker run -d --name ssh-totp-test -p 2222:22 ssh-totp-test || {
    echo "❌ 启动失败"
    exit 1
}

echo ""
echo "⏳ 步骤3/4: 等待SSH服务启动..."
sleep 3

echo ""
echo "📱 步骤4/4: 生成TOTP配置信息..."
echo ""
echo "================================"
echo "✅ SSH TOTP测试服务器已启动"
echo "================================"
echo ""
echo "📍 连接信息："
echo "   主机: localhost"
echo "   端口: 2222"
echo "   用户: testuser"
echo ""
echo "🔑 TOTP密钥: JBSWY3DPEHPK3PXP"
echo ""
echo "📱 配置Google Authenticator："
echo "   方法1: 扫描下方QR码"
echo "   方法2: 手动输入密钥 JBSWY3DPEHPK3PXP"
echo ""
echo "QR码："
docker exec ssh-totp-test qrencode -t UTF8 'otpauth://totp/testuser@ssh-totp-test?secret=JBSWY3DPEHPK3PXP&issuer=Termix' 2>/dev/null || {
    echo "   (QR码生成失败，请手动输入密钥)"
}
echo ""
echo "================================"
echo "🧪 测试步骤："
echo "================================"
echo "1. 在Google Authenticator中添加上面的密钥"
echo "2. 在Termix中添加主机:"
echo "   - 主机: localhost"
echo "   - 端口: 2222"
echo "   - 用户名: testuser"
echo "   - 认证类型: password"
echo "   - 密码: testpass"
echo "3. 连接时会提示两次:"
echo "   - 第一次: 输入密码 testpass"
echo "   - 第二次: 输入TOTP验证码（6位数字）"
echo ""
echo "================================"
echo "🛠️  管理命令："
echo "================================"
echo "查看日志: docker logs ssh-totp-test"
echo "停止服务: docker stop ssh-totp-test"
echo "删除容器: docker rm ssh-totp-test"
echo "重新启动: docker restart ssh-totp-test"
echo ""
echo "================================"
