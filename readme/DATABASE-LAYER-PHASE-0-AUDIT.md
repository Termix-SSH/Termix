# Database Layer Refactor Phase 0 Audit

Status: Draft  
Branch: `feature/database-layer-refactor`  
Purpose: Establish the current database access inventory, domain map, sensitive field map, and first implementation boundaries before changing runtime persistence.

## 1. Scope

Phase 0 does not change runtime behavior.

It produces the evidence needed for the next implementation phases:

- where database access currently happens
- which modules write directly to the database
- which tables belong to which product domains
- which fields are sensitive
- which direct writes are risky under the current in-memory snapshot model
- which domains should move first into repositories

## 2. Current Evidence

Commands used for the initial audit:

```bash
rg -n "getDb\\(|getSqlite\\(|DatabaseSaveTrigger|SimpleDBOps|db\\.\\$client|\\.prepare\\(" src/backend
rg -n "getDb\\(\\)\\.(insert|update|delete)|await db\\.(insert|update|delete)|db\\.(insert|update|delete)|\\.\\$client\\.prepare\\(\\\"(INSERT|UPDATE|DELETE)|\\.prepare\\(\\\"(INSERT|UPDATE|DELETE)|DatabaseSaveTrigger\\.triggerSave|DatabaseSaveTrigger\\.forceSave" src/backend
rg -n "export const .* = sqliteTable\\(" src/backend/database/db/schema.ts
```

High-level findings:

- Database infrastructure is concentrated in `src/backend/database/db/index.ts`.
- Business database access is spread across route modules, SSH modules, utilities, and auth helpers.
- `SimpleDBOps` is not the only write path.
- There are many direct Drizzle writes and raw SQLite writes.
- Some direct writes manually trigger `DatabaseSaveTrigger`; many write paths do not.
- Schema is SQLite-specific through `sqliteTable` and manual `CREATE TABLE IF NOT EXISTS` / `addColumnIfNotExists`.

## 3. Database Access Hotspots

The most database-heavy files by audit hits:

| File                                                  | Approx. hits | Notes                                                           |
| ----------------------------------------------------- | -----------: | --------------------------------------------------------------- |
| `src/backend/database/db/index.ts`                    |           75 | database init, schema creation, ad-hoc migration, snapshot save |
| `src/backend/database/routes/alert-rules-routes.ts`   |           64 | alert rules, channels, firings, raw SQL deletes                 |
| `src/backend/database/routes/users.ts`                |           54 | users, settings, OIDC/GitHub settings, admin flows              |
| `src/backend/database/database.ts`                    |           27 | import/export, legacy SQLite handling                           |
| `src/backend/ssh/host-metrics.ts`                     |           26 | metrics connection and settings reads                           |
| `src/backend/database/routes/user-settings-routes.ts` |           16 | user settings                                                   |
| `src/backend/dashboard.ts`                            |           15 | dashboard aggregation reads                                     |
| `src/backend/ssh/docker.ts`                           |           14 | host/credential reads for Docker SSH                            |
| `src/backend/ssh/managers/health.ts`                  |           13 | host health checks                                              |
| `src/backend/ssh/alert-engine.ts`                     |           13 | alert evaluation and firing state                               |
| `src/backend/utils/user-crypto.ts`                    |           12 | settings writes for crypto metadata                             |
| `src/backend/ssh/host-metrics-settings-routes.ts`     |           12 | metrics settings                                                |
| `src/backend/ssh/tmux-monitor.ts`                     |           11 | tmux session tags                                               |
| `src/backend/guacamole/routes.ts`                     |           11 | Guacamole config/routes                                         |
| `src/backend/database/routes/host.ts`                 |           10 | host operations and related rows                                |

This confirms the refactor must be domain-by-domain. A mechanical replacement of `getDb()` would be noisy and unsafe.

## 4. Direct Write Risk Inventory

Under the current architecture, a direct write is risky when it bypasses `SimpleDBOps` and does not trigger `DatabaseSaveTrigger`.

### 4.1 Direct Writes That Need Repository Ownership

These areas perform direct writes and should move behind repositories/services:

