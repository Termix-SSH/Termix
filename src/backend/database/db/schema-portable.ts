import { mysqlKit, pgKit, sqliteKit } from "./column-kit.js";
import type { DatabaseDialect } from "./dialect.js";

/**
 * Proof-of-concept slice: the same two tables materialised for all three
 * dialects.
 *
 * These are deliberately declared per dialect rather than from one shared
 * factory. Drizzle's `sqliteTable`, `pgTable` and `mysqlTable` have
 * incompatible signatures, so a single `define(kit)` helper types as
 * non-callable and collapses the column types to `any` — losing exactly the
 * inference the repositories rely on. The column kit still earns its place: it
 * keeps the *type choices* (boolean storage, autoincrement, key-safe strings)
 * in one file, so the per-dialect bodies stay mechanical.
 *
 * `settings` is trivial; `users` exercises every construct the real schema uses
 * — text primary key, autoincrement-adjacent integer, booleans with defaults,
 * and nullable columns. Between them they are representative of all 52 tables.
 *
 * See the PR for how the remaining tables would be handled; generating these
 * bodies from one declaration is the obvious next question.
 */

export const sqlitePortable = {
  settings: sqliteKit.table("settings", {
    key: sqliteKit.shortText("key").primaryKey(),
    value: sqliteKit.text("value").notNull(),
  }),
  users: sqliteKit.table("users", {
    id: sqliteKit.shortText("id").primaryKey(),
    username: sqliteKit.text("username").notNull(),
    passwordHash: sqliteKit.text("password_hash").notNull(),
    isAdmin: sqliteKit.bool("is_admin").notNull().default(false),
    isOidc: sqliteKit.bool("is_oidc").notNull().default(false),
    oidcIdentifier: sqliteKit.text("oidc_identifier"),
    ssoProviderId: sqliteKit.int("sso_provider_id"),
  }),
};

export const pgPortable = {
  settings: pgKit.table("settings", {
    key: pgKit.shortText("key").primaryKey(),
    value: pgKit.text("value").notNull(),
  }),
  users: pgKit.table("users", {
    id: pgKit.shortText("id").primaryKey(),
    username: pgKit.text("username").notNull(),
    passwordHash: pgKit.text("password_hash").notNull(),
    isAdmin: pgKit.bool("is_admin").notNull().default(false),
    isOidc: pgKit.bool("is_oidc").notNull().default(false),
    oidcIdentifier: pgKit.text("oidc_identifier"),
    ssoProviderId: pgKit.int("sso_provider_id"),
  }),
};

export const mysqlPortable = {
  settings: mysqlKit.table("settings", {
    key: mysqlKit.shortText("key").primaryKey(),
    value: mysqlKit.text("value").notNull(),
  }),
  users: mysqlKit.table("users", {
    id: mysqlKit.shortText("id").primaryKey(),
    username: mysqlKit.text("username").notNull(),
    passwordHash: mysqlKit.text("password_hash").notNull(),
    isAdmin: mysqlKit.bool("is_admin").notNull().default(false),
    isOidc: mysqlKit.bool("is_oidc").notNull().default(false),
    oidcIdentifier: mysqlKit.text("oidc_identifier"),
    ssoProviderId: mysqlKit.int("sso_provider_id"),
  }),
};

export function portableSchemaFor(dialect: DatabaseDialect) {
  if (dialect === "postgres") return pgPortable;
  if (dialect === "mysql") return mysqlPortable;
  return sqlitePortable;
}
