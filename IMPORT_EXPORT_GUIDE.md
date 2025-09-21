# Termix 用户数据导入导出指南

## 概述

Termix V2 重新实现了用户级数据导入导出功能，支持KEK-DEK架构下的安全数据迁移。

## 功能特性

### ✅ 已实现功能
- 🔐 **用户级数据导出** - 支持加密和明文格式
- 📥 **用户级数据导入** - 支持干运行验证
- 🛡️ **数据安全保护** - 基于用户密码的KEK-DEK加密
- 📊 **导出预览** - 验证导出内容和大小
- 🔍 **OIDC配置加密** - 敏感配置安全存储
- 🏭 **生产环境检查** - 启动时安全配置验证

### 🎯 支持的数据类型
- SSH主机配置
- SSH凭据（可选）
- 文件管理器数据（最近文件、固定文件、快捷方式）
- 已忽略的警告

## API端点

### 1. 导出用户数据

```http
POST /database/export
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "format": "encrypted|plaintext",      // 可选，默认encrypted
  "scope": "user_data|all",            // 可选，默认user_data
  "includeCredentials": true,          // 可选，默认true
  "password": "user_password"          // 明文导出时必需
}
```

**响应**：
- 成功：200 + JSON文件下载
- 需要密码：400 + `PASSWORD_REQUIRED`
- 无权限：401

### 2. 导入用户数据

```http
POST /database/import
Authorization: Bearer <jwt_token>
Content-Type: multipart/form-data

form-data:
- file: <导出的JSON文件>
- replaceExisting: false               // 可选，是否替换现有数据
- skipCredentials: false              // 可选，是否跳过凭据导入
- skipFileManagerData: false          // 可选，是否跳过文件管理器数据
- dryRun: false                       // 可选，干运行模式
- password: "user_password"           // 加密数据导入时必需
```

**响应**：
- 成功：200 + 导入统计
- 部分成功：207 + 错误详情
- 需要密码：400 + `PASSWORD_REQUIRED`

### 3. 导出预览

```http
POST /database/export/preview
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "format": "encrypted",
  "scope": "user_data",
  "includeCredentials": true
}
```

**响应**：
```json
{
  "preview": true,
  "stats": {
    "version": "v2.0",
    "username": "admin",
    "totalRecords": 25,
    "breakdown": {
      "sshHosts": 10,
      "sshCredentials": 5,
      "fileManagerItems": 8,
      "dismissedAlerts": 2
    },
    "encrypted": true
  },
  "estimatedSize": 51234
}
```

## 使用示例

### 导出用户数据（加密）

```bash
curl -X POST http://localhost:8081/database/export \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "format": "encrypted",
    "includeCredentials": true
  }' \
  -o my-termix-backup.json
```

### 导出用户数据（明文，需要密码）

```bash
curl -X POST http://localhost:8081/database/export \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "format": "plaintext",
    "password": "your_password",
    "includeCredentials": true
  }' \
  -o my-termix-backup-plaintext.json
```

### 导入数据（干运行）

```bash
curl -X POST http://localhost:8081/database/import \
  -H "Authorization: Bearer <your_jwt_token>" \
  -F "file=@my-termix-backup.json" \
  -F "dryRun=true" \
  -F "password=your_password"
```

### 导入数据（实际执行）

```bash
curl -X POST http://localhost:8081/database/import \
  -H "Authorization: Bearer <your_jwt_token>" \
  -F "file=@my-termix-backup.json" \
  -F "replaceExisting=false" \
  -F "password=your_password"
```

## 数据格式

### 导出数据结构

```typescript
interface UserExportData {
  version: string;                    // "v2.0"
  exportedAt: string;                // ISO时间戳
  userId: string;                    // 用户ID
  username: string;                  // 用户名
  userData: {
    sshHosts: SSHHost[];            // SSH主机配置
    sshCredentials: SSHCredential[]; // SSH凭据
    fileManagerData: {              // 文件管理器数据
      recent: RecentFile[];
      pinned: PinnedFile[];
      shortcuts: Shortcut[];
    };
    dismissedAlerts: DismissedAlert[]; // 已忽略警告
  };
  metadata: {
    totalRecords: number;           // 总记录数
    encrypted: boolean;             // 是否加密
    exportType: 'user_data' | 'all'; // 导出类型
  };
}
```

## 安全考虑

### 加密导出
- 数据使用用户的KEK-DEK架构加密
- 即使导出文件泄露，没有用户密码也无法解密
- 推荐用于生产环境数据备份

### 明文导出
- 数据以可读JSON格式导出
- 需要用户当前密码验证
- 便于数据检查和跨系统迁移
- ⚠️ 文件包含敏感信息，使用后应安全删除

### 导入安全
- 导入时验证数据完整性
- 支持干运行模式预检查
- 自动重新生成ID避免冲突
- 加密数据重新使用目标用户的密钥加密

## 故障排除

### 常见错误

1. **`PASSWORD_REQUIRED`** - 明文导出/导入需要密码
2. **`Invalid token`** - JWT令牌无效或过期
3. **`User data not unlocked`** - 用户数据密钥未解锁
4. **`Invalid JSON format`** - 导入文件格式错误
5. **`Export validation failed`** - 导出数据结构不完整

### 调试步骤

1. 检查JWT令牌是否有效
2. 确保用户已登录并解锁数据
3. 验证导出文件JSON格式
4. 使用干运行模式测试导入
5. 查看服务器日志获取详细错误信息

## 迁移场景

### 场景1：用户数据备份
```bash
# 1. 导出加密数据
curl -X POST http://localhost:8081/database/export \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"format":"encrypted"}' \
  -o backup.json

# 2. 验证备份
curl -X POST http://localhost:8081/database/export/preview \
  -H "Authorization: Bearer $TOKEN" \
  -d '{}'
```

### 场景2：跨实例迁移
```bash
# 1. 从源实例导出明文数据
curl -X POST http://old-server:8081/database/export \
  -H "Authorization: Bearer $OLD_TOKEN" \
  -d '{"format":"plaintext","password":"userpass"}' \
  -o migration.json

# 2. 导入到新实例
curl -X POST http://new-server:8081/database/import \
  -H "Authorization: Bearer $NEW_TOKEN" \
  -F "file=@migration.json" \
  -F "password=userpass"
```

### 场景3：选择性迁移
```bash
# 只迁移SSH配置，跳过凭据
curl -X POST http://localhost:8081/database/import \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@backup.json" \
  -F "skipCredentials=true" \
  -F "password=userpass"
```

## 最佳实践

1. **定期备份**：使用加密格式定期导出用户数据
2. **迁移前测试**：使用干运行模式验证导入数据
3. **安全处理**：明文导出文件用完后立即删除
4. **版本兼容**：检查导出数据版本与目标系统兼容性
5. **权限管理**：只允许用户导出自己的数据