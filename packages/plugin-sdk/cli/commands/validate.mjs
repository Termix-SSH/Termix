import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readManifest, isThemeOnly } from "../lib/plugin-dir.mjs";

/**
 * The manifest rules live in src/manifest.ts, which the server uses too, so
 * there is one implementation rather than a copy here that drifts.
 */
export async function loadSdkModule(name) {
  const entry = new URL(`../../dist/${name}.js`, import.meta.url);
  if (!fs.existsSync(fileURLToPath(entry))) {
    throw new Error("The plugin SDK is not built yet. Run: npm run build:sdk");
  }
  return import(entry.href);
}

export async function validate({ cwd }) {
  const raw = readManifest(cwd);
  const { parseManifest, validateThemeCss } = await loadSdkModule("manifest");
  const { errors } = parseManifest(raw);

  const problems = [...errors];

  // The manifest names files. They have to be there.
  const referenced = [
    raw.backend ?? "dist/backend.js",
    // A theme only plugin has no frontend code.
    ...(isThemeOnly(raw) ? [] : [raw.frontend ?? "dist/frontend.js"]),
    raw.locales ?? "locales",
    // Built from src/mobile by termix-plugin build.
    ...(typeof raw.contributes?.mobile?.entry === "string"
      ? [raw.contributes.mobile.entry]
      : []),
  ];
  for (const rel of referenced) {
    if (!fs.existsSync(path.join(cwd, rel))) {
      problems.push(`manifest references ${rel}, which does not exist`);
    }
  }

  problems.push(...validateThemeFiles(cwd, raw, validateThemeCss));
  problems.push(...validateLookCapabilities(cwd, raw));
  problems.push(
    ...(await validateMigrations(cwd, raw.id ?? path.basename(cwd))),
  );
  problems.push(...validateNativeDependencies(cwd, raw));
  problems.push(...validatePackage(cwd, raw));
  problems.push(...(await validateChangelogFile(cwd, raw)));

  for (const warning of docsWarnings(cwd, raw)) {
    console.warn(`  warn  ${warning}`);
  }
  for (const warning of uiWarnings(cwd)) {
    console.warn(`  ui    ${warning}`);
  }
  const capabilities = await loadSdkModule("capabilities");
  const manifestModule = await loadSdkModule("manifest");
  for (const warning of sandboxWarnings(cwd, raw, {
    ...capabilities,
    isLegacyPluginApi: manifestModule.isLegacyPluginApi,
  })) {
    console.warn(`  sandbox  ${warning}`);
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`  ${problem}`);
    throw new Error(`${raw.id ?? path.basename(cwd)}: manifest is not valid.`);
  }

  console.log(`ok  ${raw.id ?? path.basename(cwd)}`);
}

/** Every declared theme file exists and holds only CSS a theme may hold. */
export function validateThemeFiles(cwd, raw, validateThemeCss) {
  const problems = [];
  const themes = raw?.contributes?.themes;
  if (!Array.isArray(themes)) return problems;
  for (const theme of themes) {
    if (typeof theme?.css !== "string" || typeof theme?.id !== "string") {
      continue;
    }
    const file = path.join(cwd, theme.css);
    if (!fs.existsSync(file)) {
      problems.push(`theme ${theme.id}: ${theme.css} does not exist`);
      continue;
    }
    for (const error of validateThemeCss(
      fs.readFileSync(file, "utf8"),
      theme.id,
    )) {
      problems.push(`theme ${theme.id}: ${error}`);
    }
  }
  return problems;
}

/**
 * ui:layout and ui:theme must match what the manifest contributes, both
 * ways. The manifest check already flags a contribution without its
 * capability; this flags a capability with nothing behind it, and a layout
 * with no frontend to register it.
 */
export function validateLookCapabilities(cwd, raw) {
  const problems = [];
  const capabilities = Array.isArray(raw?.capabilities) ? raw.capabilities : [];
  const layouts = raw?.contributes?.layouts;
  const themes = raw?.contributes?.themes;
  const hasLayouts = Array.isArray(layouts) && layouts.length > 0;
  const hasThemes = Array.isArray(themes) && themes.length > 0;
  if (capabilities.includes("ui:layout") && !hasLayouts) {
    problems.push('"ui:layout" is declared but contributes.layouts is empty');
  }
  if (capabilities.includes("ui:theme") && !hasThemes) {
    problems.push('"ui:theme" is declared but contributes.themes is empty');
  }
  if (hasLayouts) {
    const entries = ["index.tsx", "index.ts", "index.mjs", "index.js"];
    const frontend = entries.some((entry) =>
      fs.existsSync(path.join(cwd, "src", "frontend", entry)),
    );
    if (!frontend && raw.frontend === undefined) {
      problems.push(
        "contributes.layouts needs a frontend that calls app.registerLayout",
      );
    }
  }
  return problems;
}

