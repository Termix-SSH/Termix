/**
 * The check core runs on every SQL statement a sandboxed plugin sends through
 * its proxy Drizzle client. The plugin builds queries with Drizzle in its own
 * process; only the SQL text and the bound values reach core.
 *
 * It tokenizes the statement for the dialect (strings, comments, quoted names
 * and dollar quotes are understood, so none of them can hide a keyword or a
 * second statement), then:
 *   - allows one statement only;
 *   - refuses anything that reaches outside a table or changes the schema
 *     (ATTACH, PRAGMA, DDL, transactions, file and catalog functions);
 *   - requires every table name after FROM, JOIN, INTO, UPDATE or TABLE to be
 *     one of the plugin's own tables, a ref it was granted, or a CTE the same
 *     statement declares;
 *   - keeps refs read only: a write target must be the plugin's own table.
 *
 * Migrations run in core from the plugin's migration files, never through
 * here, so DDL is never needed at runtime.
 */

export type SqlDialect = "sqlite" | "postgres" | "mysql";

export interface SqlGuardResult {
  ok: boolean;
  reason?: string;
  tables: string[];
}

export interface SqlGuardTables {
  /** The plugin's own tables: read and write. Lower case. */
  own: ReadonlySet<string>;
  /** Core tables from db.refs(): read only. Lower case. */
  readOnly?: ReadonlySet<string>;
}

type Token =
  | { kind: "word"; value: string }
  | { kind: "name"; value: string }
  | { kind: "string" }
  | { kind: "param" }
  | { kind: "number" }
  | { kind: "punct"; value: string };

/** Words that never appear in a statement a plugin may run. */
const FORBIDDEN_WORDS = new Set([
  "attach",
  "detach",
  "pragma",
  "vacuum",
  "create",
  "drop",
  "alter",
  "truncate",
  "rename",
  "reindex",
  "analyze",
  "savepoint",
  "release",
  "begin",
  "commit",
  "rollback",
  "start",
  "grant",
  "revoke",
  "copy",
  "load",
  "outfile",
  "dumpfile",
  "infile",
  "handler",
  "lock",
  "unlock",
  "call",
  "do",
  "execute",
  "prepare",
  "deallocate",
  "listen",
  "notify",
  "set",
  "show",
  "use",
  "flush",
  "kill",
  "shutdown",
  "install",
  "uninstall",
  "cluster",
  "checkpoint",
  "discard",
  "reset",
  "security",
  "comment",
  "import",
]);

/** Functions that read files, run code or leave the database. */
const FORBIDDEN_FUNCTIONS = new Set([
  "load_extension",
  "readfile",
  "writefile",
  "edit",
  "fts3_tokenizer",
  "sqlite_compileoption_get",
  "load_file",
  "sys_exec",
  "sys_eval",
  "pg_read_file",
  "pg_read_binary_file",
  "pg_ls_dir",
  "pg_stat_file",
  "lo_import",
  "lo_export",
  "lo_get",
  "lo_put",
  "dblink",
  "dblink_exec",
  "pg_sleep",
  "sleep",
  "benchmark",
  "set_config",
  "current_setting",
  "pg_terminate_backend",
  "pg_cancel_backend",
  "pg_reload_conf",
  "query_to_xml",
  "table_to_xml",
  "database_to_xml",
]);

/**
 * A word in the statement that is a write when it comes before the table:
 * "insert into t", "update t", "delete from t", "replace into t".
 */
const WRITE_LEADS = new Set(["insert", "update", "delete", "replace"]);

/** Statement kinds a plugin may run at all. */
const ALLOWED_LEADS = new Set([
  "select",
  "insert",
  "update",
  "delete",
  "replace",
  "with",
  "values",
]);

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_\u0080-￿]/.test(ch);
}

function isIdentPart(ch: string): boolean {
  return /[A-Za-z0-9_$\u0080-￿]/.test(ch);
}

