import Database from "better-sqlite3";
import { databaseLogger } from "./logger.js";

interface LegacyTableDefinition {
  name: string;
  sql: string;
}

export interface LegacyDatabaseCopyResult {
  buffer: Buffer;
  migratedTables: number;
  migratedRows: number;
}

export class LegacySqliteDatabaseCopyStore {
  copyDatabaseToMemoryBuffer(sourcePath: string): LegacyDatabaseCopyResult {
    const originalDb = new Database(sourcePath, { readonly: true });
    const memoryDb = new Database(":memory:");

    try {
      const tables = this.listTableDefinitions(originalDb);
      let migratedTables = 0;
      let migratedRows = 0;

      for (const table of tables) {
        memoryDb.exec(table.sql);
        migratedTables++;
      }

      memoryDb.exec("PRAGMA foreign_keys = OFF");

      for (const table of tables) {
        migratedRows += this.copyTableRows(originalDb, memoryDb, table.name);
      }

      memoryDb.exec("PRAGMA foreign_keys = ON");
      this.assertNoForeignKeyViolations(memoryDb);
      this.assertRowCountsMatch(originalDb, memoryDb);

      return {
        buffer: memoryDb.serialize(),
        migratedTables,
        migratedRows,
      };
    } finally {
      originalDb.close();
      memoryDb.close();
    }
  }

  private listTableDefinitions(db: Database.Database): LegacyTableDefinition[] {
    return db
      .prepare(
        `
          SELECT name, sql FROM sqlite_master
          WHERE type='table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name
        `,
      )
      .all() as LegacyTableDefinition[];
  }

  private listTableNames(db: Database.Database): string[] {
    return db
      .prepare(
        `
          SELECT name FROM sqlite_master
          WHERE type='table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name
        `,
      )
      .all()
      .map((table) => (table as { name: string }).name);
  }

  private copyTableRows(
    originalDb: Database.Database,
    memoryDb: Database.Database,
    tableName: string,
  ): number {
    const rows = originalDb
      .prepare(`SELECT * FROM ${tableName}`)
      .all() as Record<string, unknown>[];

    if (rows.length === 0) {
      return 0;
    }

    const columns = Object.keys(rows[0]);
    const placeholders = columns.map(() => "?").join(", ");
    const insertStmt = memoryDb.prepare(
      `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${placeholders})`,
    );

    const insertTransaction = memoryDb.transaction(
      (dataRows: Record<string, unknown>[]) => {
        for (const row of dataRows) {
          insertStmt.run(columns.map((column) => row[column]));
        }
      },
    );

    insertTransaction(rows);
    return rows.length;
  }

  private assertNoForeignKeyViolations(memoryDb: Database.Database): void {
    const fkCheckResult = memoryDb.prepare("PRAGMA foreign_key_check").all();
    if (fkCheckResult.length === 0) {
      return;
    }

    databaseLogger.error(
      "Foreign key constraints violations detected after migration",
      null,
      {
        operation: "migration_fk_check_failed",
        violations: fkCheckResult,
      },
    );
    throw new Error(
      `Foreign key violations detected: ${JSON.stringify(fkCheckResult)}`,
    );
  }

  private assertRowCountsMatch(
    originalDb: Database.Database,
    memoryDb: Database.Database,
  ): void {
    const originalTables = this.listTableNames(originalDb);
    const memoryTables = this.listTableNames(memoryDb);

    if (originalTables.length !== memoryTables.length) {
      databaseLogger.error(
        "Table count mismatch during migration verification",
        null,
        {
          operation: "migration_verify_failed",
          originalCount: originalTables.length,
          memoryCount: memoryTables.length,
        },
      );
      throw new Error("Migration integrity verification failed");
    }

    for (const tableName of originalTables) {
      const originalCount = originalDb
        .prepare(`SELECT COUNT(*) as count FROM ${tableName}`)
        .get() as { count: number };
      const memoryCount = memoryDb
        .prepare(`SELECT COUNT(*) as count FROM ${tableName}`)
        .get() as { count: number };

      if (originalCount.count !== memoryCount.count) {
        databaseLogger.error(
          "Row count mismatch for table during migration verification",
          null,
          {
            operation: "migration_verify_table_failed",
            table: tableName,
            originalRows: originalCount.count,
            memoryRows: memoryCount.count,
          },
        );
        throw new Error("Migration integrity verification failed");
      }
    }
  }
}
