# Database Layer Refactor Plan

Status: Draft  
Branch: `chore/database-layer-refactor-draft`  
Target: Replace the current in-memory encrypted SQLite snapshot model with a persistent, secure, multi-database architecture.

## 1. Background

Termix currently uses an encrypted SQLite snapshot model:

```text
db.sqlite.encrypted
  -> decrypt on startup
  -> open as in-memory SQLite
  -> runtime reads/writes memory database
  -> serialize whole database
  -> encrypt and write snapshot back to disk
```

This works well for small single-instance deployments, but it creates several long-term problems:

- Recent writes can be lost if the process crashes before the snapshot save runs.
- Direct database writes can forget to call `DatabaseSaveTrigger`, causing data to exist only in memory.
- Saving requires serializing and encrypting the whole database, so cost grows with database size.
- The architecture cannot safely support multiple backend instances.
- It blocks clean PostgreSQL/MySQL support because business code depends directly on SQLite and Drizzle SQLite tables.

The refactor should keep Termix secure while moving persistence to real database writes.

## 2. Goals

- Support persistent database backends:
  - SQLite
  - PostgreSQL
  - MySQL/MariaDB
- Keep sensitive data encrypted at the field level.
- Remove dependence on full in-memory database snapshots.
- Introduce a database adapter boundary.
- Move direct database access behind repositories/services.
- Provide a safe upgrade path from the existing encrypted SQLite snapshot.
- Preserve existing user data, encryption keys, credentials, hosts, settings, audit records, and feature data.
- Keep runtime-only state in memory:
  - SSH clients
  - WebSocket sessions
  - tunnels
  - metrics polling sessions
  - transfer runtime state
- Make migrations deterministic, idempotent, and rollback-safe.

## 3. Non-Goals

- Do not rewrite the whole backend at once.
- Do not force existing users to configure PostgreSQL or MySQL during normal upgrade.
- Do not remove SQLite support.
- Do not store SSH live sessions, WebSocket handles, or tunnel process handles in the database.
- Do not encrypt every field blindly. Searchable and sortable metadata should stay queryable unless it is sensitive.
- Do not change user-facing behavior unless required by the storage model.

## 4. Current Architecture

### 4.1 Database Runtime

- Database initialization lives in `src/backend/database/db/index.ts`.
- `actualDbPath` is `:memory:`.
- Encrypted database files are decrypted into memory on startup.
- Runtime database access uses Drizzle over `better-sqlite3`.
- On save, the whole memory database is serialized and encrypted.

### 4.2 Save Behavior

- `SimpleDBOps.insert/update/delete` triggers `DatabaseSaveTrigger`.
- Some routes call `getDb().insert/update/delete` or raw SQLite directly.
- Direct writes must manually call `DatabaseSaveTrigger.triggerSave()`.
- This creates a persistence gap when direct writes forget to trigger saves.

### 4.3 Runtime State

The following state is intentionally memory-only today and should remain memory-only:

- Terminal sessions in `terminal-session-manager.ts`
- File manager sessions in `file-manager.ts`
- Metrics sessions and caches in `host-metrics-sessions.ts` and `host-metrics-state.ts`
- Tunnel runtime maps in `tunnel.ts`
- Pending OPKSSH/Vault/OIDC authentication sessions

### 4.4 Schema State

- Schema is declared with `sqliteTable` in `src/backend/database/db/schema.ts`.
- Additional schema setup is done manually through `CREATE TABLE IF NOT EXISTS`.
- Schema migration uses many `addColumnIfNotExists` calls.
- This is tightly coupled to SQLite.

## 5. Target Architecture

```text
Backend Feature Code
  -> Service Layer
  -> Repository Layer
  -> Database Adapter
       -> SQLite
       -> PostgreSQL
       -> MySQL/MariaDB
  -> Field Encryption Boundary
  -> Persistent Database
```

### 5.1 Database Adapter

Introduce a database runtime module responsible for:

- Reading database configuration.
- Creating the correct database client.
- Running migrations.
- Exposing a typed query context.
- Handling database-specific transaction behavior.
- Hiding dialect-specific differences from business logic.

Proposed configuration:

