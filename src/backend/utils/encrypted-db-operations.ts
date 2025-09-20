import { db } from "../database/db/index.js";
import { DatabaseEncryption } from "./database-encryption.js";
import { databaseLogger } from "./logger.js";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

type TableName = "users" | "ssh_data" | "ssh_credentials";

class EncryptedDBOperations {
  static async insert<T extends Record<string, any>>(
    table: SQLiteTable<any>,
    tableName: TableName,
    data: T,
  ): Promise<T> {
    try {
      const encryptedData = DatabaseEncryption.encryptRecord(tableName, data);
      const result = await db.insert(table).values(encryptedData).returning();

      // Decrypt the returned data to ensure consistency
      const decryptedResult = DatabaseEncryption.decryptRecord(
        tableName,
        result[0],
      );

      databaseLogger.debug(`Inserted encrypted record into ${tableName}`, {
        operation: "encrypted_insert",
        table: tableName,
      });

      return decryptedResult as T;
    } catch (error) {
      databaseLogger.error(
        `Failed to insert encrypted record into ${tableName}`,
        error,
        {
          operation: "encrypted_insert_failed",
          table: tableName,
        },
      );
      throw error;
    }
  }

  static async select<T extends Record<string, any>>(
    query: any,
    tableName: TableName,
  ): Promise<T[]> {
    try {
      const results = await query;
      const decryptedResults = DatabaseEncryption.decryptRecords(
        tableName,
        results,
      );

      return decryptedResults;
    } catch (error) {
      databaseLogger.error(
        `Failed to select/decrypt records from ${tableName}`,
        error,
        {
          operation: "encrypted_select_failed",
          table: tableName,
        },
      );
      throw error;
    }
  }

  static async selectOne<T extends Record<string, any>>(
    query: any,
    tableName: TableName,
  ): Promise<T | undefined> {
    try {
      const result = await query;
      if (!result) return undefined;

      const decryptedResult = DatabaseEncryption.decryptRecord(
        tableName,
        result,
      );

      return decryptedResult;
    } catch (error) {
      databaseLogger.error(
        `Failed to select/decrypt single record from ${tableName}`,
        error,
        {
          operation: "encrypted_select_one_failed",
          table: tableName,
        },
      );
      throw error;
    }
  }

  static async update<T extends Record<string, any>>(
    table: SQLiteTable<any>,
    tableName: TableName,
    where: any,
    data: Partial<T>,
  ): Promise<T[]> {
    try {
      const encryptedData = DatabaseEncryption.encryptRecord(tableName, data);
      const result = await db
        .update(table)
        .set(encryptedData)
        .where(where)
        .returning();

      databaseLogger.debug(`Updated encrypted record in ${tableName}`, {
        operation: "encrypted_update",
        table: tableName,
      });

      return result as T[];
    } catch (error) {
      databaseLogger.error(
        `Failed to update encrypted record in ${tableName}`,
        error,
        {
          operation: "encrypted_update_failed",
          table: tableName,
        },
      );
      throw error;
    }
  }

  static async delete(
    table: SQLiteTable<any>,
    tableName: TableName,
    where: any,
  ): Promise<any[]> {
    try {
      const result = await db.delete(table).where(where).returning();

      databaseLogger.debug(`Deleted record from ${tableName}`, {
        operation: "encrypted_delete",
        table: tableName,
      });

      return result;
    } catch (error) {
      databaseLogger.error(`Failed to delete record from ${tableName}`, error, {
        operation: "encrypted_delete_failed",
        table: tableName,
      });
      throw error;
    }
  }

  // Migration removed - no more backward compatibility
  static async migrateExistingRecords(tableName: TableName): Promise<number> {
    return 0; // No migration needed
  }

  static async healthCheck(): Promise<boolean> {
    try {
      const status = DatabaseEncryption.getEncryptionStatus();
      return status.configValid && status.enabled;
    } catch (error) {
      databaseLogger.error("Encryption health check failed", error, {
        operation: "health_check_failed",
      });
      return false;
    }
  }
}

export { EncryptedDBOperations };
export type { TableName };
