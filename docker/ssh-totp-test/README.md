# SSH TOTP 测试服务器

这是一个配置了TOTP（Time-based One-Time Password）双因素认证的SSH测试服务器。

## 快速开始

### 1. 构建Docker镜像

```bash
cd docker/ssh-totp-test
docker build -t ssh-totp-test .
```

### 2. 启动容器

```bash
docker run -d --name ssh-totp-test -p 2222:22 ssh-totp-test
```

### 3. 配置Google Authenticator

**方法A：扫描QR码**

生成QR码：
```bash
docker exec ssh-totp-test qrencode -t UTF8 'otpauth://totp/testuser@ssh-totp-test?secret=JBSWY3DPEHPK3PXP&issuer=Termix'
```

用手机上的Google Authenticator或Authy应用扫描QR码。

**方法B：手动输入密钥**

在Google Authenticator应用中：
1. 点击"+"添加账户
2. 选择"手动输入密钥"
3. 账户名：`testuser`
4. 密钥：`JBSWY3DPEHPK3PXP`
5. 时间类型：基于时间

### 4. 测试连接

**在Termix中添加此主机：**
- 主机：`localhost`
- 端口：`2222`
- 用户名：`testuser`
- 认证类型：选择`password`
- 密码：`testpass`

**连接时的流程（双因素认证）：**
1. 点击连接
2. 第一步：输入密码 `testpass`
3. 第二步：会弹出TOTP验证码输入框（"Verification code:"）
4. 打开手机上的Google Authenticator
5. 输入显示的6位数字验证码
6. 连接成功

### 5. 命令行测试（可选）

如果你想用命令行SSH客户端测试：

```bash
ssh testuser@localhost -p 2222
```

连接时会有**两次提示**：
1. 第一次提示 "Password:" → 输入 `testpass`
2. 第二次提示 "Verification code:" → 输入Google Authenticator显示的6位数字

## 验证码生成（命令行方式）

如果你没有手机，可以用命令行工具生成TOTP验证码：

**安装oathtool：**
```bash
# macOS
brew install oath-toolkit

# Ubuntu/Debian
sudo apt-get install oathtool

# Windows (WSL)
sudo apt-get install oathtool
```

**生成当前验证码：**
```bash
oathtool --totp -b JBSWY3DPEHPK3PXP
```

## 容器管理

**查看容器日志：**
```bash
docker logs ssh-totp-test
```

**停止容器：**
```bash
docker stop ssh-totp-test
```

**重启容器：**
```bash
docker restart ssh-totp-test
```

**删除容器：**
```bash
docker stop ssh-totp-test
docker rm ssh-totp-test
```

**删除镜像：**
```bash
docker rmi ssh-totp-test
```

## 故障排查

**问题：连接被拒绝**
```bash
# 检查容器是否运行
docker ps | grep ssh-totp-test

# 检查端口是否被占用
netstat -an | grep 2222  # Windows
lsof -i :2222            # macOS/Linux
```

**问题：验证码错误**
```bash
# 确保系统时间正确（TOTP依赖时间同步）
date

# 查看SSH服务器日志
docker logs ssh-totp-test
```

**问题：想进入容器调试**
```bash
docker exec -it ssh-totp-test /bin/bash
```

## 技术细节

**TOTP密钥信息：**
- 密钥（Base32）：`JBSWY3DPEHPK3PXP`
- 密钥（原始）：`Hello!`
- 算法：SHA1
- 时间步长：30秒
- 验证码长度：6位

**SSH配置特点：**
- 强制使用keyboard-interactive认证
- PAM配置双因素认证：先验证密码，再验证TOTP
- 必须同时提供正确的密码和TOTP验证码才能登录

**用户信息：**
- 用户名：`testuser`
- 密码：`testpass`
- Shell：`/bin/bash`

**认证流程：**
1. PAM模块 `pam_unix.so` 验证密码
2. PAM模块 `pam_google_authenticator.so` 验证TOTP验证码
3. 两步都通过才允许登录
