# Database Layer Refactor Plan

Status: Draft  
Branch: `feature/database-layer-refactor`  
Target: Replace the current in-memory encrypted SQLite snapshot model with a persistent, secure, multi-database architecture.

Phase 0 audit: [`DATABASE-LAYER-PHASE-0-AUDIT.md`](./DATABASE-LAYER-PHASE-0-AUDIT.md)
Gray rollout guide: [`DATABASE-LAYER-GRAY-ROLLOUT.md`](./DATABASE-LAYER-GRAY-ROLLOUT.md)

Phase 1 status: database runtime config and SQLite adapter skeleton have started under
`src/backend/database/runtime/`. This code is not wired into the existing production
database initialization yet.

Repository status: the first repository skeletons, `SettingsRepository`,
`UserRepository`, `SessionRepository`, `HostRepository`, and
`CredentialRepository`, have started under `src/backend/database/repositories/`.
`RoleRepository` has also started for the RBAC role/user-role slice, and these
repositories are covered by SQLite-backed tests. `RbacAccessRepository` has
started for RBAC host/snippet access-list read models.

Field encryption status: repository-level field encryption boundary tests have
started. New field encryption requires a stable record id and must not invent a
temporary encryption context.

Settings migration status: a first low-risk production route slice now uses
`SettingsRepository` through the current SQLite runtime context. Legacy in-memory
runtime writes still force a snapshot save through `DatabaseSaveTrigger`.
The user settings route has also moved its direct `settings` table reads and
writes behind `SettingsRepository`.
Host metrics settings routes now use the same repository boundary for global
monitoring defaults and history retention settings.
ACME SSL settings route also uses the repository boundary for its persisted
configuration key.
Terminal route session settings and command history global flag now read/write
through `SettingsRepository`.
Tailscale device route now reads its API key through `SettingsRepository`.
Guacamole route and WebSocket server now read `guac_url` through the current
settings repository boundary.
Authentication token expiry and terminal session timeout reads now use the
current settings repository boundary.
Open tabs, TOTP, and LDAP auth routes now read their settings through the
current settings repository boundary.
Host metrics polling now reads global interval and retention settings through
the current settings repository boundary.
Backend startup now reads persisted log level and Guacamole enablement through
the current settings repository boundary.
User deletion cleanup now removes per-user settings through
`SettingsRepository.deleteLike`.
Password reset route now stores reset codes and temporary reset tokens through
`SettingsRepository`.
OIDC utility legacy config fallback now reads `oidc_config` through
`SettingsRepository`.
User route registration/password flags and OIDC config administration now use
the current settings repository boundary.
OIDC authorize/callback temporary state and auto-provision reads now use the
current settings repository boundary.
User login settings reads now use the current settings repository boundary, so
`routes/users.ts` no longer reads or writes `settings` directly.
User encryption metadata in `utils/user-crypto.ts` now reads and writes KEK/DEK
settings through the current settings repository boundary.
Database startup and schema migration defaults in `database/db/index.ts` now use
local raw settings helpers instead of scattered settings SQL.
Database import/export settings handling in `database/database.ts` now uses
local helper boundaries for export filtering and admin import upserts.
Session repository now has a current-runtime factory and write-save hook, and
core `auth-manager.ts` session create/read/update/revoke/list paths have started
using it.
Remaining `auth-manager.ts` session cleanup/middleware/logout paths and
`user-session-routes.ts` single-session lookup now use the current session
repository boundary.
User repository now has a current-runtime factory and write-save hook, and
`user-admin-routes.ts` list/admin promotion/admin removal/admin-create user
paths now use it for `users` table reads and writes.
Low-risk `routes/users.ts` current-user lookup and admin gate checks now use the
current user repository boundary.
User registration, self-delete, password change hash updates, and admin
delete-user lookup paths in `routes/users.ts` now use the current user
repository boundary while preserving the first-user admin transaction inside
`UserRepository`.
Traditional login username lookup and `auth-manager.ts` admin user checks now
use the current user repository boundary.
GitHub and standard OIDC callback user lookup/create/rollback/profile/admin
sync writes now use the current user repository boundary, removing direct
Drizzle `users` table access from `routes/users.ts`, `user-admin-routes.ts`,
and `auth-manager.ts`.
API key create/list/delete and API key authentication last-used updates now use
the current API key repository boundary.
Trusted device check/add/remove and TOTP trusted-device cleanup now use the
current trusted device repository boundary.
User session routes now use the current user repository boundary for user/admin
lookups and admin session username enrichment.
Vault admin checks, Termix ID audit actor username lookup, permission manager
admin checks, and user data export user lookup now use the current user
repository boundary.
SSH credential OIDC username expansion and tmux monitor audit actor username
lookup now use the current user repository boundary.
User settings route admin checks and audit actor username lookups now use the
current user repository boundary, removing direct DB/schema imports from that
route module.
ACME SSL route admin checks and audit actor username lookups now use the current
user repository boundary, removing direct DB/schema imports from that route
module.
Audit log route admin checks now use the current user repository boundary,
removing direct `users` access from that route module.
OIDC account link/unlink route user lookups and OIDC field updates now use the
current user repository boundary, removing direct `users` access from that route
module.
Password reset route user lookups, password hash updates, and TOTP reset fields
now use the current user repository boundary while retaining existing direct
cleanup of per-user encrypted data tables.
User deletion helper now removes sessions through the current session repository
and deletes the final user record through the current user repository while
retaining direct cleanup of non-migrated related tables.
Snippet create/update/delete audit actor username lookups now use the current
user repository boundary; the remaining snippet `users` usage is the shared
snippet owner join.
LDAP login existing-user lookup, encryption rollback delete, admin sync, and
display-name sync now use the current user repository boundary while retaining
the existing first-user creation transaction.
TOTP setup/enable/disable/backup-code/login verification user updates and
session revocation now use the current user/session repository boundaries.
RBAC host sharing, role assignment, and snippet sharing target-user existence
checks now use the current user repository boundary while retaining existing
RBAC/snippet owner username joins.
RBAC role list/create/update/delete, user-role assignment/removal/listing, and
shared host/snippet role-id lookups now use the current role repository
boundary while retaining existing RBAC/share credential joins in the route.
Permission manager role permission aggregation, role-id lookups for shared host
access, and admin role checks now use the current role repository boundary.
RBAC host/snippet access-list read models now use the current RBAC access
repository boundary, and snippet route shared-access role-id lookups now use the
current role repository boundary.
RBAC shared host/shared snippet read models and the main snippet shared-snippet
read model now use the current RBAC access repository boundary.
RBAC host/snippet access grant, revoke, and direct host-access credential
override writes now use the current RBAC access repository boundary while
retaining shared credential material creation in the existing manager.
Permission manager host-access expiration cleanup, shared host-access lookup,
and last-access timestamp updates now use the current RBAC access repository
boundary.
RBAC role assignment now reads role-shared host credential sources through the
current RBAC access repository boundary while keeping shared credential material
creation in the existing manager.
Snippet single-item shared-access checks now use the current RBAC access
repository boundary.
Shared credential manager host-access lookups for role-member credential
creation, shared credential reads, and pending re-encryption owner discovery now
use the current RBAC access repository boundary.
Host route host-access cleanup writes for credential removal and host deletion
now use the current RBAC access repository boundary.
Host route shared-host list access checks now use the current role and RBAC
access repository boundaries while host row loading stays local to the host
route.
Credential deletion, folder deletion, and user deletion host-access cleanup
writes now use the current RBAC access repository boundary.
Shared credential manager role-member lookups now use the current role
repository boundary.
User deletion role-assignment cleanup now uses the current role repository
boundary.
User admin route role sync and admin-created default role assignment now use
the current role repository boundary.
LDAP login default role assignment and admin-role sync now use the current role
repository boundary.
Local, GitHub OIDC, and standard OIDC user default role assignment plus OIDC
admin-group role sync now use the current role repository boundary.
SSO provider listing, management, OIDC config loading, and LDAP provider
validation now use the current SSO provider repository boundary.
Audit log writes, filtered reads, action lists, and user cleanup now use the
current audit log repository boundary.
User preferences read/write and user cleanup now use the current user
preference repository boundary.
Open tab restore/upsert/sync/update/delete and user cleanup now use the current
open tab repository boundary.
Dismissed alert read/dismiss/undismiss/export and user cleanup now use the
current dismissed alert repository boundary.
Homepage layout read/write now uses the current homepage layout repository
boundary.
Homepage item list/create/update/delete now uses the current homepage item
repository boundary.
Network topology read/write and user cleanup now use the current network
topology repository boundary.
Dashboard service link list/create/update/delete now uses the current dashboard
service link repository boundary.
Session recording create/list/read/content/delete/prune and host/folder/user
cleanup now uses the current session recording repository boundary.
Command history save/list/delete and host/user cleanup now use the current
command history repository boundary.
Recent activity host/user cleanup now uses the current recent activity
repository boundary.
SSH credential usage writes and host/user cleanup now use the current SSH
credential usage repository boundary.
Transfer recent list/upsert/prune/export and host/folder/user cleanup now use
the current transfer recent repository boundary.
File manager recent/pinned/shortcut list/create/delete/export and
host/folder/user/password-reset cleanup now use the current file manager
bookmark repository boundary.
C2S tunnel preset list/create/update/delete now uses the current C2S tunnel
preset repository boundary.
Tmux session tag list/rename/delete/replace now uses the current tmux session
tag repository boundary.
OPKSSH token upsert/read/touch/delete and user cleanup now use the current
OPKSSH token repository boundary.
Vault token upsert/read/touch/delete now uses the current Vault token repository
boundary.
Vault profile list/create/update/delete and profile lookup now use the current
Vault profile repository boundary.
Host metrics layout preference read/upsert now uses the current host metrics
preference repository boundary.
Host health check config and history read/write now use the current host health
repository boundary.
Host metrics history record/prune/query now uses the current host metrics
history repository boundary.
Alert notification channels, rules, linked channels, firings, and alert engine
persistence reads/writes now use the current alert repository boundary.