| Area                  | Representative files                                               | Examples                                                        |
| --------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------- |
| users/settings/auth   | `routes/users.ts`, `utils/auth-manager.ts`, `utils/user-crypto.ts` | sessions, trusted devices, OIDC settings, registration settings |
| RBAC/sharing          | `routes/rbac.ts`, `utils/shared-credential-manager.ts`             | roles, host access, snippet access, shared credentials          |
| hosts/credentials     | `routes/host.ts`, `routes/credentials.ts`, `host-resolver.ts`      | host access cleanup, credential usage                           |
| file manager metadata | `host-file-manager-bookmark-routes.ts`                             | recent, pinned, shortcuts                                       |
| alerts                | `alert-rules-routes.ts`, `ssh/alert-engine.ts`                     | channels, rules, firings                                        |
| metrics               | `host-metrics-preferences-routes.ts`, `managers/health.ts`         | preferences, health checks, history                             |
| terminal logs         | `terminal-session-manager.ts`                                      | session recording metadata                                      |
| tmux                  | `tmux-monitor.ts`                                                  | tmux session tags                                               |
| import/export         | `database/database.ts`                                             | SQLite import and forced save                                   |
| open tabs             | `routes/open-tabs.ts`                                              | tab persistence and cleanup                                     |
| API keys              | `user-api-key-routes.ts`, `utils/auth-manager.ts`                  | API key create/delete/last-used                                 |
| SSO and identity      | `sso-provider-routes.ts`, `termix-id.ts`                           | providers, identity keys/CA                                     |

### 4.2 Immediate Compatibility Rule

Until a domain is migrated to repositories:

- Every direct write must either be moved into a repository or explicitly trigger persistence in the old runtime.
- New code should not add direct `getDb()` writes outside infrastructure or repositories.
- The draft branch should add an enforcement check before Phase 8, not immediately, because the current codebase still violates the target rule widely.

## 5. Table Domain Map

### 5.1 Identity and Authentication

| Tables                 | Notes                                        |
| ---------------------- | -------------------------------------------- |
| `users`                | local/OIDC users, TOTP fields, password hash |
| `sessions`             | JWT sessions                                 |
| `trusted_devices`      | remembered devices                           |
| `api_keys`             | API token hashes/prefixes                    |
| `sso_providers`        | configured SSO providers                     |
| `termix_identities`    | Termix identity records                      |
| `termix_identity_keys` | public/private identity key metadata         |
| `termix_identity_ca`   | CA material, private key is sensitive        |

Suggested repository:

- `userRepository`
- `sessionRepository`
- `trustedDeviceRepository`
- `apiKeyRepository`
- `ssoProviderRepository`
- `termixIdentityRepository`

### 5.2 Hosts and Credentials

| Tables                 | Notes                                            |
| ---------------------- | ------------------------------------------------ |
| `ssh_data`             | primary host table, many config JSON/text fields |
| `ssh_credentials`      | reusable credentials                             |
| `ssh_credential_usage` | usage history                                    |
| `ssh_folders`          | folder metadata                                  |
| `host_access`          | sharing/RBAC access rows                         |
| `shared_credentials`   | encrypted shared credential material             |
| `network_topology`     | topology graph/config                            |

Suggested repository:

- `hostRepository`
- `credentialRepository`
- `credentialUsageRepository`
- `hostAccessRepository`
- `sharedCredentialRepository`
- `hostFolderRepository`
- `networkTopologyRepository`

### 5.3 RBAC

| Tables           | Notes                    |
| ---------------- | ------------------------ |
| `roles`          | role definitions         |
| `user_roles`     | user to role assignments |
| `host_access`    | host-level grants        |
| `snippet_access` | snippet-level grants     |

Suggested repository:

- `roleRepository`
- `accessRepository`

### 5.4 File Manager

| Tables                   | Notes                              |
| ------------------------ | ---------------------------------- |
| `file_manager_recent`    | recently opened paths              |
| `file_manager_pinned`    | pinned paths                       |
| `file_manager_shortcuts` | saved shortcuts                    |
| `transfer_recent`        | host-to-host transfer destinations |

Suggested repository:

- `fileManagerRepository`
- `transferRecentRepository`

### 5.5 Snippets

