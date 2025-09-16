import { db } from '../database/db/index.js';
import { DatabaseEncryption } from './database-encryption.js';
import { databaseLogger } from './logger.js';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

type TableName = 'users' | 'ssh_data' | 'ssh_credentials';

class EncryptedDBOperations {
  static async insert<T extends Record<string, any>>(
    table: SQLiteTable<any>,
    tableName: TableName,
    data: T
  ): Promise<T> {
    try {
      const encryptedData = DatabaseEncryption.encryptRecord(tableName, data);
      const result = await db.insert(table).values(encryptedData).returning();

      // Decrypt the returned data to ensure consistency
      const decryptedResult = DatabaseEncryption.decryptRecord(tableName, result[0]);

      databaseLogger.debug(`Inserted encrypted record into ${tableName}`, {
        operation: 'encrypted_insert',
        table: tableName
      });

      return decryptedResult as T;
    } catch (error) {
      databaseLogger.error(`Failed to insert encrypted record into ${tableName}`, error, {
        operation: 'encrypted_insert_failed',
        table: tableName
      });
      throw error;
    }
  }

  static async select<T extends Record<string, any>>(
    query: any,
    tableName: TableName
  ): Promise<T[]> {
    try {
      const results = await query;
      const decryptedResults = DatabaseEncryption.decryptRecords(tableName, results);

      databaseLogger.debug(`Selected and decrypted ${decryptedResults.length} records from ${tableName}`, {
        operation: 'encrypted_select',
        table: tableName,
        count: decryptedResults.length
      });

      return decryptedResults;
    } catch (error) {
      databaseLogger.error(`Failed to select/decrypt records from ${tableName}`, error, {
        operation: 'encrypted_select_failed',
        table: tableName
      });
      throw error;
    }
  }

  static async selectOne<T extends Record<string, any>>(
    query: any,
    tableName: TableName
  ): Promise<T | undefined> {
    try {
      const result = await query;
      if (!result) return undefined;

      const decryptedResult = DatabaseEncryption.decryptRecord(tableName, result);

      databaseLogger.debug(`Selected and decrypted single record from ${tableName}`, {
        operation: 'encrypted_select_one',
        table: tableName
      });

      return decryptedResult;
    } catch (error) {
      databaseLogger.error(`Failed to select/decrypt single record from ${tableName}`, error, {
        operation: 'encrypted_select_one_failed',
        table: tableName
      });
      throw error;
    }
  }

  static async update<T extends Record<string, any>>(
    table: SQLiteTable<any>,
    tableName: TableName,
    where: any,
    data: Partial<T>
  ): Promise<T[]> {
    try {
      const encryptedData = DatabaseEncryption.encryptRecord(tableName, data);
      const result = await db.update(table).set(encryptedData).where(where).returning();

      databaseLogger.debug(`Updated encrypted record in ${tableName}`, {
        operation: 'encrypted_update',
        table: tableName
      });

      return result as T[];
    } catch (error) {
      databaseLogger.error(`Failed to update encrypted record in ${tableName}`, error, {
        operation: 'encrypted_update_failed',
        table: tableName
      });
      throw error;
    }
  }

  static async delete(
    table: SQLiteTable<any>,
    tableName: TableName,
    where: any
  ): Promise<any[]> {
    try {
      const result = await db.delete(table).where(where).returning();

      databaseLogger.debug(`Deleted record from ${tableName}`, {
        operation: 'encrypted_delete',
        table: tableName
      });

      return result;
    } catch (error) {
      databaseLogger.error(`Failed to delete record from ${tableName}`, error, {
        operation: 'encrypted_delete_failed',
        table: tableName
      });
      throw error;
    }
  }

  static async migrateExistingRecords(tableName: TableName): Promise<number> {
    let migratedCount = 0;

    try {
      databaseLogger.info(`Starting encryption migration for ${tableName}`, {
        operation: 'migration_start',
        table: tableName
      });

      let table: SQLiteTable<any>;
      let records: any[];

      switch (tableName) {
        case 'users':
          const { users } = await import('../database/db/schema.js');
          table = users;
          records = await db.select().from(users);
          break;
        case 'ssh_data':
          const { sshData } = await import('../database/db/schema.js');
          table = sshData;
          records = await db.select().from(sshData);
          break;
        case 'ssh_credentials':
          const { sshCredentials } = await import('../database/db/schema.js');
          table = sshCredentials;
          records = await db.select().from(sshCredentials);
          break;
        default:
          throw new Error(`Unknown table: ${tableName}`);
      }

      for (const record of records) {
        try {
          const migratedRecord = await DatabaseEncryption.migrateRecord(tableName, record);

          if (JSON.stringify(migratedRecord) !== JSON.stringify(record)) {
            const { eq } = await import('drizzle-orm');
            await db.update(table).set(migratedRecord).where(eq((table as any).id, record.id));
            migratedCount++;
          }
        } catch (error) {
          databaseLogger.error(`Failed to migrate record ${record.id} in ${tableName}`, error, {
            operation: 'migration_record_failed',
            table: tableName,
            recordId: record.id
          });
        }
      }

      databaseLogger.success(`Migration completed for ${tableName}`, {
        operation: 'migration_complete',
        table: tableName,
        migratedCount,
        totalRecords: records.length
      });

      return migratedCount;
    } catch (error) {
      databaseLogger.error(`Migration failed for ${tableName}`, error, {
        operation: 'migration_failed',
        table: tableName
      });
      throw error;
    }
  }

  static async healthCheck(): Promise<boolean> {
    try {
      const status = DatabaseEncryption.getEncryptionStatus();
      return status.configValid && status.enabled;
    } catch (error) {
      databaseLogger.error('Encryption health check failed', error, {
        operation: 'health_check_failed'
      });
      return false;
    }
  }
}

export { EncryptedDBOperations };
export type { TableName };