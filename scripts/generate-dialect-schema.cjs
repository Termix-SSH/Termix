/**
 * Generates the Postgres and MySQL schema modules from the SQLite one.
 *
 * ## These files produce DDL. They are not used at runtime.
 *
 * drizzle-kit reads them to emit the migrations in drizzle/postgres and
 * drizzle/mysql. Nothing imports them to run a query.
 *
 * That is not an oversight. The query builder needs two things from a table
 * object — the identifiers to interpolate, and the encoders that turn JS values
 * into driver values — and the sqlite definitions supply both correctly for
 * every engine, which is why all 44 repositories import schema.ts directly:
 *
 *   - text and integer encode as themselves everywhere
 *   - integer({ mode: "boolean" }) writes 1/0, which Postgres and MySQL both
 *     accept for a boolean column, and reads back through `Number(v) === 1`,
 *     which is true for JS `true` as well as for 1
 *   - real is a plain number on all three
 *
 * What genuinely differs between the dialects is DDL — column types, key
 * lengths, autoincrement syntax — and DDL is exactly what these files exist to
 * generate. See scripts/verify-dialects.mjs, which asserts the round-trips
 * above against real servers rather than trusting this comment.
 *
 * The schema is declared once, in sqlite-core, and the other two dialects are
 * derived. Hand-maintaining three copies of 52 tables would mean a renamed
 * table has to land in three places consistently or a foreign key silently
 * points at the wrong one — and the schema is regular enough that the mapping
 * is mechanical.
 *
 * What varies between dialects is small and closed:
 *   - booleans are integers on sqlite, native elsewhere
 *   - autoincrement keys are `integer primary key autoincrement`, `serial`,
 *     and `int auto_increment`
 *   - MySQL cannot index unbounded TEXT, so any column that is a primary key,
 *     is unique, or participates in a foreign key must be varchar
 *
 * Usage: node scripts/generate-dialect-schema.cjs [--check]
 *   --check verifies the committed files match what would be generated,
 *   for CI to catch a schema edit that forgot to regenerate.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SOURCE = path.join(ROOT, "src/backend/database/db/schema.ts");
const TARGETS = {
  postgres: path.join(ROOT, "src/backend/database/db/schema.pg.ts"),
  mysql: path.join(ROOT, "src/backend/database/db/schema.mysql.ts"),
};

const KEY_LENGTH = 255;

/**
 * Columns that must be varchar rather than text on MySQL. A column qualifies if
 * it is a primary key, is unique, or is either end of a foreign key.
 */
function collectKeyColumns(source) {
  const keyed = new Set();

  // `name: text("col")....primaryKey()` / `.unique()` / `.references(...)`
  const declaration =
    /(\w+):\s*text\("([a-z0-9_]+)"\)((?:\s*\.\w+\([^)]*\))*)/g;
  let match;
  while ((match = declaration.exec(source)) !== null) {
    const [, prop, column, modifiers] = match;
    if (/\.(primaryKey|unique|references)\(/.test(modifiers)) {
      keyed.add(column);
    }
    void prop;
  }

  // Multi-line form: the modifiers land on following lines.
  const multiline =
    /(\w+):\s*text\("([a-z0-9_]+)"\)\s*\n(\s*\.\w+\([\s\S]*?\),)/g;
  while ((match = multiline.exec(source)) !== null) {
    if (/\.(primaryKey|unique|references)\(/.test(match[3])) {
      keyed.add(match[2]);
    }
  }

  // A referenced column implies the referencing side too; both must match.
  const reference = /\.references\(\(\)\s*=>\s*\w+\.(\w+)/g;
  while ((match = reference.exec(source)) !== null) {
    keyed.add(camelToSnake(match[1]));
  }

  return keyed;
}

function camelToSnake(value) {
  return value.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function transform(source, dialect) {
  const keyed = collectKeyColumns(source);
  const isPg = dialect === "postgres";
  let out = source;

  // Autoincrement primary keys, before the plain integer rule below.
  out = out.replace(
    /integer\("([a-z0-9_]+)"\)\.primaryKey\(\{\s*autoIncrement:\s*true\s*\}\)/g,
    (_, col) =>
      isPg
        ? `serial("${col}").primaryKey()`
        : `int("${col}").autoincrement().primaryKey()`,
  );

  // Integer-backed booleans become native ones. Prettier wraps the longer
  // declarations across lines, so this has to span newlines too.
  out = out.replace(
    /integer\(\s*"([a-z0-9_]+)",\s*\{\s*mode:\s*"boolean",?\s*\},?\s*\)/g,
    (_, col) => `boolean("${col}")`,
  );

  // Remaining integers.
  if (!isPg) {
    out = out.replace(
      /\binteger\("([a-z0-9_]+)"\)/g,
      (_, col) => `int("${col}")`,
    );
  }

  // Floating point.
  out = out.replace(/\breal\("([a-z0-9_]+)"\)/g, (_, col) =>
    isPg ? `doublePrecision("${col}")` : `double("${col}")`,
  );

  // Key-bearing strings must be indexable.
  out = out.replace(/\btext\("([a-z0-9_]+)"\)/g, (whole, col) =>
    keyed.has(col) ? `varchar("${col}", { length: ${KEY_LENGTH} })` : whole,
  );

  // text("x", { length: n }) is sqlite-only sugar; drop the length.
  out = out.replace(
    /\btext\("([a-z0-9_]+)",\s*\{\s*length:\s*\d+\s*\}\)/g,
    (_, col) => `text("${col}")`,
  );

  out = out.replace(/\bsqliteTable\(/g, isPg ? "pgTable(" : "mysqlTable(");

  const imports = isPg
    ? `import {\n  pgTable,\n  text,\n  varchar,\n  integer,\n  serial,\n  boolean,\n  doublePrecision,\n} from "drizzle-orm/pg-core";`
    : `import {\n  mysqlTable,\n  text,\n  varchar,\n  int,\n  boolean,\n  double,\n} from "drizzle-orm/mysql-core";`;

  out = out.replace(
    /import\s*\{[^}]*\}\s*from\s*"drizzle-orm\/sqlite-core";/,
    imports,
  );

  return `${header(dialect)}\n${out}`;
}

function header(dialect) {
  return `// GENERATED FILE — do not edit.
//
// Produced from schema.ts by scripts/generate-dialect-schema.cjs.
// Edit the sqlite schema and re-run \`node scripts/generate-dialect-schema.cjs\`.
// Target dialect: ${dialect}.
//
// DDL source for drizzle-kit. NOT imported to run queries — repositories use
// schema.ts on every dialect. See the generator header for why that is correct.
`;
}

function main() {
  const check = process.argv.includes("--check");
  const source = fs.readFileSync(SOURCE, "utf8");
  let drift = false;

  for (const [dialect, target] of Object.entries(TARGETS)) {
    const generated = transform(source, dialect);

    if (check) {
      const current = fs.existsSync(target)
        ? fs.readFileSync(target, "utf8")
        : "";
      if (current !== generated) {
        console.error(
          `[generate-dialect-schema] ${path.relative(ROOT, target)} is out of date`,
        );
        drift = true;
      }
      continue;
    }

    fs.writeFileSync(target, generated);
    console.log(
      `[generate-dialect-schema] wrote ${path.relative(ROOT, target)}`,
    );
  }

  if (drift) {
    console.error(
      "[generate-dialect-schema] run `node scripts/generate-dialect-schema.cjs` and commit the result",
    );
    process.exit(1);
  }
}

module.exports = { transform, collectKeyColumns };

if (require.main === module) {
  main();
}