| Tables            | Notes                   |
| ----------------- | ----------------------- |
| `snippets`        | command snippets        |
| `snippet_folders` | snippet folder metadata |
| `snippet_access`  | snippet sharing         |

Suggested repository:

- `snippetRepository`

### 5.6 Runtime Metadata and Audit

| Tables               | Notes                                                  |
| -------------------- | ------------------------------------------------------ |
| `audit_logs`         | append-only audit trail                                |
| `session_recordings` | terminal recording metadata, log content is file-based |
| `recent_activity`    | host activity feed                                     |
| `command_history`    | terminal command history                               |
| `user_open_tabs`     | UI restore state; currently cleared on startup         |
| `user_preferences`   | per-user UI/preferences                                |
| `settings`           | global settings                                        |

Suggested repository:

- `auditRepository`
- `sessionRecordingRepository`
- `activityRepository`
- `commandHistoryRepository`
- `openTabsRepository`
- `userPreferencesRepository`
- `settingsRepository`

### 5.7 Metrics and Alerts

| Tables                     | Notes                      |
| -------------------------- | -------------------------- |
| `host_metrics_preferences` | metrics layout/preferences |
| `host_health_checks`       | health check definitions   |
| `host_health_history`      | health check results       |
| `host_metrics_history`     | metrics history            |
| `alert_rules`              | alert definitions          |
| `notification_channels`    | webhook/ntfy/etc config    |
| `alert_rule_channels`      | rule/channel joins         |
| `alert_firings`            | firing/ack state           |
| `dismissed_alerts`         | dismissed system alerts    |

Suggested repository:

- `metricsRepository`
- `healthCheckRepository`
- `alertRepository`
- `notificationRepository`

### 5.8 Integrations and Feature Config

| Tables                    | Notes                                   |
| ------------------------- | --------------------------------------- |
| `c2s_tunnel_presets`      | tunnel preset config                    |
| `opkssh_tokens`           | OPKSSH cert/private key cache           |
| `vault_profiles`          | Vault profile config, mostly non-secret |
| `vault_tokens`            | Vault cert/private key cache            |
| `dashboard_service_links` | dashboard links                         |
| `homepage_items`          | homepage widgets/items                  |
| `homepage_layouts`        | homepage layouts                        |
| `tmux_session_tags`       | tmux tag metadata                       |

Suggested repository:

- `tunnelPresetRepository`
- `opksshTokenRepository`
- `vaultRepository`
- `dashboardRepository`
- `homepageRepository`
- `tmuxRepository`

## 6. Sensitive Field Map

The current explicit `FieldCrypto` map encrypts:

| Table                | Fields                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`              | `passwordHash`, `clientSecret`, `totpSecret`, `totpBackupCodes`, `oidcIdentifier`                                                                                               |
| `ssh_data`           | `password`, `key`, `keyPassword`, `sudoPassword`, `autostartPassword`, `autostartKey`, `autostartKeyPassword`, `socks5Password`, `rdpPassword`, `vncPassword`, `telnetPassword` |
| `ssh_credentials`    | `password`, `privateKey`, `keyPassword`, `key`, `publicKey`                                                                                                                     |
| `opkssh_tokens`      | `sshCert`, `privateKey`                                                                                                                                                         |
| `termix_identity_ca` | `privateKey`                                                                                                                                                                    |
| `vault_tokens`       | `sshCert`, `privateKey`                                                                                                                                                         |

Additional sensitive fields by table semantics:

| Table                   | Fields / reason                                                                                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ssh_credentials`       | `systemPassword`, `systemKey`, `systemKeyPassword` are system-key encrypted credential copies                                                                  |
| `shared_credentials`    | `encryptedUsername`, `encryptedAuthType`, `encryptedPassword`, `encryptedKey`, `encryptedKeyPassword`, `encryptedKeyType` are already encrypted payload fields |
| `api_keys`              | `tokenHash` is not plaintext but is authentication material; `tokenPrefix` may remain plaintext for display                                                    |
| `settings`              | some keys may hold provider secrets or reset codes; repository must classify by key                                                                            |
| `notification_channels` | config may include webhook URLs/tokens; treat config as sensitive unless split                                                                                 |
| `alert_rules`           | rule definitions are usually not secret but can include host/resource metadata                                                                                 |
| `homepage_items`        | widget config can include URLs/API config; classify per widget type                                                                                            |
| `c2s_tunnel_presets`    | config can include connection details; review before plaintext external DB storage                                                                             |
| `termix_identity_keys`  | inspect key material fields before migration; public keys are not secret but private material must never be plaintext                                          |
| `vault_profiles`        | current comments say profile fields are non-secret; keep that invariant explicit                                                                               |

