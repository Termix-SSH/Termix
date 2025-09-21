import { db } from "../database/db/index.js";
import { DatabaseEncryption } from "./database-encryption.js";
import { FieldEncryption } from "./encryption.js";
import { databaseLogger } from "./logger.js";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

type TableName = "users" | "ssh_data" | "ssh_credentials";

/**
 * EncryptedDBOperations - User key-based database operations
 *
 * Architecture features:
 * - All operations require user ID
 * - Automatic user data key validation
 * - Complete error handling and logging
 * - KEK-DEK architecture integration
 */
class EncryptedDBOperations {
  /**
   * Insert encrypted record
   */
  static async insert<T extends Record<string, any>>(
    table: SQLiteTable<any>,
    tableName: TableName,
    data: T,
    userId: string,
  ): Promise<T> {
    try {
      // Verify user data access permissions
      if (!DatabaseEncryption.canUserAccessData(userId)) {
        throw new Error(`User ${userId} data not unlocked - cannot perform encrypted operations`);
      }

      // Encrypt data
      const encryptedData = DatabaseEncryption.encryptRecordForUser(tableName, data, userId);

      // Insert into database
      const result = await db.insert(table).values(encryptedData).returning();

      // Decrypt returned data to maintain API consistency
      const decryptedResult = DatabaseEncryption.decryptRecordForUser(
        tableName,
        result[0],
        userId
      );

      databaseLogger.debug(`Inserted encrypted record into ${tableName}`, {
        operation: "encrypted_insert_v2",
        table: tableName,
        userId,
        recordId: result[0].id,
      });

      return decryptedResult as T;
    } catch (error) {
      databaseLogger.error(
        `Failed to insert encrypted record into ${tableName}`,
        error,
        {
          operation: "encrypted_insert_v2_failed",
          table: tableName,
          userId,
        },
      );
      throw error;
    }
  }

  /**
   * Query multiple records
   */
  static async select<T extends Record<string, any>>(
    query: any,
    tableName: TableName,
    userId: string,
  ): Promise<T[]> {
    try {
      // Verify user data access permissions
      if (!DatabaseEncryption.canUserAccessData(userId)) {
        throw new Error(`User ${userId} data not unlocked - cannot access encrypted data`);
      }

      // Execute query
      const results = await query;

      // Decrypt results
      const decryptedResults = DatabaseEncryption.decryptRecordsForUser(
        tableName,
        results,
        userId
      );

      databaseLogger.debug(`Selected and decrypted ${decryptedResults.length} records from ${tableName}`, {
        operation: "encrypted_select_v2",
        table: tableName,
        userId,
        recordCount: decryptedResults.length,
      });

      return decryptedResults;
    } catch (error) {
      databaseLogger.error(
        `Failed to select/decrypt records from ${tableName}`,
        error,
        {
          operation: "encrypted_select_v2_failed",
          table: tableName,
          userId,
        },
      );
      throw error;
    }
  }

  /**
   * Query single record
   */
  static async selectOne<T extends Record<string, any>>(
    query: any,
    tableName: TableName,
    userId: string,
  ): Promise<T | undefined> {
    try {
      // Verify user data access permissions
      if (!DatabaseEncryption.canUserAccessData(userId)) {
        throw new Error(`User ${userId} data not unlocked - cannot access encrypted data`);
      }

      // Execute query
      const result = await query;
      if (!result) return undefined;

      // Decrypt results
      const decryptedResult = DatabaseEncryption.decryptRecordForUser(
        tableName,
        result,
        userId
      );

      databaseLogger.debug(`Selected and decrypted single record from ${tableName}`, {
        operation: "encrypted_select_one_v2",
        table: tableName,
        userId,
        recordId: result.id,
      });

      return decryptedResult;
    } catch (error) {
      databaseLogger.error(
        `Failed to select/decrypt single record from ${tableName}`,
        error,
        {
          operation: "encrypted_select_one_v2_failed",
          table: tableName,
          userId,
        },
      );
      throw error;
    }
  }

