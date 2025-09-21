import { db } from "../database/db/index.js";
import { DataCrypto } from "./data-crypto.js";
import { databaseLogger } from "./logger.js";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

type TableName = "users" | "ssh_data" | "ssh_credentials";

/**
 * SimpleDBOps - 简化的加密数据库操作
 *
 * Linus式简化：
 * - 删除所有复杂的抽象层
 * - 直接的CRUD操作
 * - 自动加密/解密
 * - 没有特殊情况处理
 */
class SimpleDBOps {
  /**
   * 插入加密记录
   */
  static async insert<T extends Record<string, any>>(
    table: SQLiteTable<any>,
    tableName: TableName,
    data: T,
    userId: string,
  ): Promise<T> {
    // 验证用户访问权限
    if (!DataCrypto.canUserAccessData(userId)) {
      throw new Error(`User ${userId} data not unlocked`);
    }

    // 加密数据
    const encryptedData = DataCrypto.encryptRecordForUser(tableName, data, userId);

    // 插入数据库
    const result = await db.insert(table).values(encryptedData).returning();

    // 解密返回结果
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
   * 查询多条记录
   */
  static async select<T extends Record<string, any>>(
    query: any,
    tableName: TableName,
    userId: string,
  ): Promise<T[]> {
    // 验证用户访问权限
    if (!DataCrypto.canUserAccessData(userId)) {
      throw new Error(`User ${userId} data not unlocked`);
    }

    // 执行查询
    const results = await query;

    // 解密结果
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
   * 查询单条记录
   */
  static async selectOne<T extends Record<string, any>>(
    query: any,
    tableName: TableName,
    userId: string,
  ): Promise<T | undefined> {
    // 验证用户访问权限
    if (!DataCrypto.canUserAccessData(userId)) {
      throw new Error(`User ${userId} data not unlocked`);
    }

    // 执行查询
    const result = await query;
    if (!result) return undefined;

    // 解密结果
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
   * 更新记录
   */
  static async update<T extends Record<string, any>>(
    table: SQLiteTable<any>,
    tableName: TableName,
    where: any,
    data: Partial<T>,
    userId: string,
  ): Promise<T[]> {
    // 验证用户访问权限
    if (!DataCrypto.canUserAccessData(userId)) {
      throw new Error(`User ${userId} data not unlocked`);
    }

    // 加密更新数据
    const encryptedData = DataCrypto.encryptRecordForUser(tableName, data, userId);

    // 执行更新
    const result = await db
      .update(table)
      .set(encryptedData)
      .where(where)
      .returning();

    // 解密返回数据
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
   * 删除记录
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
   * 健康检查
   */
  static async healthCheck(userId: string): Promise<boolean> {
    return DataCrypto.canUserAccessData(userId);
  }

  /**
   * 特殊方法：返回加密数据（用于自动启动等场景）
   * 不解密，直接返回加密状态的数据
   */
  static async selectEncrypted(query: any, tableName: TableName): Promise<any[]> {
    // 直接执行查询，不进行解密
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