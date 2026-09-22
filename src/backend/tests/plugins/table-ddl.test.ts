import { describe, expect, it } from "vitest";
import {
  defineTable,
  id,
  varchar,
  text,
  json,
  boolean,
  timestamp,
  integer,
  bigint,
  encryptedText,
  refUser,
  refHost,
  prefixedTableName,
  tablePrefix,
} from "@termix/plugin-sdk/db";
import {
  createTableSql,
  dropTableSql,
  addColumnSql,
  keyedColumns,
  buildTable,
} from "../../plugins/table-builder.js";

/**
 * The three-dialect DDL is what verify:dialect would catch against a real
 * server, and that needs a live Postgres and MySQL. These snapshots are what
 * covers it in a run that has neither.
 */
const definition = defineTable(
  "note",
  {
    id: id(),
    userId: refUser(),
    hostId: refHost(),
    title: varchar(200).notNull(),
    body: text(),
    meta: json(),
    secret: encryptedText(),
    pinned: boolean().default(false),
    position: integer().default(0),
    size: bigint(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  {
    uniques: [{ name: "idx_note_user_title", columns: ["userId", "title"] }],
    indexes: [{ name: "idx_note_host", columns: ["hostId"] }],
  },
);

describe("table naming", () => {
  it("prefixes with the plugin id, dashes becoming underscores", () => {
    expect(tablePrefix("network-topology")).toBe("p_network_topology_");
    expect(prefixedTableName("network-topology", "graph")).toBe(
      "p_network_topology_graph",
    );
  });
});

describe("defineTable validation", () => {
  it("refuses an index on an unbounded text column", () => {
    expect(() =>
      defineTable(
        "bad",
        { id: id(), body: text() },
        { indexes: [{ name: "idx_bad", columns: ["body"] }] },
      ),
    ).toThrow(/MySQL cannot index an unbounded column/);
  });

  it("refuses an index on a json column", () => {
    expect(() =>
      defineTable(
        "bad",
        { id: id(), meta: json() },
        { indexes: [{ name: "idx_bad", columns: ["meta"] }] },
      ),
    ).toThrow(/MySQL cannot index an unbounded column/);
  });

  it("refuses an index naming a column the table does not declare", () => {
    expect(() =>
      defineTable(
        "bad",
        { id: id() },
        { indexes: [{ name: "idx_bad", columns: ["nope"] }] },
      ),
    ).toThrow(/which table "bad" does not declare/);
  });

  it("refuses a table name that is not lower snake_case", () => {
    expect(() => defineTable("Notes", { id: id() })).toThrow(
      /lower snake_case/,
    );
  });

  it("refuses a table with no columns", () => {
    expect(() => defineTable("empty", {})).toThrow(/declares no columns/);
  });

  it("treats uniques as indexes that happen to be unique", () => {
    const table = defineTable(
      "thing",
      { id: id(), name: varchar(50) },
      { uniques: [{ name: "idx_thing_name", columns: ["name"] }] },
    );

    expect(table.indexes[0]).toMatchObject({
      name: "idx_thing_name",
      unique: true,
    });
  });
});

describe("keyedColumns", () => {
  it("counts primary keys, uniques, refs and indexed columns", () => {
    const keyed = keyedColumns(definition);

    expect(keyed.has("userId")).toBe(true);
    expect(keyed.has("hostId")).toBe(true);
    expect(keyed.has("title")).toBe(true);
    // Not keyed, so it stays TEXT and is not narrowed to varchar(255).
    expect(keyed.has("body")).toBe(false);
    expect(keyed.has("meta")).toBe(false);
  });
});

describe("createTableSql", () => {
  it("emits sqlite DDL", () => {
    expect(createTableSql("sqlite", "demo", definition).join("\n"))
      .toMatchInlineSnapshot(`
      "CREATE TABLE IF NOT EXISTS "p_demo_note" (
        "id" integer PRIMARY KEY AUTOINCREMENT,
        "user_id" text NOT NULL,
        "host_id" integer NOT NULL,
        "title" text NOT NULL,
        "body" text,
        "meta" text,
        "secret" text,
        "pinned" integer DEFAULT 0,
        "position" integer DEFAULT 0,
        "size" integer,
        "created_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
        FOREIGN KEY ("host_id") REFERENCES "ssh_data" ("id") ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_note_user_title" ON "p_demo_note" ("user_id", "title");
      CREATE INDEX IF NOT EXISTS "idx_note_host" ON "p_demo_note" ("host_id");"
    `);
  });

  it("emits postgres DDL with serial and native booleans", () => {
    expect(createTableSql("postgres", "demo", definition).join("\n"))
      .toMatchInlineSnapshot(`
      "CREATE TABLE IF NOT EXISTS "p_demo_note" (
        "id" serial PRIMARY KEY,
        "user_id" varchar(255) NOT NULL,
        "host_id" integer NOT NULL,
        "title" varchar(200) NOT NULL,
        "body" text,
        "meta" text,
        "secret" text,
        "pinned" boolean DEFAULT false,
        "position" integer DEFAULT 0,
        "size" bigint,
        "created_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
        FOREIGN KEY ("host_id") REFERENCES "ssh_data" ("id") ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_note_user_title" ON "p_demo_note" ("user_id", "title");
      CREATE INDEX IF NOT EXISTS "idx_note_host" ON "p_demo_note" ("host_id");"
    `);
  });

  it("emits mysql DDL with backticks and a parenthesised timestamp default", () => {
    expect(createTableSql("mysql", "demo", definition).join("\n"))
      .toMatchInlineSnapshot(`
      "CREATE TABLE IF NOT EXISTS \`p_demo_note\` (
        \`id\` int AUTO_INCREMENT PRIMARY KEY,
        \`user_id\` varchar(255) NOT NULL,
        \`host_id\` int NOT NULL,
        \`title\` varchar(200) NOT NULL,
        \`body\` text,
        \`meta\` text,
        \`secret\` text,
        \`pinned\` boolean DEFAULT false,
        \`position\` int DEFAULT 0,
        \`size\` bigint,
        \`created_at\` text NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE,
        FOREIGN KEY (\`host_id\`) REFERENCES \`ssh_data\` (\`id\`) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX \`idx_note_user_title\` ON \`p_demo_note\` (\`user_id\`, \`title\`);
      CREATE INDEX \`idx_note_host\` ON \`p_demo_note\` (\`host_id\`);"
    `);
  });

  it("never leaves an indexed column as TEXT off sqlite", () => {
    // MySQL 8 rejects a TEXT column in a key specification. MariaDB accepts
    // it, which is why this was missed in core until a real MySQL saw it.
    for (const dialect of ["postgres", "mysql"] as const) {
      const sql = createTableSql(dialect, "demo", definition).join("\n");
      const keyed = keyedColumns(definition);
      for (const property of keyed) {
        const column = property.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
        const line = sql
          .split("\n")
          .find(
            (row) => row.includes(`${column}\``) || row.includes(`"${column}"`),
          );
        expect(line, `${dialect}.${column}`).not.toMatch(/\s(text|json)[,\s]/);
      }
    }
  });

  it("omits IF NOT EXISTS on a mysql index, which does not support it", () => {
    const mysql = createTableSql("mysql", "demo", definition);
    const indexes = mysql.filter((statement) => statement.includes("INDEX"));

    expect(indexes).not.toHaveLength(0);
    for (const statement of indexes) {
      expect(statement).not.toContain("IF NOT EXISTS");
    }
  });
});

describe("addColumnSql", () => {
  it("emits an ALTER per dialect", () => {
    expect(addColumnSql("sqlite", "demo", definition, "body")).toBe(
      'ALTER TABLE "p_demo_note" ADD COLUMN "body" text;',
    );
    expect(addColumnSql("mysql", "demo", definition, "title")).toBe(
      "ALTER TABLE `p_demo_note` ADD COLUMN `title` varchar(200) NOT NULL;",
    );
  });
});

describe("dropTableSql", () => {
  it("drops the prefixed table", () => {
    expect(dropTableSql("postgres", "demo", definition)).toBe(
      'DROP TABLE IF EXISTS "p_demo_note";',
    );
  });
});

describe("buildTable", () => {
  it("builds a queryable drizzle table carrying the prefixed name", async () => {
    const { getTableName, getTableColumns } = await import("drizzle-orm");
    const table = buildTable("demo", definition) as never;

    expect(getTableName(table)).toBe("p_demo_note");
    expect(Object.keys(getTableColumns(table))).toContain("userId");
  });
});
