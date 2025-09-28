import { getDb, DatabaseSaveTrigger } from "../database/db/index.js";
import { DataCrypto } from "./data-crypto.js";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

type TableName = "users" | "ssh_data" | "ssh_credentials";

class SimpleDBOps {
  static async insert<T extends Record<string, any>>(
    table: SQLiteTable<any>,
    tableName: TableName,
    data: T,
    userId: string,
  ): Promise<T> {
    const userDataKey = DataCrypto.validateUserAccess(userId);

    const tempId = data.id || `temp-${userId}-${Date.now()}`;
    const dataWithTempId = { ...data, id: tempId };

    const encryptedData = DataCrypto.encryptRecord(
      tableName,
      dataWithTempId,
      userId,
      userDataKey,
    );

    if (!data.id) {
      delete encryptedData.id;
    }

    const result = await getDb()
      .insert(table)
      .values(encryptedData)
      .returning();

    DatabaseSaveTrigger.triggerSave(`insert_${tableName}`);

    const decryptedResult = DataCrypto.decryptRecord(
      tableName,
      result[0],
      userId,
      userDataKey,
    );

    return decryptedResult as T;
  }

  static async select<T extends Record<string, any>>(
    query: any,
    tableName: TableName,
    userId: string,
  ): Promise<T[]> {
    const userDataKey = DataCrypto.getUserDataKey(userId);
    if (!userDataKey) {
      return [];
    }

    const results = await query;

    const decryptedResults = DataCrypto.decryptRecords(
      tableName,
      results,
      userId,
      userDataKey,
    );

    return decryptedResults;
  }

  static async selectOne<T extends Record<string, any>>(
    query: any,
    tableName: TableName,
    userId: string,
  ): Promise<T | undefined> {
    const userDataKey = DataCrypto.getUserDataKey(userId);
    if (!userDataKey) {
      return undefined;
    }

    const result = await query;
    if (!result) return undefined;

    const decryptedResult = DataCrypto.decryptRecord(
      tableName,
      result,
      userId,
      userDataKey,
    );

    return decryptedResult;
  }

  static async update<T extends Record<string, any>>(
    table: SQLiteTable<any>,
    tableName: TableName,
    where: any,
    data: Partial<T>,
    userId: string,
  ): Promise<T[]> {
    const userDataKey = DataCrypto.validateUserAccess(userId);

    const encryptedData = DataCrypto.encryptRecord(
      tableName,
      data,
      userId,
      userDataKey,
    );

    const result = await getDb()
      .update(table)
      .set(encryptedData)
      .where(where)
      .returning();

    DatabaseSaveTrigger.triggerSave(`update_${tableName}`);

    const decryptedResults = DataCrypto.decryptRecords(
      tableName,
      result,
      userId,
      userDataKey,
    );

    return decryptedResults as T[];
  }

  static async delete(
    table: SQLiteTable<any>,
    tableName: TableName,
    where: any,
    userId: string,
  ): Promise<any[]> {
    const result = await getDb().delete(table).where(where).returning();

    DatabaseSaveTrigger.triggerSave(`delete_${tableName}`);

    return result;
  }

  static async healthCheck(userId: string): Promise<boolean> {
    return DataCrypto.canUserAccessData(userId);
  }

  static isUserDataUnlocked(userId: string): boolean {
    return DataCrypto.getUserDataKey(userId) !== null;
  }

  static async selectEncrypted(
    query: any,
    tableName: TableName,
  ): Promise<any[]> {
    const results = await query;

    return results;
  }
}

export { SimpleDBOps, type TableName };