```env
DB_TYPE=sqlite
DATABASE_URL=file:/app/data/termix.sqlite

# or
DB_TYPE=postgres
DATABASE_URL=postgres://termix:password@postgres:5432/termix

# or
DB_TYPE=mysql
DATABASE_URL=mysql://termix:password@mysql:3306/termix

SYSTEM_KEY=...
```

SQLite should remain the default.

### 5.2 Repository Layer

Business code should stop calling `getDb()` directly.

Examples:

```ts
hostRepository.getById(userId, hostId)
hostRepository.create(userId, input)
credentialRepository.resolveForHost(userId, hostId)
sessionRepository.create(userId, sessionData)
auditRepository.write(event)
settingsRepository.get(key)
```

Repositories should own:

- Query construction
- Data mapping
- Field encryption/decryption
- Permission-aware reads where appropriate
- Transaction participation
- Database-specific compatibility

### 5.3 Service Layer

Services should own business workflows:

- Host creation/update/delete
- Credential resolution
- User/session lifecycle
- RBAC operations
- Import/export
- Migration orchestration

Services can call multiple repositories inside one transaction.

### 5.4 Runtime State Boundary

Runtime state should remain in process memory and should not be migrated into the database:

- SSH connection objects
- PTY streams
- SFTP handles
- WebSocket instances
- Timers
- Child processes
- Pending MFA/auth prompts

The database should store only durable metadata:

- session recording metadata
- audit events
- user open tabs, if still needed
- tunnel definitions, not live tunnel handles
- metrics history, not active polling state

## 6. Security Model

### 6.1 Keep Field-Level Encryption

Sensitive fields must be encrypted before entering any persistent database:

- SSH passwords
- SSH private keys
- SSH key passphrases
- credential secrets
- TOTP secrets and backup codes
- OAuth/OIDC client secrets
- Vault tokens
- OPKSSH tokens/cert cache secrets
- API tokens or token material
- RDP/VNC/Telnet passwords

### 6.2 Keep Queryable Metadata Plain

Some data should remain queryable:

- numeric IDs
- user IDs
- host names
- folders
- tags
- enable flags
- timestamps
- connection type
- port numbers
- status/config flags

For fields like host IP/domain, decide explicitly:

- Plaintext improves search, sorting, and connection setup.
- Encrypted improves confidentiality.
- If encrypted, consider additional blind indexes for search.

### 6.3 Envelope Encryption

Recommended model:

```text
SYSTEM_KEY
  -> wraps application/database keys
  -> wraps per-user data keys
  -> per-user data keys encrypt user-owned secrets
```

Each encrypted field should include enough metadata for future rotation:

```json
{
  "v": 2,
  "alg": "aes-256-gcm",
  "kid": "user-key-id",
  "iv": "...",
  "tag": "...",
  "ct": "..."
}
```

### 6.4 Key Rotation

The new design should support:

- Detecting encryption version.
- Reading old ciphertext.
- Writing new ciphertext.
- Lazy migration on write.
- Optional explicit re-encryption job.

### 6.5 Database-Level Encryption

Field-level encryption is required for all database types.

Optional database/file encryption:

- SQLite can optionally use encrypted file storage later.
- PostgreSQL/MySQL should rely on field encryption plus deployment-level disk encryption/TLS.
- Do not require full database encryption for correctness.

## 7. Database Support Strategy

### 7.1 SQLite

SQLite remains the default for simple self-hosted installs.

Requirements:

- Direct persistent SQLite file, not in-memory snapshot.
- WAL mode if safe for the deployment model.
- Proper shutdown handling.
- No full database serialize on every save.

### 7.2 PostgreSQL

PostgreSQL should be the preferred production multi-user backend.

Requirements:

- Connection pool.
- Transaction support.
- Native boolean/timestamp handling.
- JSONB where useful.
- Migration support.
- TLS support through connection string options.

### 7.3 MySQL/MariaDB

MySQL/MariaDB support should be implemented after SQLite and PostgreSQL are stable.

Requirements:

- Connection pool.
- Compatible migrations.
- JSON/text behavior reviewed.
- Timestamp/default behavior reviewed.
- `RETURNING` differences handled at repository/adapter level.

### 7.4 Dialect Differences to Handle

- Boolean storage
- Auto-increment IDs
- Timestamp defaults
- JSON columns
- `RETURNING`
- Upsert syntax
- Case sensitivity and collations
- Foreign key enforcement
- Transaction isolation
- Raw SQL fragments