const NODE_IMPORT =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'`](?:node:)?([a-z_/]+)["'`]/g;

/**
 * A plugin's backend runs in its own process (plugin API 2), where a Node
 * module its capabilities don't unlock throws ERR_ACCESS_DENIED. Flags those
 * imports before the plugin is ever run.
 */
export function sandboxWarnings(cwd, raw, sdk) {
  const warnings = [];
  const api = String(raw?.engine?.api ?? "");
  if (!api || sdk.isLegacyPluginApi?.(api)) return warnings;
  const capabilities = Array.isArray(raw?.capabilities) ? raw.capabilities : [];
  const granted = sdk.modulesGrantedBy(capabilities);
  const gated = new Set(sdk.SANDBOX_GATED_MODULES);
  const blocked = new Set(sdk.SANDBOX_BLOCKED_MODULES);
  const needs = (name) =>
    Object.entries(sdk.CAPABILITY_PROCESS_GRANTS)
      .filter(([, grant]) => grant.modules.includes(name))
      .map(([capability]) => capability)
      .join(" or ");
  for (const file of walkSources(path.join(cwd, "src", "backend"))) {
    const rel = path.relative(cwd, file).replaceAll("\\", "/");
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(NODE_IMPORT)) {
      const name = match[1];
      if (blocked.has(name)) {
        warnings.push(
          `${rel} imports ${name}, which no plugin process can use`,
        );
      } else if (gated.has(name) && !granted.has(name)) {
        warnings.push(
          `${rel} imports ${name}, which needs the ${needs(name)} capability in a plugin process`,
        );
      }
    }
  }
  return [...new Set(warnings)];
}

/** Env vars core sets for everyone, so a plugin need not list them. */
const CORE_ENV = new Set([
  "DATA_DIR",
  "NODE_ENV",
  "PORT",
  "BASE_PATH",
  "VERSION",
  "HOME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "PATH",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "ELECTRON_EMBEDDED",
]);

const ENV_READS = [
  /process\.env\.([A-Z][A-Z0-9_]*)/g,
  /process\.env\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\]/g,
  /\benv\.([A-Z][A-Z0-9_]*)\b/g,
  /\benv\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\]/g,
];

function walkSources(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSources(full, out);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Whether line i sits inside a still open Button within the lines before it. */
function insideButton(lines, i, reach = 12) {
  const before = lines.slice(Math.max(0, i - reach), i + 1).join("\n");
  const open = before.lastIndexOf("<Button");
  const openLower = before.lastIndexOf("<button");
  const start = Math.max(open, openLower);
  if (start < 0) return false;
  return !/<\/(Button|button)>/.test(before.slice(start));
}

const UI_RULES = [
  {
    test: (line) => /animate-spin|<Loader2\b/.test(line),
    // Spinners inside a button, and activity spinners like "working", are fine.
    skip: (lines, i) =>
      insideButton(lines, i) ||
      !/loading|Loading/.test(lines.slice(Math.max(0, i - 4), i + 4).join(" ")),
    message: "raw spinner while loading, use LoadingState",
  },
  {
    test: (line) => /<(ArrowLeft|ChevronLeft)\b/.test(line),
    // Only real back buttons, not previous page or month arrows.
    skip: (lines, i) =>
      !insideButton(lines, i, 6) ||
      !/back|onBack|close\b/i.test(
        lines.slice(Math.max(0, i - 6), i + 4).join(" "),
      ),
    message:
      "hand made back button, use BackButton in PanelShell leading or InlineView",
  },
  {
    test: (line) => /<select\b/.test(line),
    message: "native select, use Select or SelectField",
  },
  {
    test: (line) => /\[&>button\]:flex-1/.test(line),
    message: "stretched Segmented, keep filters at their natural width",
  },
  {
    test: (line) =>
      /(^|[\s"'`])bg-(muted|card|accent)(\/\d+)?(?=[\s"'`]|$)/.test(line) &&
      /\bborder-b\b/.test(line) &&
      /(uppercase|GroupHeading|py-1\.5)/.test(line),
    message: "filled section header, headers have no background",
  },
  {
    test: (line) => /max-h-\[\d+vh\]/.test(line),
    message: "viewer capped by screen height, let it fill the view",
  },
  {
    test: (line) => /<FormFooter\b/.test(line),
    skip: (lines, i) =>
      /footer\s*=/i.test(lines.slice(Math.max(0, i - 4), i + 1).join(" ")),
    message:
      "FormFooter in the body, pass it to an InlineView or PanelShell footer (PanelShell chrome={false} inside a tab) so it stays pinned",
  },
  {
    test: (line) =>
      /\{t\(["'][\w.]*[Ll]oading["']\)\}/.test(line) && !/label=/.test(line),
    message: "plain loading text, use LoadingState",
  },
];

/**
 * Drift from the shared UI kit in src/frontend: raw spinners, hand made back
 * buttons, native selects, stretched filters, filled headers and footers that
 * scroll away. Warnings only, since some cases are on purpose.
 */
export function uiWarnings(cwd) {
  const warnings = [];
  for (const file of walkSources(path.join(cwd, "src", "frontend"))) {
    if (!file.endsWith(".tsx")) continue;
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    const rel = path.relative(cwd, file).replace(/\\/g, "/");
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*|import\b)/.test(line)) return;
      for (const rule of UI_RULES) {
        if (rule.test(line) && !(rule.skip && rule.skip(lines, i))) {
          warnings.push(`${rel}:${i + 1} ${rule.message}`);
        }
      }
    });
  }
  return warnings;
}

