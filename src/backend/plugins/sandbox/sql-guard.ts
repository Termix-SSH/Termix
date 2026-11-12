/**
 * Sandbox spike: the check core runs on every SQL statement a sandboxed
 * plugin sends through its proxy Drizzle client.
 *
 * A cheap lexical check, not a parser: string literals and comments are
 * stripped, then every name after FROM, JOIN, INTO, UPDATE or TABLE must be
 * one of the plugin's own tables, a ref it was granted, or a CTE the same
 * statement declared. Refs are read only: a write target must be the
 * plugin's own table. Anything that can reach outside a table (ATTACH,
 * PRAGMA, load_extension, the sqlite_ catalog) and schema changes (that is
 * migrations' job) are refused outright, and so is a second statement.
 */

export interface SqlGuardResult {
  ok: boolean;
  reason?: string;
  tables: string[];
}

const FORBIDDEN =
  /\b(attach|detach|pragma|vacuum|load_extension|create|drop|alter|reindex|analyze|savepoint|release|begin|commit|rollback|readfile|writefile|edit|fts3_tokenizer)\b/i;

function stripLiteralsAndComments(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") break;
        else i++;
      }
      i++;
      out += "''";
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      out += " ";
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 2;
      out += " ";
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Names in "x", `x`, [x] or bare form, lower cased. */
const NAME = String.raw`("(?:[^"]|"")+"|\x60[^\x60]+\x60|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_$]*)`;

function unquote(name: string): string {
  if (name.startsWith('"')) return name.slice(1, -1).replace(/""/g, '"');
  if (name.startsWith("`") || name.startsWith("[")) return name.slice(1, -1);
  return name;
}

export interface SqlGuardTables {
  /** The plugin's own tables: read and write. */
  own: ReadonlySet<string>;
  /** Core tables from db.refs(): read only. */
  readOnly?: ReadonlySet<string>;
}

export function checkPluginSql(
  sql: string,
  tables: SqlGuardTables,
): SqlGuardResult {
  const readOnly = tables.readOnly ?? new Set<string>();
  const clean = stripLiteralsAndComments(sql);
  const trimmed = clean.trim().replace(/;\s*$/, "");
  if (trimmed.includes(";")) {
    return { ok: false, reason: "more than one statement", tables: [] };
  }
  // Quoted names are user data here, so test keywords on the bare text only.
  const bare = trimmed.replace(/"(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\]/g, '""');
  const forbidden = FORBIDDEN.exec(bare);
  if (forbidden) {
    return {
      ok: false,
      reason: `${forbidden[1].toLowerCase()} is not allowed`,
      tables: [],
    };
  }
  if (/sqlite_/i.test(trimmed)) {
    return {
      ok: false,
      reason: "the sqlite catalog is not allowed",
      tables: [],
    };
  }

  const ctes = new Set<string>();
  const cteRe = new RegExp(
    `(?:\\bwith\\b|,)\\s*(?:recursive\\s+)?${NAME}\\s*(?:\\([^)]*\\)\\s*)?as\\s*\\(`,
    "gi",
  );
  for (const match of trimmed.matchAll(cteRe)) {
    ctes.add(unquote(match[1]).toLowerCase());
  }

  const seen: string[] = [];
  const refRe = new RegExp(
    `\\b(from|join|into|update|table)\\s+(?:or\\s+[a-z]+\\s+)?(?:${NAME}\\s*\\.\\s*)?${NAME}`,
    "gi",
  );
  for (const match of trimmed.matchAll(refRe)) {
    if (match[2]) {
      return {
        ok: false,
        reason: "schema qualified names are not allowed",
        tables: seen,
      };
    }
    const keyword = match[1].toLowerCase();
    const name = unquote(match[3]).toLowerCase();
    // FROM ( subquery ) has no name after it; the inner FROM is caught on its
    // own. "do update set" in an upsert names no table.
    if (["select", "values", "set"].includes(name)) continue;
    seen.push(name);
    if (ctes.has(name) || tables.own.has(name)) continue;
    const before = trimmed.slice(0, match.index).trimEnd().toLowerCase();
    const isWrite =
      keyword === "into" ||
      keyword === "update" ||
      (keyword === "from" && before.endsWith("delete"));
    if (!isWrite && readOnly.has(name)) continue;
    return {
      ok: false,
      reason:
        isWrite && readOnly.has(name)
          ? `table ${name} is read only`
          : `table ${name} is not this plugin's`,
      tables: seen,
    };
  }
  return { ok: true, tables: seen };
}