## 8. Migration Strategy

### 8.1 Default Upgrade Path

Default user upgrade should not require external database setup.

Recommended default:

```text
old encrypted SQLite snapshot
  -> decrypt with existing logic
  -> normalize old schema
  -> migrate to new persistent SQLite
  -> keep old snapshot as backup
```

PostgreSQL/MySQL migration should be explicit:

```bash
termix migrate-db --from sqlite --to postgres
termix migrate-db --from sqlite --to mysql
```

or later through an admin UI.

### 8.2 Backup Rules

Before migration:

- Verify source database can be decrypted.
- Verify target database can be connected.
- Verify target schema can be migrated.
- Create a timestamped backup of the old encrypted database.
- Do not delete the old encrypted snapshot automatically.

Suggested backup naming:

```text
db.sqlite.encrypted.pre-db-refactor-YYYYMMDD-HHmmss
```

### 8.3 Migration Marker

New databases should store migration state:

```text
schema_migrations
  id
  version
  name
  applied_at
  checksum

system_migrations
  key
  value
  applied_at
```

The old snapshot migration should have a one-shot marker:

```text
legacy_snapshot_migrated = true
legacy_snapshot_source_hash = ...
legacy_snapshot_migrated_at = ...
```

### 8.4 Idempotency

Migration must be safe to rerun after interruption.

Rules:

- Never destroy the source before full success.
- Use unique keys or deterministic IDs where possible.
- Commit in table-level or batch-level transactions.
- Write migration markers only after successful commit.
- On startup, detect partial migration and either resume or fail safely.

### 8.5 Dry Run

Add a dry-run mode:

```bash
termix migrate-db --dry-run
```

Dry run should report:

- Source database detected
- Source schema version
- Target database type
- Target reachability
- Tables to migrate
- Row counts
- Unsupported old schema issues
- Estimated warnings

### 8.6 Old Version Compatibility

Users may upgrade from older Termix versions.

Migration must:

- Run old schema normalization first.
- Add missing columns in the legacy reader if needed.
- Handle absent optional tables.
- Handle older ciphertext formats.
- Handle old settings keys.

### 8.7 Failure Behavior

If migration fails:

- New app should not start with an empty database.
- Old encrypted snapshot should remain untouched.
- Error logs should identify the failed stage.
- User should get recovery instructions.
- Retrying should be safe.

## 9. Implementation Phases

### Phase 0: Audit and Design Lock

Estimated time: 2-3 days

Tasks:

- Inventory all database tables.
- Inventory all `getDb()`, `getSqlite()`, raw SQL, and `DatabaseSaveTrigger` usage.
- Classify tables by domain:
  - auth/users
  - hosts/credentials
  - RBAC/sharing
  - terminal/session logs
  - file manager
  - snippets
  - metrics/alerts
  - homepage/preferences
  - tunnels/proxmox/guacamole/vault/opkssh
- Mark sensitive fields.
- Decide SQLite/PostgreSQL/MySQL type mapping.
- Decide migration framework.

Deliverables:

- Database access inventory.
- Sensitive field map.
- Final adapter/repository interface proposal.

### Phase 1: Adapter Foundation

Estimated time: 3-5 days

Tasks:

- Introduce database config parser.
- Introduce adapter interface.
- Add SQLite persistent adapter.
- Add migration table.
- Add transaction helper.
- Keep old code path running.
- Add tests for config and adapter initialization.

Deliverables:

- `DB_TYPE=sqlite` persistent adapter works in isolation.
- No business routes migrated yet.

### Phase 2: Repository Skeleton

Estimated time: 4-6 days

Tasks:

- Create repository interfaces.
- Implement initial SQLite-backed repositories.
- Add encryption boundary helpers.
- Add repository tests with SQLite.
- Prevent new direct `getDb()` usage in new code.

Initial repositories:

- settings
- users
- sessions
- hosts
- credentials
- audit

Deliverables:

- Core repositories compile and pass tests.
- Existing routes can still run through compatibility shims.

### Phase 3: Core Vertical Slice

Estimated time: 1-2 weeks

Tasks:

