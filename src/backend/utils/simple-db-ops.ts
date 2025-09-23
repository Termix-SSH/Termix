import { getDb, DatabaseSaveTrigger } from "../database/db/index.js";
import { DataCrypto } from "./data-crypto.js";
import { databaseLogger } from "./logger.js";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

type TableName = "users" | "ssh_data" | "ssh_credentials";

/**
 * SimpleDBOps - Simplified encrypted database operations
 *
 * Linus-style simplification:
 * - Remove all complex abstraction layers
 * - Direct CRUD operations
 * - Automatic encryption/decryption
 * - No special case handling
 */
class SimpleDBOps {
  /**
   * Insert encrypted record
   */
  static async insert<T extends Record<string, any>>(
    table: SQLiteTable<any>,
    tableName: TableName,
    data: T,
    userId: string,
  ): Promise<T> {
    // Get user data key once and reuse throughout operation
    const userDataKey = DataCrypto.validateUserAccess(userId);

    // Generate consistent temporary ID for encryption context if record has no ID
    const tempId = data.id || `temp-${userId}-${Date.now()}`;
    const dataWithTempId = { ...data, id: tempId };

    // Encrypt data using the locked key - recordId will be stored in encrypted fields
    const encryptedData = DataCrypto.encryptRecord(tableName, dataWithTempId, userId, userDataKey);

    // Remove temp ID if it was generated, let database assign real ID
    if (!data.id) {
      delete encryptedData.id;
    }

    // Insert into database
    const result = await getDb().insert(table).values(encryptedData).returning();

    // Trigger database save after insert
    DatabaseSaveTrigger.triggerSave(`insert_${tableName}`);

    // Decrypt return result using the same key - FieldCrypto will use stored recordId
    const decryptedResult = DataCrypto.decryptRecord(
      tableName,
      result[0],
      userId,
      userDataKey
    );

    databaseLogger.debug(`Inserted encrypted record into ${tableName}`, {
      operation: "simple_insert",
      table: tableName,
      userId,
      recordId: result[0].id,
    });

    return decryptedResult as T;
  }

  /**
   * Query multiple records
   */
  static async select<T extends Record<string, any>>(
    query: any,
    tableName: TableName,
    userId: string,
  ): Promise<T[]> {
    // Get user data key once and reuse throughout operation
    const userDataKey = DataCrypto.validateUserAccess(userId);

    // Execute query
    const results = await query;

    // Decrypt results using locked key
    const decryptedResults = DataCrypto.decryptRecords(
      tableName,
      results,
      userId,
      userDataKey
    );

    return decryptedResults;
  }

  /**
   * Query single record
   */
  static async selectOne<T extends Record<string, any>>(
    query: any,
    tableName: TableName,
    userId: string,
  ): Promise<T | undefined> {
    // Get user data key once and reuse throughout operation
    const userDataKey = DataCrypto.validateUserAccess(userId);

    // Execute query
    const result = await query;
    if (!result) return undefined;

    // Decrypt results using locked key
    const decryptedResult = DataCrypto.decryptRecord(
      tableName,
      result,
      userId,
      userDataKey
    );

    databaseLogger.debug(`Selected single record from ${tableName}`, {
      operation: "simple_select_one",
      table: tableName,
      userId,
      recordId: result.id,
    });

    return decryptedResult;
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
    // Get user data key once and reuse throughout operation
    const userDataKey = DataCrypto.validateUserAccess(userId);

    // Encrypt update data using the locked key
    const encryptedData = DataCrypto.encryptRecord(tableName, data, userId, userDataKey);

    // Execute update
    const result = await getDb()
      .update(table)
      .set(encryptedData)
      .where(where)
      .returning();

    // Decrypt return data using the same key
    const decryptedResults = DataCrypto.decryptRecords(
      tableName,
      result,
      userId,
      userDataKey
    );

    databaseLogger.debug(`Updated records in ${tableName}`, {
      operation: "simple_update",
      table: tableName,
      userId,
      updatedCount: result.length,
    });

    return decryptedResults as T[];
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
    const result = await getDb().delete(table).where(where).returning();

    // Trigger database save after delete
    DatabaseSaveTrigger.triggerSave(`delete_${tableName}`);

    return result;
  }

  /**
   * Health check
   */
  static async healthCheck(userId: string): Promise<boolean> {
    return DataCrypto.canUserAccessData(userId);
  }

  /**
   * Special method: return encrypted data (for auto-start scenarios)
   * No decryption, return data in encrypted state directly
   */
  static async selectEncrypted(query: any, tableName: TableName): Promise<any[]> {
    // Execute query directly, no decryption
    const results = await query;

    return results;
  }
}

export { SimpleDBOps, type TableName };