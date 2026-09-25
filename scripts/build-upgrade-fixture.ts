/**
 * Writes src/backend/tests/fixtures/upgrade/{db.sqlite,fixture.env,files/}: a 2.8 install's
 * data directory with every feature table filled. The schema is 2.8's own
 * dump, the rows come from rows.ts, and the columns 2.8 encrypted are
 * encrypted the way 2.8 did it (a v3 system-wrapped data key per user, then
 * FieldCrypto per field), so the upgrade test has to really decrypt them.
 *
 * Usage: npx tsx scripts/build-upgrade-fixture.ts
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { FieldCrypto } from "../src/backend/utils/field-crypto.js";
import {
  ENCRYPTED_COLUMNS,
  FIXTURE_PASSWORD,
  RECORDING_FILES,
  ROWS,
  type Row,
} from "../src/backend/tests/fixtures/upgrade/rows.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = path.join(ROOT, "src/backend/tests/fixtures");
const OUT = path.join(FIXTURES, "upgrade");

const hex = (label: string) =>
  crypto
    .createHash("sha256")
    .update(`termix-d4-fixture:${label}`)
    .digest("hex");

const ENV = {
  JWT_SECRET: hex("jwt") + hex("jwt-2"),
  DATABASE_KEY: hex("database"),
  ENCRYPTION_KEY: hex("encryption"),
  INTERNAL_AUTH_TOKEN: hex("internal"),
};
const masterKey = Buffer.from(ENV.ENCRYPTION_KEY, "hex");

/** UserKeyManager's v3 wrap, unchanged since 2.8. */
function wrapDek(userId: string, dek: Buffer): string {
  const wrapKey = Buffer.from(
    crypto.hkdfSync(
      "sha256",
      masterKey,
      Buffer.alloc(0),
      `termix:dek-wrap:v3:${userId}`,
      32,
    ),
  );
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", wrapKey, iv);
  cipher.setAAD(Buffer.from(userId, "utf8"));
  const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
  return JSON.stringify({
    v: 3,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    ct: ct.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    createdAt: "2026-05-01T10:00:00.000Z",
  });
}

const deks = new Map<string, Buffer>();
const dekFor = (userId: string) => {
  let dek = deks.get(userId);
  if (!dek) {
    dek = Buffer.from(hex(`dek:${userId}`), "hex");
    deks.set(userId, dek);
  }
  return dek;
};

function prepareRow(table: string, row: Row): Row {
  const out: Row = { ...row };
  if (table === "users" && out.password_hash === undefined) {
    out.password_hash = bcrypt.hashSync(FIXTURE_PASSWORD, 10);
  }
  for (const [encTable, column, field, userColumn] of ENCRYPTED_COLUMNS) {
    if (encTable !== table || typeof out[column] !== "string" || !out[column])
      continue;
    const userId = String(out[userColumn]);
    const recordId = table === "users" ? userId : String(out.id);
    out[column] = FieldCrypto.encryptField(
      out[column] as string,
      dekFor(userId),
      recordId,
      field,
    );
  }
  return out;
}

function insert(sqlite: Database.Database, table: string, row: Row): void {
  const keys = Object.keys(row);
  sqlite
    .prepare(
      `INSERT INTO "${table}" (${keys.map((key) => `"${key}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
    )
    .run(...keys.map((key) => row[key]));
}

fs.mkdirSync(OUT, { recursive: true });
const dbPath = path.join(OUT, "db.sqlite");
fs.rmSync(dbPath, { force: true });

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = DELETE");
sqlite.exec(
  fs.readFileSync(path.join(FIXTURES, "sqlite-2.8-schema.sql"), "utf8"),
);
sqlite.pragma("foreign_keys = ON");

sqlite.transaction(() => {
  for (const [table, rows] of Object.entries(ROWS)) {
    for (const row of rows) insert(sqlite, table, prepareRow(table, row));
  }
  for (const user of ROWS.users) {
    const userId = String(user.id);
    insert(sqlite, "settings", {
      key: `user_dek_v3_${userId}`,
      value: wrapDek(userId, dekFor(userId)),
    });
  }
})();

const violations = sqlite.pragma("foreign_key_check") as unknown[];
if (violations.length > 0) {
  throw new Error(`Foreign key violations: ${JSON.stringify(violations)}`);
}
sqlite.exec("VACUUM");
sqlite.close();

fs.writeFileSync(
  path.join(OUT, "fixture.env"),
  Object.entries(ENV)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n") + "\n",
);

// The recording files 2.8 left in DATA_DIR, which the rows point at.
const files = path.join(OUT, "files");
fs.rmSync(files, { recursive: true, force: true });
for (const [kind, relative] of Object.entries(RECORDING_FILES)) {
  const file = path.join(files, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `d4 ${kind} recording
`,
  );
}

console.log(`Wrote ${path.relative(ROOT, dbPath)} and fixture.env`);