Open privacy decision:

- `ssh_data.ip`, domain fields, usernames, folders, and tags are queryable today.
- Encrypting them improves confidentiality but breaks search/filter/sort unless blind indexes are added.
- Recommended initial migration: keep them plaintext and document privacy implications; add optional privacy mode later.

## 7. Repository Migration Order

Use a vertical slice instead of broad replacement.

### 7.1 First Slice

1. `settingsRepository`
2. `userRepository`
3. `sessionRepository`
4. `hostRepository`
5. `credentialRepository`

Reasons:

- Covers the app's boot/login/core host management path.
- Exercises field encryption.
- Exercises per-user data unlock requirements.
- Exercises transaction and migration behavior.
- Builds reusable patterns for the rest of the backend.

### 7.2 Second Slice

1. `hostAccessRepository`
2. `roleRepository`
3. `sharedCredentialRepository`
4. `auditRepository`
5. `userPreferencesRepository`

Reasons:

- Completes permission and sharing boundaries.
- Removes high-risk direct writes in admin/RBAC flows.
- Moves audit to an append-only repository.

### 7.3 Third Slice

1. `snippetRepository`
2. `fileManagerRepository`
3. `metricsRepository`
4. `alertRepository`
5. `homepageRepository`

Reasons:

- These are broad feature domains with many routes.
- They should reuse patterns from the core slices.

### 7.4 Fourth Slice

1. `vaultRepository`
2. `opksshTokenRepository`
3. `termixIdentityRepository`
4. `tunnelPresetRepository`
5. `tmuxRepository`

Reasons:

- Sensitive token/key cache domains need careful encryption tests.
- Some data is transient and should have retention cleanup.

## 8. Adapter Design Notes

The adapter boundary should expose:

```ts
interface DatabaseAdapter {
  dialect: "sqlite" | "postgres" | "mysql";
  connect(): Promise<void>;
  close(): Promise<void>;
  migrate(): Promise<void>;
  transaction<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T>;
}
```

The repository layer should not depend on `better-sqlite3`.

For Drizzle, likely options:

- keep dialect-specific Drizzle clients internally
- expose repositories instead of exposing the raw Drizzle client
- keep schema definitions close to migrations, not route handlers

Important: do not make route modules import dialect-specific schema objects after migration.

## 9. Compatibility Shims

During the migration, avoid a flag day.

Add a compatibility database module that lets old code continue to run while new repositories are introduced:

```text
legacy getDb() path
new adapter/repository path
```

Rules:

- New modules use repositories only.
- Migrated modules must not fall back to `getDb()`.
- Legacy path is removed only after all domains move.

## 10. Phase 1 Entry Criteria

Before implementing the adapter skeleton:

- This audit document exists.
- The sensitive field map is reviewed.
- The first vertical slice is accepted.
- The draft PR remains draft.
- No runtime behavior has changed.

## 11. Phase 1 Deliverables

Recommended first implementation PR on this branch:

- `src/backend/database/runtime/config.ts`
- `src/backend/database/runtime/adapter.ts`
- `src/backend/database/runtime/sqlite-adapter.ts`
- `src/backend/database/repositories/settings-repository.ts`
- `src/backend/database/repositories/user-repository.ts`
- `src/backend/database/repositories/session-repository.ts`
- `src/backend/database/repositories/host-repository.ts`
- `src/backend/database/repositories/credential-repository.ts`
- `src/backend/database/repositories/field-encryption-boundary.ts`
- `src/backend/database/repositories/current-settings-repository.ts`
- tests for config parsing and SQLite adapter boot

Started:

