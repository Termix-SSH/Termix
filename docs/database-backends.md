# Database backends

Termix runs on SQLite by default. Postgres and MySQL are supported for
self-hosted deployments; this document records how the three differ, because the
differences are not only about SQL.

## This is multi-backend, not a migration

SQLite is not going away. The desktop app embeds its own backend and cannot ship
a database server, so it will always run on SQLite. Postgres and MySQL exist for
self-hosted deployments that need more than one process to reach the data —
multiple replicas, an external backup story, or an existing database estate.

Anything that assumes a single engine is wrong.

## Where the schema comes from

`src/backend/database/db/schema.ts` is the single source of truth, written
against `drizzle-orm/sqlite-core`.

`schema.pg.ts` and `schema.mysql.ts` are **generated** from it:

```bash
npm run schema:generate    # rewrite the generated modules
npm run schema:check       # fail if they are out of date (runs as part of lint)
```

Never edit the generated files. `npm run lint` fails if they drift from the
source, so a schema change that forgets to regenerate cannot reach main.

The transforms are mechanical:

| sqlite                                           | postgres          | mysql                   |
| ------------------------------------------------ | ----------------- | ----------------------- |
| `integer(…, { mode: "boolean" })`                | `boolean`         | `boolean`               |
| `integer(…).primaryKey({ autoIncrement: true })` | `serial`          | `int().autoincrement()` |
| `integer`                                        | `integer`         | `int`                   |
| `real`                                           | `doublePrecision` | `double`                |
| `text` used as a key                             | `varchar(255)`    | `varchar(255)`          |

A column becomes `varchar` if it is a primary key, is unique, or sits on either
end of a foreign key — MySQL cannot index an unbounded `TEXT`, and both sides of
a foreign key must agree.

## Durability

On SQLite the database is loaded into memory and serialised back to an encrypted
file, so every write needs an explicit flush. That is what the `onWrite` hook
each repository receives is for.

On Postgres and MySQL a committed write is already durable. No hook is installed
at all — see `needsExplicitPersist` in `db/dialect.ts`.

## Encryption: what changes, and what does not

This is the part most likely to be misread, so it is spelled out.

### Unchanged on every backend

**Field-level encryption still applies.** Credentials and other sensitive values
are encrypted in the application before they reach the database, under a
per-user data key:

- `ssh_data` — passwords, private keys, key passphrases, sudo/RDP/VNC/Telnet
  secrets
- `ssh_credentials` — passwords, private and public keys
- `users` — TOTP secret and backup codes
- `vault_tokens`, `opkssh_tokens`, `termix_identity_ca` — certificates and keys
- `shared_host_secrets` — re-encrypted per recipient

Installation-level secrets — the OIDC client secret and LDAP bind password —
are encrypted under the system key, since they have no owning user and must be
readable during login.

This is the protection that matters most, and it is identical on all three
engines.

### Different on Postgres and MySQL

**Whole-file encryption does not exist.** On SQLite the database file itself is
encrypted at rest. There is no equivalent for a client-server engine: the data
lives in the server's storage, not in a file Termix owns.

Concretely, on Postgres/MySQL the following are readable by anyone with database
access, where on SQLite they were covered by the file encryption:

- host names, addresses, ports and usernames
- folder and snippet names, and **snippet contents**
- audit log entries
- session recording metadata and paths
- user names, roles and API key hashes

None of these are credentials — those stay encrypted — but together they
describe your estate.

**If you run Postgres or MySQL, encryption at rest is your responsibility**:
transparent data encryption, an encrypted volume, or an encrypted filesystem.
Termix does not provide it and cannot.

### Threat model, side by side

|                                                 | SQLite                                           | Postgres / MySQL                                                   |
| ----------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------ |
| Stolen database file / volume                   | credentials encrypted, everything else encrypted | credentials encrypted, **rest depends on your storage encryption** |
| Database access without app access              | credentials unreadable                           | credentials unreadable                                             |
| Application compromise while a user is unlocked | that user's secrets readable                     | same                                                               |
| Backups                                         | inherit file encryption                          | **plain unless you encrypt them**                                  |

