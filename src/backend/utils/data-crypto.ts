import { FieldCrypto } from "./field-crypto.js";
import { UserCrypto } from "./user-crypto.js";
import { databaseLogger } from "./logger.js";

/**
 * DataCrypto - Simplified database encryption
 *
 * Linus principles:
 * - Remove all "backward compatibility" garbage
 * - Remove all special case handling
 * - Data is either properly encrypted or operation fails
 * - No legacy data concept
 */
class DataCrypto {
  private static userCrypto: UserCrypto;

  static initialize() {
    this.userCrypto = UserCrypto.getInstance();
    databaseLogger.info("DataCrypto initialized - no legacy compatibility", {
      operation: "data_crypto_init",
    });
  }

  /**
   * 加密记录 - 简单直接
   */
  static encryptRecord(tableName: string, record: any, userId: string, userDataKey: Buffer): any {
    const encryptedRecord = { ...record };
    const recordId = record.id || 'temp-' + Date.now();

    for (const [fieldName, value] of Object.entries(record)) {
      if (FieldCrypto.shouldEncryptField(tableName, fieldName) && value) {
        encryptedRecord[fieldName] = FieldCrypto.encryptField(
          value as string,
          userDataKey,
          recordId,
          fieldName
        );
      }
    }

    return encryptedRecord;
  }

  /**
   * Decrypt record - either succeeds or fails
   *
   * Removed all:
   * - isEncrypted() checks
   * - legacy data handling
   * - "backward compatibility" logic
   * - migration on access
   */
  static decryptRecord(tableName: string, record: any, userId: string, userDataKey: Buffer): any {
    if (!record) return record;

    const decryptedRecord = { ...record };
    const recordId = record.id;

    for (const [fieldName, value] of Object.entries(record)) {
      if (FieldCrypto.shouldEncryptField(tableName, fieldName) && value) {
        // Simple rule: sensitive fields must be encrypted JSON format
        // If not, it's data corruption, fail directly
        decryptedRecord[fieldName] = FieldCrypto.decryptField(
          value as string,
          userDataKey,
          recordId,
          fieldName
        );
      }
    }

    return decryptedRecord;
  }

  /**
   * 批量解密
   */
  static decryptRecords(tableName: string, records: any[], userId: string, userDataKey: Buffer): any[] {
    if (!Array.isArray(records)) return records;
    return records.map((record) => this.decryptRecord(tableName, record, userId, userDataKey));
  }

  /**
   * 获取用户数据密钥
   */
  static getUserDataKey(userId: string): Buffer | null {
    return this.userCrypto.getUserDataKey(userId);
  }

  /**
   * 验证用户访问权限 - 简单直接
   */
  static validateUserAccess(userId: string): Buffer {
    const userDataKey = this.getUserDataKey(userId);
    if (!userDataKey) {
      throw new Error(`User ${userId} data not unlocked`);
    }
    return userDataKey;
  }

  /**
   * 便捷方法：自动获取用户密钥并加密
   */
  static encryptRecordForUser(tableName: string, record: any, userId: string): any {
    const userDataKey = this.validateUserAccess(userId);
    return this.encryptRecord(tableName, record, userId, userDataKey);
  }

  /**
   * 便捷方法：自动获取用户密钥并解密
   */
  static decryptRecordForUser(tableName: string, record: any, userId: string): any {
    const userDataKey = this.validateUserAccess(userId);
    return this.decryptRecord(tableName, record, userId, userDataKey);
  }

  /**
   * 便捷方法：批量解密
   */
  static decryptRecordsForUser(tableName: string, records: any[], userId: string): any[] {
    const userDataKey = this.validateUserAccess(userId);
    return this.decryptRecords(tableName, records, userId, userDataKey);
  }

  /**
   * 检查用户是否可以访问数据
   */
  static canUserAccessData(userId: string): boolean {
    return this.userCrypto.isUserUnlocked(userId);
  }

  /**
   * 测试加密功能
   */
  static testUserEncryption(userId: string): boolean {
    try {
      const userDataKey = this.getUserDataKey(userId);
      if (!userDataKey) return false;

      const testData = "test-" + Date.now();
      const encrypted = FieldCrypto.encryptField(testData, userDataKey, "test-record", "test-field");
      const decrypted = FieldCrypto.decryptField(encrypted, userDataKey, "test-record", "test-field");

      return decrypted === testData;
    } catch (error) {
      return false;
    }
  }
}

export { DataCrypto };