- runtime config parser
- SQLite adapter skeleton
- migration metadata table bootstrap
- `SettingsRepository` skeleton and tests
- `UserRepository` and `SessionRepository` skeletons and tests
- `HostRepository` and `CredentialRepository` skeletons and tests
- `FieldEncryptionBoundary` skeleton and tests
- first settings route slice wired through `SettingsRepository`
- user settings route direct `settings` table access moved behind
  `SettingsRepository`
- host metrics settings route direct `settings` table access moved behind
  `SettingsRepository`
- ACME SSL settings route direct `settings` table access moved behind
  `SettingsRepository`
- terminal route direct `settings` table access moved behind
  `SettingsRepository`
- tailscale route direct `settings` table access moved behind
  `SettingsRepository`
- Guacamole route and WebSocket server direct `settings` table access moved
  behind the current settings repository boundary
- auth token expiry and terminal session timeout settings reads moved behind the
  current settings repository boundary
- open tabs, TOTP, and LDAP auth route settings reads moved behind the current
  settings repository boundary
- host metrics polling settings reads moved behind the current settings
  repository boundary
- backend startup settings reads moved behind the current settings repository
  boundary
- user deletion cleanup now removes per-user settings through
  `SettingsRepository.deleteLike`
- password reset route reset code and temporary token settings access moved
  behind `SettingsRepository`
- OIDC utility legacy config fallback reads `oidc_config` through
  `SettingsRepository`
- user route registration/password flags and OIDC config administration moved
  behind the current settings repository boundary
- OIDC authorize/callback temporary state and auto-provision reads moved behind
  the current settings repository boundary
- user login settings reads moved behind the current settings repository
  boundary, completing direct `settings` access cleanup in `routes/users.ts`
- user encryption metadata in `utils/user-crypto.ts` moved behind the current
  settings repository boundary
- database startup and schema migration defaults in `database/db/index.ts`
  moved to local raw settings helpers
- database import/export settings handling in `database/database.ts` moved to
  local helper boundaries
- core `auth-manager.ts` session create/read/update/revoke/list paths started
  using the current session repository boundary
- remaining `auth-manager.ts` session cleanup/middleware/logout paths and
  `user-session-routes.ts` single-session lookup moved behind the current
  session repository boundary
- current user repository factory/write-save hook added, and
  `user-admin-routes.ts` list/admin promotion/admin removal/admin-create user
  paths moved behind the current user repository boundary
- low-risk `routes/users.ts` current-user lookup and admin gate checks moved
  behind the current user repository boundary
- user registration, self-delete, password change hash updates, and admin
  delete-user lookup paths in `routes/users.ts` moved behind the current user
  repository boundary, with first-user admin creation kept transactional inside
  `UserRepository`
- traditional login username lookup and `auth-manager.ts` admin user checks
  moved behind the current user repository boundary
- GitHub and standard OIDC callback user lookup/create/rollback/profile/admin
  sync writes moved behind the current user repository boundary, removing direct
  Drizzle `users` table access from `routes/users.ts`, `user-admin-routes.ts`,
  and `auth-manager.ts`

Keep it small. Do not wire host or credential routes into the new repositories in
the same first implementation commit.

## 12. Current Unknowns

- Exact Drizzle multi-dialect strategy needs a spike.
- The project may need a migration generator or a custom migration runner.
- Some raw SQL in `routes/users.ts`, `alert-rules-routes.ts`, and `db/index.ts` must be rewritten or isolated.
- `settings` contains mixed public and sensitive values; key-level classification is required.
- `homepage_items.config`, `notification_channels.config`, and tunnel configs may contain embedded secrets.
- Legacy encrypted snapshot fixtures need to be created before migration implementation.

## 13. Decision Log

- Default upgrade target should be persistent SQLite, not PostgreSQL/MySQL.
- PostgreSQL/MySQL migration should be explicit and initially manual/experimental.
- Runtime SSH/WebSocket/tunnel state remains memory-only.
- Field-level encryption is mandatory for every database backend.
- Field-level encryption must use a stable record id; temporary encryption
  contexts are forbidden for newly written repository data.
- Repository migration should start with settings/users/sessions/hosts/credentials.
