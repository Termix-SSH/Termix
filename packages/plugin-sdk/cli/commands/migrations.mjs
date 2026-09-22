/**
 * Generates a plugin's migrations from its table definitions.
 *
 * Not drizzle-kit. Core's own SQLite schema is hand-written DDL and only the
 * client-server engines use drizzle migrations, so a plugin on drizzle-kit
 * would still need a hand-rolled SQLite path, three configs and three
 * generated schema modules. This diffs the definitions against a committed
 * snapshot and writes plain SQL for all three dialects, which is what the
 * server's runner applies.
 *
 * Usage, from a plugin directory:
 *   termix-plugin migrations [name]
 *   termix-plugin migrations --check    verifies nothing is undeclared
 *
 * The plugin exports its definitions from src/backend/tables.ts as `tables`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { BACKEND_EXTERNALS } from "../lib/externals.mjs";
import { readManifest, resolveEntry } from "../lib/plugin-dir.mjs";

const DIALECTS = ["sqlite", "postgres", "mysql"];

const TABLE_ENTRIES = [
  "src/backend/tables.ts",
  "src/backend/tables.mjs",
  "src/backend/tables.js",
];

/** Loads the plugin's table definitions by bundling them to a temp file. */
async function loadDefinitions(cwd) {
  const entry = resolveEntry(cwd, TABLE_ENTRIES);
  if (!entry) return null;

  // Emitted inside the plugin rather than in the system temp dir: the SDK
  // stays external to the bundle, so the output has to sit somewhere node can
  // resolve @termix/plugin-sdk from.
  const outdir = fs.mkdtempSync(path.join(cwd, ".termix-tables-"));
  const outfile = path.join(outdir, "tables.mjs");

  try {
    await esbuild.build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22",
      logLevel: "warning",
      external: BACKEND_EXTERNALS,
    });

    const module = await import(`file://${outfile.split(path.sep).join("/")}`);
    const tables = module.tables ?? module.default;
    if (!Array.isArray(tables)) {
      throw new Error(
        `${path.relative(cwd, entry)} must export a "tables" array of defineTable() results`,
      );
    }
    return tables;
  } finally {
    fs.rmSync(outdir, { recursive: true, force: true });
  }
}

function snapshotPath(cwd) {
  return path.join(cwd, "migrations", "snapshot.json");
}

function readSnapshot(cwd) {
  const file = snapshotPath(cwd);
  if (!fs.existsSync(file)) return { version: 1, tables: {} };
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** What a definition looks like in the snapshot, so a diff can compare them. */
function snapshotTable(definition) {
  return {
    columns: definition.columns,
    indexes: definition.indexes,
  };
}

function nextSequence(cwd) {
  let highest = 0;
  for (const dialect of DIALECTS) {
    const dir = path.join(cwd, "migrations", dialect);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      const match = /^(\d{4})_/.exec(file);
      if (match) highest = Math.max(highest, Number(match[1]));
    }
  }
  return highest + 1;
}

/**
 * What changed since the snapshot.
 *
 * New tables and new columns are generated. A changed or removed column is
 * reported rather than guessed at: renames and type changes need a data
 * decision this cannot make, so the author writes that migration by hand.
 */
function diff(previous, definitions) {
  const created = [];
  const added = [];
  const manual = [];

  for (const definition of definitions) {
    const before = previous.tables[definition.name];
    if (!before) {
      created.push(definition);
      continue;
    }

    for (const [property, column] of Object.entries(definition.columns)) {
      const existing = before.columns[property];
      if (!existing) {
        added.push({ definition, property, column });
        continue;
      }
      if (JSON.stringify(existing) !== JSON.stringify(column)) {
        manual.push(`${definition.name}.${property} changed type or modifiers`);
      }
    }

    for (const property of Object.keys(before.columns)) {
      if (!definition.columns[property]) {
        manual.push(`${definition.name}.${property} was removed`);
      }
    }
  }

  for (const name of Object.keys(previous.tables)) {
    if (!definitions.some((definition) => definition.name === name)) {
      manual.push(`table ${name} was removed`);
    }
  }

  return { created, added, manual };
}

export async function migrations({ cwd, args }) {
  const manifest = readManifest(cwd);
  const pluginId = manifest.id ?? path.basename(cwd);
  const check = args.includes("--check");
  const name = args.find((arg) => !arg.startsWith("--")) ?? "update";

  const definitions = await loadDefinitions(cwd);
  if (definitions === null) {
    console.log(`${pluginId}: no table definitions, nothing to generate`);
    return;
  }

  const { createTableSql, addColumnSql } = await loadEmitter();

  const previous = readSnapshot(cwd);
  const { created, added, manual } = diff(previous, definitions);

  if (manual.length > 0) {
    for (const problem of manual) console.error(`  ${problem}`);
    throw new Error(
      `${pluginId}: these changes need a hand-written migration, because a rename or a type change is a data decision.`,
    );
  }

  if (created.length === 0 && added.length === 0) {
    console.log(`${pluginId}: migrations are up to date`);
    return;
  }

  if (check) {
    throw new Error(
      `${pluginId}: table definitions have changed but no migration was generated. Run: termix-plugin migrations`,
    );
  }

  const sequence = String(nextSequence(cwd)).padStart(4, "0");
  const file = `${sequence}_${name.replace(/[^a-z0-9_]/gi, "_").toLowerCase()}.sql`;

  for (const dialect of DIALECTS) {
    const statements = [];
    for (const definition of created) {
      statements.push(...createTableSql(dialect, pluginId, definition));
    }
    for (const entry of added) {
      statements.push(
        addColumnSql(dialect, pluginId, entry.definition, entry.property),
      );
    }

    const dir = path.join(cwd, "migrations", dialect);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, file),
      `-- ${pluginId} ${sequence}: ${name}\n-- Generated by termix-plugin migrations. Review before committing.\n\n${statements.join("\n")}\n`,
    );
  }

  const snapshot = { version: 1, tables: {} };
  for (const definition of definitions) {
    snapshot.tables[definition.name] = snapshotTable(definition);
  }
  fs.writeFileSync(snapshotPath(cwd), `${JSON.stringify(snapshot, null, 2)}\n`);

  console.log(
    `${pluginId}: wrote ${DIALECTS.length} dialect files for ${sequence}_${name}`,
  );
}

/**
 * The DDL emitter, shared with the server.
 *
 * One mapping, two consumers: the SQL written here is the SQL the server's
 * migration runner applies, so a second copy could drift into producing a
 * migration the runner cannot reproduce.
 */
async function loadEmitter() {
  const entry = new URL("../../dist/ddl.js", import.meta.url);
  if (!fs.existsSync(fileURLToPath(entry))) {
    throw new Error("The plugin SDK is not built yet. Run: npm run build:sdk");
  }
  return import(entry.href);
}
