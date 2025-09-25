import { FieldCrypto } from "./field-crypto.js";
import { databaseLogger } from "./logger.js";

/**
 * 延迟字段加密 - 处理从明文到加密的平滑迁移
 * 用于在用户登录时将明文敏感数据逐步加密
 */
export class LazyFieldEncryption {
  /**
   * 检测字段是否为明文（未加密）
   */
  static isPlaintextField(value: string): boolean {
    if (!value) return false;

    try {
      const parsed = JSON.parse(value);
      // 如果能解析为JSON且包含加密数据结构，则认为已加密
      if (parsed && typeof parsed === 'object' &&
          parsed.data && parsed.iv && parsed.tag && parsed.salt && parsed.recordId) {
        return false; // 已加密
      }
      // JSON格式但不是加密结构，视为明文
      return true;
    } catch (jsonError) {
      // 无法解析为JSON，视为明文
      return true;
    }
  }

  /**
   * 安全获取字段值 - 自动处理明文和加密数据
   * 如果是明文，直接返回；如果已加密，则解密
   */
  static safeGetFieldValue(
    fieldValue: string,
    userKEK: Buffer,
    recordId: string,
    fieldName: string
  ): string {
    if (!fieldValue) return "";

    if (this.isPlaintextField(fieldValue)) {
      // 明文数据，直接返回
      databaseLogger.debug("Field detected as plaintext, returning as-is", {
        operation: "lazy_encryption_plaintext_detected",
        recordId,
        fieldName,
        valuePreview: fieldValue.substring(0, 10) + "...",
      });
      return fieldValue;
    } else {
      // 加密数据，需要解密
      try {
        const decrypted = FieldCrypto.decryptField(fieldValue, userKEK, recordId, fieldName);
        databaseLogger.debug("Field decrypted successfully", {
          operation: "lazy_encryption_decrypt_success",
          recordId,
          fieldName,
        });
        return decrypted;
      } catch (error) {
        databaseLogger.error("Failed to decrypt field", error, {
          operation: "lazy_encryption_decrypt_failed",
          recordId,
          fieldName,
          error: error instanceof Error ? error.message : "Unknown error",
        });
        throw error;
      }
    }
  }

  /**
   * 迁移明文字段到加密状态
   * 返回加密后的值，如果已经加密则返回原值
   */
  static migrateFieldToEncrypted(
    fieldValue: string,
    userKEK: Buffer,
    recordId: string,
    fieldName: string
  ): { encrypted: string; wasPlaintext: boolean } {
    if (!fieldValue) {
      return { encrypted: "", wasPlaintext: false };
    }

    if (this.isPlaintextField(fieldValue)) {
      // 明文数据，需要加密
      try {
        const encrypted = FieldCrypto.encryptField(fieldValue, userKEK, recordId, fieldName);

        databaseLogger.info("Field migrated from plaintext to encrypted", {
          operation: "lazy_encryption_migrate_success",
          recordId,
          fieldName,
          plaintextLength: fieldValue.length,
        });

        return { encrypted, wasPlaintext: true };
      } catch (error) {
        databaseLogger.error("Failed to encrypt plaintext field", error, {
          operation: "lazy_encryption_migrate_failed",
          recordId,
          fieldName,
          error: error instanceof Error ? error.message : "Unknown error",
        });
        throw error;
      }
    } else {
      // 已经加密，无需处理
      databaseLogger.debug("Field already encrypted, no migration needed", {
        operation: "lazy_encryption_already_encrypted",
        recordId,
        fieldName,
      });
      return { encrypted: fieldValue, wasPlaintext: false };
    }
  }