Gray rollout status: the branch is expanding the repository boundary slice while
keeping every migrated domain behind `DATABASE_LAYER_REPOSITORY_ROLLOUT`, which
supports `all`, `off`, and a comma-separated allowlist for controlled gray
targets.

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
hostRepository.getById(userId, hostId);
hostRepository.create(userId, input);
credentialRepository.resolveForHost(userId, hostId);
sessionRepository.create(userId, sessionData);
auditRepository.write(event);
settingsRepository.get(key);
```

Repositories should own:

- Query construction
- Data mapping
- Field encryption/decryption
- Stable record-id enforcement before encrypting field values
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

| Risk                                           | Severity | Mitigation                                                  |
| ---------------------------------------------- | -------: | ----------------------------------------------------------- |
| User data cannot decrypt after migration       | Critical | Preserve key model, add fixtures, dry-run decryption checks |
| Migration partially writes target DB           |     High | Transactions, migration markers, idempotent batches         |
| Old snapshot overwritten or deleted            | Critical | Never delete source automatically, backup before migration  |
| Direct DB access remains scattered             |     High | Repository enforcement and lint guard                       |
| Dialect differences break features             |     High | Adapter tests and DB matrix                                 |
| Sensitive fields accidentally stored plaintext | Critical | Central encryption boundary and sensitive field map         |
| Large migrations block startup too long        |   Medium | Progress logs, batching, optional preflight                 |
| External DB configuration confuses users       |   Medium | Keep SQLite default, make external DB opt-in                |
| Runtime state accidentally persisted           |   Medium | Explicit runtime/persistent boundary                        |

## 15. Initial Work Breakdown

Recommended first PRs:

1. Add database access inventory and sensitive field map. (Started in `DATABASE-LAYER-PHASE-0-AUDIT.md`)
2. Add adapter interfaces and SQLite persistent adapter skeleton.
3. Add repository skeleton for settings/users/sessions/hosts/credentials.
4. Add field encryption boundary tests. (Started)
5. Migrate settings as the first low-risk vertical slice. (Started)
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