  /**
   * Update record
   */
  static async update<T extends Record<string, any>>(
    table: SQLiteTable<any>,
    tableName: TableName,
    where: any,
    data: Partial<T>,
    userId: string,
  ): Promise<T[]> {
    try {
      // Verify user data access permissions
      if (!DatabaseEncryption.canUserAccessData(userId)) {
        throw new Error(`User ${userId} data not unlocked - cannot perform encrypted operations`);
      }

      // Encrypt update data
      const encryptedData = DatabaseEncryption.encryptRecordForUser(tableName, data, userId);

      // Execute update
      const result = await db
        .update(table)
        .set(encryptedData)
        .where(where)
        .returning();

      // Decrypt returned data
      const decryptedResults = DatabaseEncryption.decryptRecordsForUser(
        tableName,
        result,
        userId
      );

      databaseLogger.debug(`Updated encrypted record in ${tableName}`, {
        operation: "encrypted_update_v2",
        table: tableName,
        userId,
        updatedCount: result.length,
      });

      return decryptedResults as T[];
    } catch (error) {
      databaseLogger.error(
        `Failed to update encrypted record in ${tableName}`,
        error,
        {
          operation: "encrypted_update_v2_failed",
          table: tableName,
          userId,
        },
      );
      throw error;
    }
  }

  /**
   * Delete record
   */
  static async delete(
    table: SQLiteTable<any>,
    tableName: TableName,
    where: any,
    userId: string,
  ): Promise<any[]> {
    try {
      // Delete operation doesn't need encryption, but requires user permission verification
      const result = await db.delete(table).where(where).returning();

      databaseLogger.debug(`Deleted record from ${tableName}`, {
        operation: "encrypted_delete_v2",
        table: tableName,
        userId,
        deletedCount: result.length,
      });

      return result;
    } catch (error) {
      databaseLogger.error(`Failed to delete record from ${tableName}`, error, {
        operation: "encrypted_delete_v2_failed",
        table: tableName,
        userId,
      });
      throw error;
    }
  }

  /**
   * Health check - verify user encryption system
   */
  static async healthCheck(userId: string): Promise<boolean> {
    try {
      const status = DatabaseEncryption.getUserEncryptionStatus(userId);

      databaseLogger.debug("User encryption health check", {
        operation: "user_encryption_health_check",
        userId,
        status,
      });

      return status.canAccessData;
    } catch (error) {
      databaseLogger.error("User encryption health check failed", error, {
        operation: "user_encryption_health_check_failed",
        userId,
      });
      return false;
    }
  }

  /**
   * Batch operation: insert multiple records
   */
  static async batchInsert<T extends Record<string, any>>(
    table: SQLiteTable<any>,
    tableName: TableName,
    records: T[],
    userId: string,
  ): Promise<T[]> {
    const results: T[] = [];
    const errors: string[] = [];

    for (const record of records) {
      try {
        const result = await this.insert(table, tableName, record, userId);
        results.push(result);
      } catch (error) {
        const errorMsg = `Failed to insert record: ${error instanceof Error ? error.message : 'Unknown error'}`;
        errors.push(errorMsg);
        databaseLogger.error("Batch insert - record failed", error, {
          operation: "batch_insert_record_failed",
          tableName,
          userId,
        });
      }
    }

    if (errors.length > 0) {
      databaseLogger.warn(`Batch insert completed with ${errors.length} errors`, {
        operation: "batch_insert_partial_failure",
        tableName,
        userId,
        successCount: results.length,
        errorCount: errors.length,
        errors,
      });
    }

    return results;
  }

  /**
   * Check if table has unencrypted data (for migration detection)
   */
  static async checkUnencryptedData(
    query: any,
    tableName: TableName,
    userId: string,
  ): Promise<{
    hasUnencrypted: boolean;
    unencryptedCount: number;
    totalCount: number;
  }> {
    try {
      const records = await query;
      let unencryptedCount = 0;

      for (const record of records) {
        for (const [fieldName, value] of Object.entries(record)) {
          if (FieldEncryption.shouldEncryptField(tableName, fieldName) &&
              value &&
              !FieldEncryption.isEncrypted(value as string)) {
            unencryptedCount++;
            break; // Count each record only once
          }
        }
      }

      const result = {
        hasUnencrypted: unencryptedCount > 0,
        unencryptedCount,
        totalCount: records.length,
      };

      databaseLogger.info(`Unencrypted data check for ${tableName}`, {
        operation: "unencrypted_data_check",
        tableName,
        userId,
        ...result,
      });

      return result;
    } catch (error) {
      databaseLogger.error("Failed to check unencrypted data", error, {
        operation: "unencrypted_data_check_failed",
        tableName,
        userId,
      });
      throw error;
    }
  }

  /**
   * Get user's encryption operation statistics
   */
  static getUserOperationStats(userId: string) {
    const status = DatabaseEncryption.getUserEncryptionStatus(userId);

    return {
      userId,
      canAccessData: status.canAccessData,
      isUnlocked: status.isUnlocked,
      hasDataKey: status.hasDataKey,
      encryptionTestPassed: status.testPassed,
    };
  }
}

export { EncryptedDBOperations, type TableName };