- Migrate user/session auth flows.
- Migrate settings routes.
- Migrate hosts CRUD.
- Migrate credentials CRUD and credential resolution.
- Migrate host resolver and permission-critical reads.
- Add transaction coverage for multi-table operations.
- Verify field encryption behavior.

Acceptance criteria:

- User login/logout/session validation works.
- Host create/update/delete works.
- Credential create/update/delete/resolve works.
- Existing encrypted user data remains readable.
- No snapshot save trigger needed for migrated core paths.

### Phase 4: Feature Data Migration

Estimated time: 1-2 weeks

Tasks:

- RBAC and sharing
- folders/tags
- snippets and snippet access
- file manager bookmarks/recent/pinned/shortcuts
- dashboard/homepage/preferences/open tabs
- alerts and notification channels
- metrics preferences/history/health checks
- tunnels and C2S presets
- Proxmox config
- Guacamole config
- OPKSSH/Vault records
- audit logs
- API keys

Acceptance criteria:

- Direct feature routes use repositories or domain services.
- Growth tables have retention strategy where appropriate.
- Runtime-only data remains memory-only.

### Phase 5: Multi-Database Support

Estimated time: 1-2 weeks

Tasks:

- Add PostgreSQL adapter.
- Add MySQL/MariaDB adapter.
- Add dialect-specific schema/migrations.
- Add CI matrix for SQLite/PostgreSQL/MySQL if feasible.
- Replace SQLite-only raw SQL in migrated paths.
- Add Docker compose examples.

Acceptance criteria:

- Fresh install works on SQLite.
- Fresh install works on PostgreSQL.
- Fresh install works on MySQL/MariaDB.
- Core CRUD tests pass across supported databases.

### Phase 6: Legacy Snapshot Migration

Estimated time: 1 week

Tasks:

- Implement legacy encrypted snapshot reader.
- Normalize legacy schema in memory.
- Migrate legacy snapshot to new SQLite.
- Keep backup of old encrypted snapshot.
- Add dry-run.
- Add migration logs.
- Add recovery documentation.

Acceptance criteria:

- Existing encrypted SQLite snapshot migrates to new persistent SQLite.
- Migration can be retried safely.
- Failed migration leaves old data untouched.

### Phase 7: External Database Migration Tool

Estimated time: 3-5 days

Tasks:

- Add CLI or admin-only migration command.
- Support SQLite to PostgreSQL.
- Support SQLite to MySQL/MariaDB.
- Add dry-run and validation.
- Add clear rollback instructions.

Acceptance criteria:

- Existing SQLite install can be migrated to PostgreSQL/MySQL explicitly.
- Migration is not automatic unless user opts in.

### Phase 8: Cleanup and Enforcement

Estimated time: 3-5 days

Tasks:

- Remove in-memory snapshot runtime path.
- Remove `DatabaseSaveTrigger` from normal persistence.
- Keep only legacy import compatibility.
- Add lint/test guard against direct database access outside approved modules.
- Update docs.

Acceptance criteria:

- Business modules no longer import `getDb()` directly except approved infrastructure/repository files.
- `DatabaseSaveTrigger` is no longer required for normal data durability.
- Old snapshot code is isolated to legacy migration/import.

## 10. Testing Plan

### 10.1 Unit Tests

- Encryption/decryption helpers
- Repository mapping
- Adapter config parsing
- Migration idempotency
- Legacy ciphertext compatibility
- Dialect-specific value conversion

### 10.2 Integration Tests

Run core flows against:

- SQLite
- PostgreSQL
- MySQL/MariaDB

Core flows:

- user create/login/logout/session validation
- host CRUD
- credential CRUD and host resolution
- RBAC host sharing
- snippet CRUD
- settings update
- audit write/read

### 10.3 Migration Tests

Fixtures:

- latest legacy encrypted snapshot
- older legacy snapshot with missing columns
- snapshot with no optional feature tables
- snapshot with encrypted credentials
- snapshot with large metrics/audit tables

Checks:

- row counts match
- sensitive fields decrypt after migration
- target app starts
- rerun does not duplicate data
- failed migration preserves source

### 10.4 Manual QA

- Fresh SQLite install
- Fresh PostgreSQL install
- Fresh MySQL install
- Upgrade from existing encrypted SQLite install
- Switch to external DB through explicit migration
- Docker deployment
- Electron/local deployment if supported

## 11. Rollout Plan

