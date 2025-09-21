import { db } from "../database/db/index.js";
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
    // Verify user access permissions
    if (!DataCrypto.canUserAccessData(userId)) {
      throw new Error(`User ${userId} data not unlocked`);
    }

    // Encrypt data
    const encryptedData = DataCrypto.encryptRecordForUser(tableName, data, userId);

    // Insert into database
    const result = await db.insert(table).values(encryptedData).returning();

    // Decrypt return result
    const decryptedResult = DataCrypto.decryptRecordForUser(
      tableName,
      result[0],
      userId
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
    // Verify user access permissions
    if (!DataCrypto.canUserAccessData(userId)) {
      throw new Error(`User ${userId} data not unlocked`);
    }

    // Execute query
    const results = await query;

    // Decrypt results
    const decryptedResults = DataCrypto.decryptRecordsForUser(
      tableName,
      results,
      userId
    );

    databaseLogger.debug(`Selected ${decryptedResults.length} records from ${tableName}`, {
      operation: "simple_select",
      table: tableName,
      userId,
      recordCount: decryptedResults.length,
    });

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
    // Verify user access permissions
    if (!DataCrypto.canUserAccessData(userId)) {
      throw new Error(`User ${userId} data not unlocked`);
    }

    // Execute query
    const result = await query;
    if (!result) return undefined;

    // Decrypt results
    const decryptedResult = DataCrypto.decryptRecordForUser(
      tableName,
      result,
      userId
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
    // Verify user access permissions
    if (!DataCrypto.canUserAccessData(userId)) {
      throw new Error(`User ${userId} data not unlocked`);
    }

    // Encrypt update data
    const encryptedData = DataCrypto.encryptRecordForUser(tableName, data, userId);

    // Execute update
    const result = await db
      .update(table)
      .set(encryptedData)
      .where(where)
      .returning();

    // Decrypt return data
    const decryptedResults = DataCrypto.decryptRecordsForUser(
      tableName,
      result,
      userId
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
    const result = await db.delete(table).where(where).returning();

    databaseLogger.debug(`Deleted records from ${tableName}`, {
      operation: "simple_delete",
      table: tableName,
      userId,
      deletedCount: result.length,
    });

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

    databaseLogger.debug(`Selected ${results.length} encrypted records from ${tableName}`, {
      operation: "simple_select_encrypted",
      table: tableName,
      recordCount: results.length,
    });

    return results;
  }
}

export { SimpleDBOps, type TableName };