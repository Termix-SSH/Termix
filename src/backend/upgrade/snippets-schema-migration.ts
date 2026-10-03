import type Database from "better-sqlite3";

/** Repair older SQLite tables before adoption, or after an incomplete 2.9 upgrade. */
export function repairSnippetsNoteColumn(sqlite: Database.Database): void {
  for (const table of ["snippets", "p_snippets_snippets"]) {
    const columns = sqlite.pragma(`table_info("${table}")`) as Array<{
      name: string;
    }>;
    if (
      columns.length === 0 ||
      columns.some(({ name }) => name === "is_note")
    ) {
      continue;
    }
    sqlite.exec(
      `ALTER TABLE "${table}" ADD COLUMN "is_note" INTEGER NOT NULL DEFAULT 0`,
    );
  }
}
