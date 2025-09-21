import { db } from "../database/db/index.js";
import { databaseLogger } from "./logger.js";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

type TableName = "users" | "ssh_data" | "ssh_credentials";

/**
 * EncryptedDBOperationsAdmin - Admin-level database operations
 *
 * Warning:
 * - This is a temporary solution for handling global services that need cross-user access
 * - Returned data is still encrypted and needs to be decrypted by each user
 * - Only used for system-level services like server-stats
 * - In production, these services' architecture should be redesigned
 */
class EncryptedDBOperationsAdmin {
  /**
   * Select encrypted records (no decryption) - for admin functions only
   *
   * Warning: Returned data is still encrypted!
   */
  static async selectEncrypted<T extends Record<string, any>>(
    query: any,
    tableName: TableName,
  ): Promise<T[]> {
    try {
      const results = await query;

      databaseLogger.warn(`Admin-level encrypted data access for ${tableName}`, {
        operation: "admin_encrypted_select",
        table: tableName,
        recordCount: results.length,
        warning: "Data returned is still encrypted",
      });

      return results;
    } catch (error) {
      databaseLogger.error(
        `Failed to select encrypted records from ${tableName}`,
        error,
        {
          operation: "admin_encrypted_select_failed",
          table: tableName,
        },
      );
      throw error;
    }
  }

  /**
   * Insert encrypted record (expected input already encrypted) - for admin functions only
   */
  static async insertEncrypted<T extends Record<string, any>>(
    table: SQLiteTable<any>,
    tableName: TableName,
    data: T,
  ): Promise<T> {
    try {
      const result = await db.insert(table).values(data).returning();

      databaseLogger.warn(`Admin-level encrypted data insertion for ${tableName}`, {
        operation: "admin_encrypted_insert",
        table: tableName,
        warning: "Data expected to be pre-encrypted",
      });

      return result[0] as T;
    } catch (error) {
      databaseLogger.error(
        `Failed to insert encrypted record into ${tableName}`,
        error,
        {
          operation: "admin_encrypted_insert_failed",
          table: tableName,
        },
      );
      throw error;
    }
  }

  /**
   * Update encrypted record (expected input already encrypted) - for admin functions only
   */
  static async updateEncrypted<T extends Record<string, any>>(
    table: SQLiteTable<any>,
    tableName: TableName,
    where: any,
    data: Partial<T>,
  ): Promise<T[]> {
    try {
      const result = await db
        .update(table)
        .set(data)
        .where(where)
        .returning();

      databaseLogger.warn(`Admin-level encrypted data update for ${tableName}`, {
        operation: "admin_encrypted_update",
        table: tableName,
        warning: "Data expected to be pre-encrypted",
      });

      return result as T[];
    } catch (error) {
      databaseLogger.error(
        `Failed to update encrypted record in ${tableName}`,
        error,
        {
          operation: "admin_encrypted_update_failed",
          table: tableName,
        },
      );
      throw error;
    }
  }

  /**
   * Delete record - for admin functions only
   */
  static async delete(
    table: SQLiteTable<any>,
    tableName: TableName,
    where: any,
  ): Promise<any[]> {
    try {
      const result = await db.delete(table).where(where).returning();

      databaseLogger.warn(`Admin-level data deletion for ${tableName}`, {
        operation: "admin_delete",
        table: tableName,
      });

      return result;
    } catch (error) {
      databaseLogger.error(`Failed to delete record from ${tableName}`, error, {
        operation: "admin_delete_failed",
        table: tableName,
      });
      throw error;
    }
  }
}

export { EncryptedDBOperationsAdmin };
export type { TableName };