### Version N

- Add new architecture behind SQLite default.
- Auto-migrate legacy encrypted snapshot to new persistent SQLite.
- PostgreSQL/MySQL marked experimental or manual.
- Keep legacy snapshot backup.

### Version N+1

- Stabilize PostgreSQL/MySQL.
- Add admin UI or CLI migration tooling.
- Improve docs and diagnostics.

### Version N+2

- Remove old snapshot runtime path.
- Keep legacy import compatibility only.

## 12. User Upgrade Behavior

Default upgrade should be boring:

1. User updates Termix.
2. App detects old encrypted snapshot.
3. App creates backup.
4. App migrates to new persistent SQLite.
5. App starts normally.
6. Old snapshot remains available for recovery.

External DB migration should be opt-in:

1. User configures target database.
2. User runs dry-run.
3. User confirms migration.
4. App migrates data.
5. App writes new DB config marker.
6. App starts on external DB.

## 13. Operational Considerations

### 13.1 Backups

- SQLite: backup file copy with app stopped, or online backup API.
- PostgreSQL/MySQL: recommend native backup tooling.
- Sensitive fields remain encrypted in backups.

### 13.2 Observability

Add logs for:

- adapter selected
- migration start/end
- migration table/version
- row counts per table
- legacy snapshot backup path
- encryption version warnings
- failed migration stage

### 13.3 Performance

Expected improvements:

- No full database serialization on every save.
- Large audit/metrics tables no longer increase snapshot save cost.
- External DBs can handle larger multi-user installs.

New costs:

- Network latency for external DBs.
- Connection pool tuning.
- More complex migrations.

### 13.4 Deployment

Docker should support:

- default SQLite volume
- PostgreSQL compose example
- MySQL/MariaDB compose example
- clear `DATABASE_URL` examples

## 14. Risk Register

| Risk | Severity | Mitigation |
|---|---:|---|
| User data cannot decrypt after migration | Critical | Preserve key model, add fixtures, dry-run decryption checks |
| Migration partially writes target DB | High | Transactions, migration markers, idempotent batches |
| Old snapshot overwritten or deleted | Critical | Never delete source automatically, backup before migration |
| Direct DB access remains scattered | High | Repository enforcement and lint guard |
| Dialect differences break features | High | Adapter tests and DB matrix |
| Sensitive fields accidentally stored plaintext | Critical | Central encryption boundary and sensitive field map |
| Large migrations block startup too long | Medium | Progress logs, batching, optional preflight |
| External DB configuration confuses users | Medium | Keep SQLite default, make external DB opt-in |
| Runtime state accidentally persisted | Medium | Explicit runtime/persistent boundary |

## 15. Initial Work Breakdown

Recommended first PRs:

1. Add database access inventory and sensitive field map.
2. Add adapter interfaces and SQLite persistent adapter skeleton.
3. Add repository skeleton for settings/users/hosts/credentials.
4. Add field encryption boundary tests.
5. Migrate settings as the first low-risk vertical slice.
6. Migrate users/sessions.
7. Migrate hosts/credentials.
8. Add legacy snapshot migration dry-run.

## 16. Open Decisions

- Should host IP/domain be encrypted, plaintext, or plaintext with optional privacy mode?
- Should metrics history stay in the main database or support separate retention storage?
- Should session log content remain file-based with DB metadata only?
- Should PostgreSQL be considered stable before MySQL/MariaDB?
- Should external DB migration be CLI-only first, or include admin UI from the start?
- Should old encrypted snapshot import remain forever as an import feature?

## 17. Estimated Total Effort

Conservative estimate for full implementation:

- Minimum: 3 weeks with reduced scope and SQLite/PostgreSQL focus.
- Realistic: 4-6 weeks for SQLite/PostgreSQL/MySQL, migration, tests, docs.
- Safer production-grade rollout: 6-8 weeks including extensive legacy fixtures and external DB QA.

Recommended planning estimate: 5 weeks.

## 18. Recommended Starting Point

Do not start by replacing every `getDb()` call.

Start with a vertical slice:

```text
settings -> users/sessions -> hosts -> credentials
```

This validates:

- adapter shape
- repository shape
- transaction shape
- field encryption
- migration pattern
- test strategy

After that slice works, migrate the rest domain by domain.