/**
 * Docs gaps that do not block a release: no docs/index.md, or a process.env
 * read the manifest does not list in env.
 */
export function docsWarnings(cwd, raw) {
  const warnings = [];
  if (!fs.existsSync(path.join(cwd, "docs", "index.md"))) {
    warnings.push("docs/index.md is missing, so the plugin has no docs page");
  }
  const declared = new Set(
    Array.isArray(raw.env) ? raw.env.map((e) => e?.name) : [],
  );
  const missing = new Set();
  for (const file of walkSources(path.join(cwd, "src"))) {
    const text = fs.readFileSync(file, "utf8");
    for (const pattern of ENV_READS) {
      for (const match of text.matchAll(pattern)) {
        const name = match[1];
        if (!declared.has(name) && !CORE_ENV.has(name)) missing.add(name);
      }
    }
  }
  for (const name of [...missing].sort()) {
    warnings.push(`reads ${name} but manifest env does not list it`);
  }
  return warnings;
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
    pkg.peerDependencies?.["@termix-ssh/plugin-sdk"] ??
    pkg.dependencies?.["@termix-ssh/plugin-sdk"] ??
    pkg.devDependencies?.["@termix-ssh/plugin-sdk"];
  if (!sdkRange) {
    problems.push("package.json does not depend on @termix-ssh/plugin-sdk");
  } else if (sdkRange === "*" || sdkRange === "latest") {
    problems.push(
      `@termix-ssh/plugin-sdk is "${sdkRange}"; pin a range such as "^1.0.0"`,
    );
  }
  return problems;
}

/**
 * CHANGELOG.md is optional, but when it is there it has to parse and its
 * newest release has to match the manifest version.
 */
async function validateChangelogFile(cwd, raw) {
  if (fs.existsSync(path.join(cwd, "CHANGELOG.json"))) {
    return [
      "CHANGELOG.json is no longer read; move the release notes to CHANGELOG.md",
    ];
  }
  const mdPath = path.join(cwd, "CHANGELOG.md");
  if (!fs.existsSync(mdPath)) return [];
  const { validateChangelog } = await loadSdkModule("changelog");
  return validateChangelog(fs.readFileSync(mdPath, "utf8"), raw.version).map(
    (problem) => `CHANGELOG.md: ${problem}`,
  );
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
  for (const dialect of DIALECTS) {
    if (present.length > 0 && !present.includes(dialect)) {
      problems.push(`migrations/${dialect} is missing`);
    }
  }

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