The second row is the point of field-level encryption, and it holds everywhere.
The first and last rows are where the backends genuinely differ.

## Running on Postgres or MySQL

Two variables. Unset, nothing changes and SQLite is used exactly as before.

```
DATABASE_DIALECT=postgres
DATABASE_URL=postgres://user:password@host:5432/termix
```

```
DATABASE_DIALECT=mysql
DATABASE_URL=mysql://user:password@host:3306/termix
```

`mariadb://` is accepted for MySQL. The scheme is checked against the dialect
before a connection is attempted, so a mismatch fails with a readable message
rather than a driver error deep in a stack.

Point it at an **empty** database. Migrations are applied at startup, from
`drizzle/postgres` or `drizzle/mysql`, and drizzle records what it has applied —
so several instances against one database are safe, and so is restarting.

There is no migration path from an existing SQLite database. Exporting one and
importing it into Postgres is not something this branch does.

### Docker

`drizzle/` ships in the image. A compose service needs only the two variables:

Added to the compose file in the README, that is one service and two variables:

```yaml
services:
  termix:
    image: ghcr.io/lukegus/termix:latest
    environment:
      PORT: "8080"
      DATABASE_DIALECT: postgres
      DATABASE_URL: postgres://termix:termix@db:5432/termix
    depends_on:
      - db

  db:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: termix
      POSTGRES_PASSWORD: termix
      POSTGRES_DB: termix
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

`DATA_DIR` is still used for uploads and recordings on every backend. Only the
database itself moves.

## What is verified, and how

`npm run verify:dialect -- <url>` applies the migrations to an empty database and
drives the real repository classes against it, asserting values rather than the
absence of exceptions.

The repository test suite also runs against each engine:

```
TEST_DIALECT=postgres TEST_DATABASE_URL=<url> npx vitest run \
  src/backend/tests/database/repositories --no-file-parallelism
```

CI runs both, against PostgreSQL 16 and MySQL 8 service containers. Eighteen
tests assert on bytes stored by the SQLite driver and skip on other engines;
they still run in the SQLite pass.

Tested against PostgreSQL 16 and MySQL 8. **MariaDB is not a substitute for
MySQL when testing** — it accepts DDL that MySQL 8 rejects, which has hidden a
real defect here more than once.

## Known limits

- The desktop app always uses SQLite. It embeds its own backend and cannot ship
  a database server.
- Repositories import the SQLite table definitions on every engine. That is
  correct — the query builder needs identifiers and value encoders, and those
  agree — but it means `PortableDatabase` is a named approximation rather than a
  guarantee. See `repositories/database-context.ts`.
- `getCurrentSettingValue` is a synchronous read. On Postgres and MySQL it comes
  from a cache primed at startup and kept current by `SettingsRepository`,
  because those drivers have no synchronous query.
- **Importing a backup is SQLite-only.** The restore writes tables in an order
  that is not dependency-safe and relies on `PRAGMA foreign_keys = OFF`, which
  has no equivalent here: Postgres needs superuser to disable triggers, and
  MySQL's session-scoped switch is not guaranteed across a pool. It refuses with
  a message rather than failing partway through and leaving a half-restored
  database. Restore into Postgres or MySQL with their own tooling.
- **`LIKE` is case-insensitive on SQLite and case-sensitive on Postgres.** The
  four places that use it match folder path prefixes and settings keys, so the
  practical effect is that renaming a folder `prod` on SQLite also catches
  `PROD / api` and on Postgres does not. Postgres is arguably the more correct
  of the two; nothing was changed to make them agree, because that would alter
  SQLite behaviour for existing deployments.
- The SQLite-era data migrations — legacy shared-credential cleanup, the
  shared-host-secrets rebuild, per-user field-encryption backfill — do not run on
  the other engines. A database created by the drizzle migrations never had the
  shapes they repair.
