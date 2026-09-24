import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readManifest } from "../lib/plugin-dir.mjs";
import { LEGACY_TABLE_OWNERS as LEGACY_TABLES } from "../../dist/db.js";

/**
 * The manifest rules live in src/manifest.ts, which the server uses too, so
 * there is one implementation rather than a copy here that drifts.
 */
async function loadParseManifest() {
  const entry = new URL("../../dist/manifest.js", import.meta.url);
  if (!fs.existsSync(fileURLToPath(entry))) {
    throw new Error("The plugin SDK is not built yet. Run: npm run build:sdk");
  }
  const mod = await import(entry.href);
  return mod.parseManifest;
}

export async function validate({ cwd }) {
  const raw = readManifest(cwd);
  const parseManifest = await loadParseManifest();
  const { errors } = parseManifest(raw);

  const problems = [...errors];

  // The manifest names files. They have to be there.
  const referenced = [
    raw.backend ?? "dist/backend.js",
    raw.frontend ?? "dist/frontend.js",
    raw.locales ?? "locales",
  ];
  for (const rel of referenced) {
    if (!fs.existsSync(path.join(cwd, rel))) {
      problems.push(`manifest references ${rel}, which does not exist`);
    }
  }

  problems.push(...validateMigrations(cwd, raw.id ?? path.basename(cwd)));
  problems.push(...validateNativeDependencies(cwd, raw));

  if (problems.length > 0) {
    for (const problem of problems) console.error(`  ${problem}`);
    throw new Error(`${raw.id ?? path.basename(cwd)}: manifest is not valid.`);
  }

  console.log(`ok  ${raw.id ?? path.basename(cwd)}`);
}

/**
 * A native dependency has to actually be a real dependency of the plugin, or
 * the build's external declaration points at nothing node_modules can
 * resolve at runtime.
 */
function validateNativeDependencies(cwd, raw) {
  const problems = [];
  const nativeDependencies = raw.nativeDependencies ?? [];
  if (nativeDependencies.length === 0) return problems;

  const pkgPath = path.join(cwd, "package.json");
  const pkg = fs.existsSync(pkgPath)
    ? JSON.parse(fs.readFileSync(pkgPath, "utf8"))
    : {};
  const deps = { ...pkg.dependencies };

  for (const name of nativeDependencies) {
    if (!(name in deps)) {
      problems.push(
        `nativeDependencies names "${name}", which is not in this plugin's own package.json dependencies`,
      );
    }
  }

  return problems;
}

const DIALECTS = ["sqlite", "postgres", "mysql"];

const CREATE_OR_ALTER =
  /(?:CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TABLE(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE|DROP\s+TABLE(?:\s+IF\s+EXISTS)?|TRUNCATE\s+TABLE)\s+([`"']?)([a-zA-Z0-9_]+)\1/gi;

/**
 * Checks that a plugin's migrations only touch tables it owns.
 *
 * The server enforces this too, because a plugin installed from a tarball
 * never ran this command. Here it is a build-time error with a file name
 * attached, rather than a plugin that fails to activate later.
 */
function validateMigrations(cwd, pluginId) {
  const problems = [];
  const prefix = `p_${String(pluginId).replace(/-/g, "_")}_`;
  const root = path.join(cwd, "migrations");
  if (!fs.existsSync(root)) return problems;

  const present = DIALECTS.filter((dialect) =>
    fs.existsSync(path.join(root, dialect)),
  );

  const byDialect = new Map();
  for (const dialect of present) {
    const dir = path.join(root, dialect);
    const files = fs
      .readdirSync(dir)
      .filter((file) => file.endsWith(".sql"))
      .sort();
    byDialect.set(dialect, files);

    for (const file of files) {
      if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(file)) {
        problems.push(
          `migrations/${dialect}/${file} must be named NNNN_name.sql, lower snake_case`,
        );
      }

      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      CREATE_OR_ALTER.lastIndex = 0;
      let match;
      while ((match = CREATE_OR_ALTER.exec(sql)) !== null) {
        const table = match[2];
        if (table.startsWith(prefix)) continue;
        if (LEGACY_TABLES[table] === pluginId) continue;
        problems.push(
          `migrations/${dialect}/${file} touches "${table}", which is not prefixed "${prefix}"`,
        );
      }
    }
  }

  // A migration that exists for one engine and not another leaves that
  // deployment without the table, which is how alert_rules ended up
  // SQLite-only in core.
  const [first, ...rest] = present;
  for (const dialect of rest) {
    const a = byDialect.get(first);
    const b = byDialect.get(dialect);
    for (const file of a) {
      if (!b.includes(file)) {
        problems.push(`migrations/${dialect}/${file} is missing`);
      }
    }
    for (const file of b) {
      if (!a.includes(file)) {
        problems.push(`migrations/${first}/${file} is missing`);
      }
    }
  }

  return problems;
}