class SqlTokenError extends Error {}

function tokenize(sql: string, dialect: SqlDialect): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    // -- comment (MySQL wants a space after it, but treat it the same)
    if (ch === "-" && next === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === "#" && dialect === "mysql") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      // MySQL runs the body of /*! ... */ as code, so refuse it outright.
      if (dialect === "mysql" && (sql[i + 2] === "!" || sql[i + 2] === "+")) {
        throw new SqlTokenError("executable comments are not allowed");
      }
      // Postgres nests block comments.
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (dialect === "postgres" && sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      if (depth > 0) throw new SqlTokenError("unterminated comment");
      continue;
    }
    // String literals. E'..' and X'..' style prefixes are words followed by
    // a string, which is fine: the prefix is never a table name.
    if (ch === "'") {
      i++;
      let closed = false;
      while (i < n) {
        if (sql[i] === "\\" && dialect === "mysql") {
          i += 2;
          continue;
        }
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          closed = true;
          i++;
          break;
        }
        i++;
      }
      if (!closed) throw new SqlTokenError("unterminated string");
      tokens.push({ kind: "string" });
      continue;
    }
    // Postgres dollar quoting: $$...$$ or $tag$...$tag$.
    if (ch === "$" && dialect === "postgres" && !/[0-9]/.test(next ?? "")) {
      const match = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (match) {
        const tag = match[0];
        const end = sql.indexOf(tag, i + tag.length);
        if (end < 0) throw new SqlTokenError("unterminated dollar quote");
        i = end + tag.length;
        tokens.push({ kind: "string" });
        continue;
      }
    }
    // Quoted names.
    if (ch === '"' && dialect !== "mysql") {
      let value = "";
      i++;
      let closed = false;
      while (i < n) {
        if (sql[i] === '"' && sql[i + 1] === '"') {
          value += '"';
          i += 2;
          continue;
        }
        if (sql[i] === '"') {
          closed = true;
          i++;
          break;
        }
        value += sql[i++];
      }
      if (!closed) throw new SqlTokenError("unterminated name");
      tokens.push({ kind: "name", value });
      continue;
    }
    if (ch === '"' && dialect === "mysql") {
      // ANSI_QUOTES may be off, so a double quoted run is a string there.
      i++;
      let closed = false;
      while (i < n) {
        if (sql[i] === "\\") {
          i += 2;
          continue;
        }
        if (sql[i] === '"' && sql[i + 1] === '"') {
          i += 2;
          continue;
        }
        if (sql[i] === '"') {
          closed = true;
          i++;
          break;
        }
        i++;
      }
      if (!closed) throw new SqlTokenError("unterminated string");
      tokens.push({ kind: "string" });
      continue;
    }
    if (ch === "`" && dialect !== "postgres") {
      let value = "";
      i++;
      let closed = false;
      while (i < n) {
        if (sql[i] === "`" && sql[i + 1] === "`") {
          value += "`";
          i += 2;
          continue;
        }
        if (sql[i] === "`") {
          closed = true;
          i++;
          break;
        }
        value += sql[i++];
      }
      if (!closed) throw new SqlTokenError("unterminated name");
      tokens.push({ kind: "name", value });
      continue;
    }
    if (ch === "[" && dialect === "sqlite") {
      const end = sql.indexOf("]", i + 1);
      if (end < 0) throw new SqlTokenError("unterminated name");
      tokens.push({ kind: "name", value: sql.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    // Bound parameters: ?, ?1, $1, :name, @name.
    if (ch === "?") {
      i++;
      while (i < n && /[0-9]/.test(sql[i])) i++;
      tokens.push({ kind: "param" });
      continue;
    }
    if (ch === "$" && /[0-9]/.test(next ?? "")) {
      i++;
      while (i < n && /[0-9]/.test(sql[i])) i++;
      tokens.push({ kind: "param" });
      continue;
    }
    if ((ch === ":" || ch === "@") && isIdentStart(next ?? "")) {
      if (dialect === "postgres" && ch === ":" && sql[i - 1] === ":") {
        // a :: cast is punctuation, handled below
      } else {
        // MySQL @var and @@system variables reach server state.
        if (dialect === "mysql" && ch === "@") {
          throw new SqlTokenError("variables are not allowed");
        }
        i++;
        while (i < n && isIdentPart(sql[i])) i++;
        tokens.push({ kind: "param" });
        continue;
      }
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(next ?? ""))) {
      i++;
      while (i < n && /[0-9a-fA-FxX.eE_+-]/.test(sql[i])) {
        // Stop a number at an operator that is not part of an exponent.
        if (
          (sql[i] === "+" || sql[i] === "-") &&
          !/[eE]/.test(sql[i - 1] ?? "")
        ) {
          break;
        }
        i++;
      }
      tokens.push({ kind: "number" });
      continue;
    }
    if (isIdentStart(ch)) {
      const start = i;
      i++;
      while (i < n && isIdentPart(sql[i])) i++;
      tokens.push({ kind: "word", value: sql.slice(start, i) });
      continue;
    }
    tokens.push({ kind: "punct", value: ch });
    i++;
  }
  return tokens;
}