  /**
   * 批量迁移记录中的敏感字段
   */
  static migrateRecordSensitiveFields(
    record: any,
    sensitiveFields: string[],
    userKEK: Buffer,
    recordId: string
  ): {
    updatedRecord: any;
    migratedFields: string[];
    needsUpdate: boolean
  } {
    const updatedRecord = { ...record };
    const migratedFields: string[] = [];
    let needsUpdate = false;

    for (const fieldName of sensitiveFields) {
      const fieldValue = record[fieldName];

      if (fieldValue && this.isPlaintextField(fieldValue)) {
        try {
          const { encrypted } = this.migrateFieldToEncrypted(
            fieldValue,
            userKEK,
            recordId,
            fieldName
          );

          updatedRecord[fieldName] = encrypted;
          migratedFields.push(fieldName);
          needsUpdate = true;

          databaseLogger.debug("Record field migrated to encrypted", {
            operation: "lazy_encryption_record_field_migrated",
            recordId,
            fieldName,
          });
        } catch (error) {
          databaseLogger.error("Failed to migrate record field", error, {
            operation: "lazy_encryption_record_field_failed",
            recordId,
            fieldName,
          });
          // 不抛出错误，继续处理其他字段
        }
      }
    }

    if (needsUpdate) {
      databaseLogger.info("Record requires sensitive field migration", {
        operation: "lazy_encryption_record_migration_needed",
        recordId,
        migratedFields,
        totalMigratedFields: migratedFields.length,
      });
    }

    return { updatedRecord, migratedFields, needsUpdate };
  }

  /**
   * 获取敏感字段列表 - 定义哪些字段需要延迟加密
   */
  static getSensitiveFieldsForTable(tableName: string): string[] {
    const sensitiveFieldsMap: Record<string, string[]> = {
      'ssh_data': ['password', 'key', 'key_password'],
      'ssh_credentials': ['password', 'key', 'key_password', 'private_key'],
      'users': ['totp_secret', 'totp_backup_codes'],
    };

    return sensitiveFieldsMap[tableName] || [];
  }

  /**
   * 检查用户是否有需要迁移的明文数据
   */
  static async checkUserNeedsMigration(
    userId: string,
    userKEK: Buffer,
    db: any
  ): Promise<{
    needsMigration: boolean;
    plaintextFields: Array<{ table: string; recordId: string; fields: string[] }>;
  }> {
    const plaintextFields: Array<{ table: string; recordId: string; fields: string[] }> = [];
    let needsMigration = false;

    try {
      // 检查 ssh_data 表
      const sshHosts = db.prepare("SELECT * FROM ssh_data WHERE user_id = ?").all(userId);
      for (const host of sshHosts) {
        const sensitiveFields = this.getSensitiveFieldsForTable('ssh_data');
        const hostPlaintextFields: string[] = [];

        for (const field of sensitiveFields) {
          if (host[field] && this.isPlaintextField(host[field])) {
            hostPlaintextFields.push(field);
            needsMigration = true;
          }
        }

        if (hostPlaintextFields.length > 0) {
          plaintextFields.push({
            table: 'ssh_data',
            recordId: host.id.toString(),
            fields: hostPlaintextFields,
          });
        }
      }

      // 检查 ssh_credentials 表
      const sshCredentials = db.prepare("SELECT * FROM ssh_credentials WHERE user_id = ?").all(userId);
      for (const credential of sshCredentials) {
        const sensitiveFields = this.getSensitiveFieldsForTable('ssh_credentials');
        const credentialPlaintextFields: string[] = [];

        for (const field of sensitiveFields) {
          if (credential[field] && this.isPlaintextField(credential[field])) {
            credentialPlaintextFields.push(field);
            needsMigration = true;
          }
        }

        if (credentialPlaintextFields.length > 0) {
          plaintextFields.push({
            table: 'ssh_credentials',
            recordId: credential.id.toString(),
            fields: credentialPlaintextFields,
          });
        }
      }

      // 检查 users 表中的敏感字段
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      if (user) {
        const sensitiveFields = this.getSensitiveFieldsForTable('users');
        const userPlaintextFields: string[] = [];

        for (const field of sensitiveFields) {
          if (user[field] && this.isPlaintextField(user[field])) {
            userPlaintextFields.push(field);
            needsMigration = true;
          }
        }

        if (userPlaintextFields.length > 0) {
          plaintextFields.push({
            table: 'users',
            recordId: userId,
            fields: userPlaintextFields,
          });
        }
      }

      databaseLogger.info("User migration check completed", {
        operation: "lazy_encryption_user_check",
        userId,
        needsMigration,
        plaintextFieldsCount: plaintextFields.length,
        totalPlaintextFields: plaintextFields.reduce((sum, item) => sum + item.fields.length, 0),
      });

      return { needsMigration, plaintextFields };

    } catch (error) {
      databaseLogger.error("Failed to check user migration needs", error, {
        operation: "lazy_encryption_user_check_failed",
        userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return { needsMigration: false, plaintextFields: [] };
    }
  }
}