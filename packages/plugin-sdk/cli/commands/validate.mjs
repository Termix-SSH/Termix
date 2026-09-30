import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readManifest } from "../lib/plugin-dir.mjs";

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

  problems.push(
    ...(await validateMigrations(cwd, raw.id ?? path.basename(cwd))),
  );
  problems.push(...validateNativeDependencies(cwd, raw));
  problems.push(...validatePackage(cwd, raw));

  if (problems.length > 0) {
    for (const problem of problems) console.error(`  ${problem}`);
    throw new Error(`${raw.id ?? path.basename(cwd)}: manifest is not valid.`);
  }

  console.log(`ok  ${raw.id ?? path.basename(cwd)}`);
}

/**
 * package.json has to agree with the manifest: the same version, and a real
 * SDK range rather than "*", so a plugin built against a newer SDK says so.
 */
function validatePackage(cwd, raw) {
  const problems = [];
  const pkgPath = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgPath)) return problems;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

  if (pkg.version && raw.version && pkg.version !== raw.version) {
    problems.push(
      `package.json version ${pkg.version} does not match manifest version ${raw.version}`,
    );
  }

  const sdkRange =
    pkg.peerDependencies?.["@termix/plugin-sdk"] ??
    pkg.dependencies?.["@termix/plugin-sdk"] ??
    pkg.devDependencies?.["@termix/plugin-sdk"];
  if (!sdkRange) {
    problems.push("package.json does not depend on @termix/plugin-sdk");
  } else if (sdkRange === "*" || sdkRange === "latest") {
    problems.push(
      `@termix/plugin-sdk is "${sdkRange}"; pin a range such as "^1.0.0"`,
    );
  }
  return problems;
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

/**
 * Checks that a plugin's migrations only touch tables it owns.
 *
 * The server enforces this too, because a plugin installed from a tarball
 * never ran this command. Here it is a build-time error with a file name
 * attached, rather than a plugin that fails to activate later.
 */
async function validateMigrations(cwd, pluginId) {
  const { LEGACY_TABLE_OWNERS: LEGACY_TABLES } =
    await import("../../dist/db.js");
  const { collectOwnedIndexes, findUnownedTableWrites } =
    await import("../../dist/ddl.js");

  const problems = [];
  const legacy = new Set(
    Object.entries(LEGACY_TABLES)
      .filter(([, owner]) => owner === pluginId)
      .map(([table]) => table),
  );
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
    const sqls = files.map((file) =>
      fs.readFileSync(path.join(dir, file), "utf8"),
    );
    const indexes = collectOwnedIndexes(pluginId, sqls, legacy);

    for (const [index, file] of files.entries()) {
      if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(file)) {
        problems.push(
          `migrations/${dialect}/${file} must be named NNNN_name.sql, lower snake_case`,
        );
      }

      const sql = sqls[index];
      for (const problem of findUnownedTableWrites(
        pluginId,
        sql,
        legacy,
        indexes,
      )) {
        problems.push(`migrations/${dialect}/${file} ${problem}`);
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