function wordOf(token: Token | undefined): string | null {
  return token?.kind === "word" ? token.value.toLowerCase() : null;
}

function nameOf(token: Token | undefined): string | null {
  if (!token) return null;
  if (token.kind === "word") return token.value.toLowerCase();
  if (token.kind === "name") return token.value.toLowerCase();
  return null;
}

function refuse(reason: string, tables: string[] = []): SqlGuardResult {
  return { ok: false, reason, tables };
}

export function checkPluginSql(
  sql: string,
  tables: SqlGuardTables,
  dialect: SqlDialect = "sqlite",
): SqlGuardResult {
  const readOnly = tables.readOnly ?? new Set<string>();
  let tokens: Token[];
  try {
    tokens = tokenize(sql, dialect);
  } catch (error) {
    return refuse((error as Error).message);
  }

  // One statement. A trailing semicolon is fine; anything after it is not.
  const semi = tokens.findIndex((t) => t.kind === "punct" && t.value === ";");
  if (semi >= 0) {
    if (semi !== tokens.length - 1) return refuse("more than one statement");
    tokens = tokens.slice(0, semi);
  }
  if (tokens.length === 0) return refuse("empty statement");

  const lead = wordOf(tokens[0]);
  if (!lead || !ALLOWED_LEADS.has(lead)) {
    return refuse(`${lead ?? "that statement"} is not allowed`);
  }

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.kind === "word") {
      const word = token.value.toLowerCase();
      const following = tokens[index + 1];
      const isCall = following?.kind === "punct" && following.value === "(";
      if (FORBIDDEN_FUNCTIONS.has(word) && isCall) {
        return refuse(`${word} is not allowed`);
      }
      if (FORBIDDEN_WORDS.has(word)) {
        // "do update set" and "on conflict do nothing" are upserts, and
        // "update ... set" is a normal update. Anything else using these is
        // refused.
        const upsert =
          (word === "do" &&
            (wordOf(following) === "update" ||
              wordOf(following) === "nothing") &&
            tokens.slice(0, index).some((t) => wordOf(t) === "conflict")) ||
          (word === "set" && isSetClause(tokens, index));
        if (!upsert) return refuse(`${word} is not allowed`);
      }
    }
    if (token.kind === "name") {
      // A quoted function name is still a call.
      const value = token.value.toLowerCase();
      const following = tokens[index + 1];
      if (
        FORBIDDEN_FUNCTIONS.has(value) &&
        following?.kind === "punct" &&
        following.value === "("
      ) {
        return refuse(`${value} is not allowed`);
      }
    }
    if (token.kind === "word") {
      // Catalog reads are refused wherever they appear, not only after FROM.
      const value = token.value.toLowerCase();
      if (
        value.startsWith("sqlite_") ||
        value === "information_schema" ||
        value === "pg_catalog" ||
        value === "performance_schema"
      ) {
        return refuse(`${value} is part of the database catalog`);
      }
    }
  }

  // CTE names declared by WITH, so a reference to them is allowed.
  const ctes = new Set<string>();
  for (let index = 0; index < tokens.length; index++) {
    const word = wordOf(tokens[index]);
    const prev = wordOf(tokens[index - 1]);
    const prevPunct =
      tokens[index - 1]?.kind === "punct"
        ? (tokens[index - 1] as { value: string }).value
        : null;
    if (
      (prev === "with" || prev === "recursive" || prevPunct === ",") &&
      word !== "recursive"
    ) {
      const name = nameOf(tokens[index]);
      // A CTE is "name AS (" or "name (cols) AS (".
      let j = index + 1;
      if (
        tokens[j]?.kind === "punct" &&
        (tokens[j] as { value: string }).value === "("
      ) {
        let depth = 0;
        for (; j < tokens.length; j++) {
          const t = tokens[j];
          if (t.kind === "punct" && t.value === "(") depth++;
          if (t.kind === "punct" && t.value === ")") {
            depth--;
            if (depth === 0) {
              j++;
              break;
            }
          }
        }
      }
      if (name && wordOf(tokens[j]) === "as") ctes.add(name);
    }
  }

  const seen: string[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const keyword = wordOf(tokens[index]);
    if (
      keyword !== "from" &&
      keyword !== "join" &&
      keyword !== "into" &&
      keyword !== "update" &&
      keyword !== "table"
    ) {
      continue;
    }
    // "do update set" in an upsert names no table.
    if (keyword === "update" && wordOf(tokens[index - 1]) === "do") continue;

    let j = index + 1;
    // "insert or replace into", "update or ignore t"
    if (wordOf(tokens[j]) === "or") j += 2;
    // FROM ( subquery ): the inner FROM is checked on its own.
    if (tokens[j]?.kind === "punct") continue;
    // FROM LATERAL, FROM ONLY t
    if (wordOf(tokens[j]) === "only" || wordOf(tokens[j]) === "lateral") j++;

    const first = nameOf(tokens[j]);
    if (!first) continue;
    // A function call in FROM (json_each(...), generate_series(...)).
    // INSERT INTO t (cols) is a table with its column list, not a call.
    const after = tokens[j + 1];
    if (
      (keyword === "from" || keyword === "join") &&
      after?.kind === "punct" &&
      after.value === "("
    ) {
      if (FORBIDDEN_FUNCTIONS.has(first)) {
        return refuse(`${first} is not allowed`, seen);
      }
      continue;
    }
    if (after?.kind === "punct" && after.value === ".") {
      return refuse("schema qualified names are not allowed", seen);
    }
    if (["select", "values", "set"].includes(first)) continue;

    seen.push(first);
    if (ctes.has(first) || tables.own.has(first)) continue;

    const before = wordOf(tokens[index - 1]);
    const isWrite =
      keyword === "into" ||
      keyword === "update" ||
      (keyword === "from" && before !== null && WRITE_LEADS.has(before));
    if (!isWrite && readOnly.has(first)) continue;
    return refuse(
      isWrite && readOnly.has(first)
        ? `table ${first} is read only`
        : `table ${first} is not this plugin's`,
      seen,
    );
  }
  return { ok: true, tables: seen };
}

/** "set" as in UPDATE t SET or ON CONFLICT DO UPDATE SET, nothing else. */
function isSetClause(tokens: Token[], index: number): boolean {
  for (let j = index - 1; j >= 0; j--) {
    const word = wordOf(tokens[j]);
    if (word === "update") return true;
    if (word === "select" || word === "where" || word === "from") return false;
  }
  return false;
}
