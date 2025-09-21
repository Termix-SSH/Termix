# Termix 安全重构计划

## 现状分析
- 当前所有密钥都用base64编码存储在数据库
- JWT Secret和数据加密密钥混合管理
- 没有真正的KEK-DEK分离
- 数据库文件泄露 = 完全沦陷

## 目标架构

### 密钥层次
```
用户密码 → KEK → DEK → 字段加密密钥 → 数据
系统启动 → JWT Secret → JWT Token → API认证
```

### 存储分离
```
系统级：settings.system_jwt_secret (base64保护)
用户级：settings.user_kek_salt_${userId}
用户级：settings.user_encrypted_dek_${userId} (KEK保护)
```

## 修复步骤

### 第1步：新建分离的密钥管理类
- [ ] 创建 SystemKeyManager (JWT密钥)
- [ ] 创建 UserKeyManager (用户数据密钥)
- [ ] 创建 SecuritySession (会话管理)

### 第2步：重构认证流程
- [ ] 修改用户注册：生成用户专属KEK salt和DEK
- [ ] 修改用户登录：验证密码 + 解锁数据密钥
- [ ] 修改JWT验证：系统密钥验证 + 用户会话检查

### 第3步：重构数据加密
- [ ] 分离数据加密和JWT密钥初始化
- [ ] 修改EncryptedDBOperations使用用户会话密钥
- [ ] 添加会话过期处理

### 第4步：数据库迁移
- [ ] 创建迁移脚本：现有数据 → KEK保护
- [ ] 向后兼容处理
- [ ] 安全删除旧密钥

### 第5步：API修改
- [ ] 添加用户密码验证接口
- [ ] 修改所有加密相关接口
- [ ] 添加会话管理接口

## 文件修改清单

### 新建文件
- src/backend/utils/system-key-manager.ts
- src/backend/utils/user-key-manager.ts
- src/backend/utils/security-session.ts
- src/backend/utils/security-migration.ts

### 修改文件
- src/backend/utils/encryption-key-manager.ts (简化或删除)
- src/backend/utils/database-encryption.ts
- src/backend/utils/encrypted-db-operations.ts
- src/backend/database/routes/users.ts
- src/backend/database/database.ts

### 数据库Schema
- 新增：user_kek_salt_${userId}
- 新增：user_encrypted_dek_${userId}
- 修改：system_jwt_secret (从current混合模式分离)

## 安全考虑

### 密钥生命周期
- JWT Secret: 应用生命周期
- 用户KEK: 永不存储，从密码推导
- 用户DEK: 会话期间，内存存储
- 字段密钥: 临时推导，立即销毁

### 会话管理
- 数据会话独立于JWT有效期
- 非活跃自动过期
- 用户登出立即清理

### 向后兼容
- 检测旧格式数据
- 用户登录时自动迁移
- 迁移完成后删除旧密钥

## 测试计划
- [ ] 密钥生成和推导测试
- [ ] 加密解密正确性测试
- [ ] 会话管理测试
- [ ] 迁移流程测试
- [ ] 性能影响评估