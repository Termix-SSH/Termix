# Database Layer Gray Rollout Guide

Status: Draft branch gray-rollout guide  
Branch: `feature/database-layer-refactor`  
Scope: repository-boundary migration for current SQLite snapshot runtime

This branch is not the full multi-database refactor. Gray rollout is only for
the already-migrated repository boundary paths while the production runtime still
uses the existing encrypted SQLite snapshot model.

## 1. Gray Scope

Allowed in gray rollout:

- Existing encrypted SQLite snapshot runtime.
- Existing database file format.
- Existing schema and migration flow.
- Settings, user, host, API key, session, trusted device, audit log, user
  preference, open tab, dismissed alert, homepage layout/item, and network
  topology, dashboard service link, session recording, command history, recent
  activity, transfer recent, and file-manager bookmark current repository
  plus C2S tunnel preset, tmux session tag, OPKSSH token, Vault token/profile,
  SSH credential usage, role, SSO provider, host folder, alert, host health,
  host metrics preference/history, credential, host resolution, snippet,
  RBAC access, shared credential, Termix ID identity/CA, and user data export
  current repository factories share `current-repository-runtime` for SQLite
  context and write-save hooks.
- Settings reads and writes migrated behind `SettingsRepository`.
- Database import/export settings reads and admin upserts migrated behind
  `SettingsRepository`.
- Session create/read/update/revoke/list paths migrated behind
  `SessionRepository`.
- User create/read/update/delete/auth paths migrated behind `UserRepository`.
- User setup/count/db-health, password-login TOTP guard, and last-admin delete
  guard reads migrated behind `UserRepository`.
- Database import/export user unlock/admin checks migrated behind
  `UserRepository`.
- LDAP first-user provisioning and admin-group user creation migrated behind
  `UserRepository`.
- API key create/list/delete and authentication last-used updates migrated behind
  `ApiKeyRepository`.
- Trusted device check/add/remove and TOTP trusted-device cleanup migrated
  behind `TrustedDeviceRepository`.
- Credential list, folder list, detail reads, update lookup/readback, host route
  credential resolution reads, folder rename writes, apply usage writes, shared
  credential source row reads, credential delete lookup/delete, and
  credential-host list reads migrated behind `CredentialRepository` and
  `HostResolutionRepository`.
- Database export host and credential read/decryption paths migrated behind
  `HostRepository` and `CredentialRepository`.
- Database import host and credential duplicate checks plus encrypted creates
  migrated behind `HostRepository` and `CredentialRepository`.
- Credential create/update encrypted writes migrated behind
  `CredentialRepository`, including system-key copies for shared credentials.
- Credential delete host cleanup and apply-to-host writes migrated behind
  `HostRepository`.
- Credential system-key copy backfill migration migrated behind
  `CredentialRepository` and `SharedCredentialRepository`.
- Legacy user field-encryption migration SQL centralized behind
  `RawSqliteUserEncryptionMigrationStore`.
- Auth login lazy user-field encryption migration now calls the `DataCrypto`
  current-runtime migration boundary instead of opening SQLite in
  `auth-manager.ts`.
- Current user-field encryption migration now resolves SQLite through
  `createCurrentUserEncryptionMigrationStore` and the shared current runtime
  helper, keeping `DataCrypto` on the migration-store interface.
- User, admin, TOTP, OIDC account, and credential migration explicit saves now
  use `DatabaseSaveTrigger` instead of importing the SQLite snapshot save
  function from routes.
- Current SQLite snapshot save trigger now initializes after database startup
  regardless of file-encryption mode, and backend shutdown uses that save
  boundary.
- Direct SQLite snapshot save-function imports are now isolated inside
  `database/db/index.ts`; current user-field migration saves through
  `DatabaseSaveTrigger`.
- Database import SQLite foreign-key toggling is isolated behind the
  `withSqliteForeignKeysDisabled` runtime boundary and restores constraints in
  a `finally` path; the current variant resolves SQLite through the shared
  current runtime helper.
- Database import now uses the current SQLite foreign-key boundary without
  importing `getDb()` in the route handler.
- Legacy unencrypted SQLite copy/verification path centralized behind
  `LegacySqliteDatabaseCopyStore`.
- Termix ID credential lookup, generated credential persistence, and generated
  credential cleanup migrated behind `CredentialRepository`.
- Host route update readback, single-host fetch, password-field fetch, and host
  export reads migrated behind `HostResolutionRepository`.
- Host route create/update encrypted writes migrated behind `HostRepository`.
- Host route update-state and delete-audit host reads migrated behind
  `HostResolutionRepository`.
- Host route delete final host-row writes and audit actor username lookups
  migrated behind `HostRepository` and `UserRepository`.
- Host route own/shared list assembly reads migrated behind
  `HostResolutionRepository` while preserving route-level own-host decryption.
- Host bulk-update state reads and non-sensitive bulk flag/config writes
  migrated behind `HostRepository`.
- Host bulk import overwrite lookup and credential fallback reads migrated behind
  current host resolution and credential repository boundaries.
- Host bulk JSON and SSH-config import encrypted create/update writes migrated
  behind `HostRepository`.
- Host autostart enable, disable, status, and endpoint-host resolution paths
  migrated behind `HostRepository`.
- Guacamole host token host and protocol credential reads migrated behind
  `HostResolutionRepository`.
- Host user-cleanup delete paths migrated behind `HostRepository`.
- Snippet folder list/create/metadata/rename/delete, owned lookup, visible-list
  owned reads, reorder, create/update/delete, export reads, and bulk import
  plus user/password-reset cleanup migrated behind `SnippetRepository`.
- Host folder metadata user cleanup migrated behind `HostFolderRepository`.
- SSO provider listing, management, OIDC config loading, and LDAP provider
  validation migrated behind `SsoProviderRepository`.
- Audit log writes, filtered reads, action lists, and user cleanup migrated
  behind `AuditLogRepository`.
- User preferences read/write and user cleanup migrated behind
  `UserPreferenceRepository`.
- Open tab restore/upsert/sync/update/delete and user cleanup migrated behind
  `OpenTabRepository`.
- Dismissed alert read/dismiss/undismiss/export and user cleanup migrated behind
  `DismissedAlertRepository`.
- Database import/export dismissed alert reads and writes migrated behind
  `DismissedAlertRepository`.
- Homepage layout read/write paths migrated behind
  `HomepageLayoutRepository`.
- Homepage item list/create/update/delete migrated behind
  `HomepageItemRepository`.
- Network topology read/write and user cleanup migrated behind
  `NetworkTopologyRepository`.
- Dashboard service link list/create/update/delete migrated behind
  `DashboardServiceLinkRepository`.
- Session recording create/list/read/content/delete/prune and host/folder/user
  cleanup migrated behind `SessionRecordingRepository`.
- Command history save/list/delete and host/user cleanup migrated behind
  `CommandHistoryRepository`.
- Dashboard recent activity list/log/trim/reset and host/user cleanup migrated
  behind `RecentActivityRepository`.
- SSH credential usage writes and host/user cleanup migrated behind
  `SshCredentialUsageRepository`.
- Database export SSH credential usage reads migrated behind
  `SshCredentialUsageRepository`.
- Transfer recent list/upsert/prune/export and host/folder/user cleanup migrated
  behind `TransferRecentRepository`.
- File manager recent/pinned/shortcut list/create/delete/export and
  host/folder/user/password-reset cleanup migrated behind
  `FileManagerBookmarkRepository`.
- Database import/export file-manager recent/pinned/shortcut target reads and
  writes migrated behind `FileManagerBookmarkRepository`.
- C2S tunnel preset list/create/update/delete migrated behind
  `C2sTunnelPresetRepository`.
- Tmux session tag list/rename/delete/replace migrated behind
  `TmuxSessionTagRepository`.
- OPKSSH token upsert/read/touch/delete and user cleanup migrated behind
  `OpksshTokenRepository`.
- Vault token upsert/read/touch/delete migrated behind `VaultTokenRepository`.
- Vault profile list/create/update/delete and profile lookup migrated behind
  `VaultProfileRepository`.
- Host metrics layout preference read/upsert and statsConfig widget sync migrated behind
  `HostMetricsPreferenceRepository`.
- Host health check config and history read/write migrated behind
  `HostHealthRepository`.
- Host metrics history record/prune/query migrated behind
  `HostMetricsHistoryRepository`.
- Alert notification channels, rules, linked channels, firings, and alert
  engine persistence reads/writes migrated behind `AlertRepository`.
- User data export host and credential read models migrated behind
  `UserDataExportRepository`.
- SSH folder list, metadata upsert, rename, and folder host deletion writes
  migrated behind `HostFolderRepository`.
- Host, jump-host, Docker SSH, Proxmox discovery, Docker console jump-host,
  file-manager activity, host metrics, terminal SSH auth, and tunnel endpoint
  credential plus credential deployment and command history host-flag resolution
  plus snippet execution, terminal OPKSSH/activity, Vault OIDC profile, and
  Wake-on-LAN host, internal host list, host-key verification metadata,
  credential, permission-manager owner checks, and shared override read/write
  models migrated behind `HostResolutionRepository`.
- Host metrics, host metrics viewer, tmux monitor, Docker, tunnel, and Proxmox
  unlock gates now use `DataCrypto` directly instead of `SimpleDBOps`.
- Legacy `SimpleDBOps` compatibility helper removed after migrated route and
  utility paths stopped importing it.
- RBAC role management and user-role assignment/listing paths migrated behind
  `RoleRepository`.
- Permission manager role permission aggregation and admin-role checks migrated
  behind `RoleRepository`.
- User deletion role-assignment cleanup migrated behind `RoleRepository`.
- User deletion API key, trusted device, C2S preset, Vault token/profile, audit,
  encrypted-data, UI state, and related per-user cleanup now uses current
  repository boundaries before the final user row delete.
- User admin route role sync and admin-created default role assignment migrated
  behind `RoleRepository`.
- LDAP login default role assignment and admin-role sync migrated behind
  `RoleRepository`.
- Local, GitHub OIDC, and standard OIDC user default role assignment plus OIDC
  admin-group role sync migrated behind `RoleRepository`.
- RBAC host/snippet access-list read models migrated behind
  `RbacAccessRepository`.
- RBAC shared host/shared snippet read models migrated behind
  `RbacAccessRepository`.
- RBAC route host/snippet owner checks and direct host-access credential
  existence reads migrated behind current host, snippet, and credential
  repository boundaries.
- RBAC host/snippet access grant, revoke, and direct host-access credential
  override writes migrated behind `RbacAccessRepository`.
- Shared credential material create/update/delete, pending re-encryption, and
  user cleanup persistence migrated behind `SharedCredentialRepository`.
- Permission manager host-access cleanup, shared-access lookup, and last-access
  touch migrated behind `RbacAccessRepository`.
- Termix ID identity handle CRUD/resolution, public key publish/list/update/delete,
  linked credential lookup, and certificate target key lookup migrated behind
  `TermixIdentityRepository`.
- Termix ID CA public lookup, encrypted private-key create/rotate/delete, and
  certificate signing reads migrated behind `TermixIdentityCaRepository`.
- Current field encryption behavior.

Not included in gray rollout:

- PostgreSQL or MySQL/MariaDB runtime.
- New external database configuration UI.
- New schema migration strategy.
- Host and credential route migration beyond existing repository skeletons.
- Remaining audit, preferences, file manager, and metrics repository migration.
- Multi-instance backend deployment.

## 2. Required Preflight

Before enabling this branch for any gray target:

1. Confirm the target is running from a full backup of the data directory.
2. Copy the current encrypted database snapshot before first startup.
3. Record the exact source commit and container/image tag currently serving
   traffic.
4. Confirm the gray build commit is known.
5. Run the validation commands from this branch.
6. Use a target with a small, known user set first.
7. Keep an operator available for rollback during the first login/API-key smoke
   tests.

Repository rollout is controlled by `DATABASE_LAYER_REPOSITORY_ROLLOUT`.

Recommended gray value:

```bash
DATABASE_LAYER_REPOSITORY_ROLLOUT=settings,users,sessions,api_keys,trusted_devices,credentials,termix_identity,termix_identity_ca,hosts,snippets,sso_providers,audit_logs,user_preferences,open_tabs,dismissed_alerts,homepage_layouts,homepage_items,network_topology,dashboard_service_links,session_recordings,command_history,recent_activity,ssh_credential_usage,transfer_recent,file_manager_bookmarks,c2s_tunnel_presets,tmux_session_tags,opkssh_tokens,vault_tokens,vault_profiles,host_metrics_preferences,host_health,host_metrics_history,alerts,user_data_exports,host_folders,host_resolution,roles,rbac_access,shared_credentials
```

Accepted values:

| Value                                       | Behavior                                      |
| ------------------------------------------- | --------------------------------------------- |
| unset                                       | current migrated slice enabled; logs implicit |
| `all`, `true`, `1`, `on`, `enabled`         | all current migrated repository domains       |
| `off`, `false`, `0`, `none`, `disabled`     | no migrated repository domains; fail closed   |
| comma list, for example `settings,users`    | only listed repository domains enabled        |
| aliases such as `user`, `api-key`, `apikey` | normalized to the supported domain names      |

Supported domains:

- `settings`
- `users`
- `sessions`
- `api_keys`
- `trusted_devices`
- `credentials`
- `termix_identity`
- `termix_identity_ca`
- `hosts`
- `snippets`
- `sso_providers`
- `audit_logs`
- `user_preferences`
- `open_tabs`
- `dismissed_alerts`
- `homepage_layouts`
- `homepage_items`
- `network_topology`
- `dashboard_service_links`
- `session_recordings`
- `command_history`
- `recent_activity`
- `ssh_credential_usage`
- `transfer_recent`
- `file_manager_bookmarks`
- `c2s_tunnel_presets`
- `tmux_session_tags`
- `opkssh_tokens`
- `vault_tokens`
- `vault_profiles`
- `host_metrics_preferences`
- `host_health`
- `host_metrics_history`
- `alerts`
- `user_data_exports`
- `host_folders`
- `host_resolution`
- `roles`
- `rbac_access`
- `shared_credentials`

The backend logs the parsed rollout mode at startup with operation
`repository_rollout_config`. Use an explicit value in any staging or production
gray target so logs show the intended rollout state.

Admin users can also verify the active rollout state through
`GET /database/migration/status`. The response includes `repositoryRollout`
with the parsed mode, enabled domains, supported domains, env key, and whether
the value was explicitly configured. Startup logs and this endpoint also expose
rollout warnings for implicit, disabled, or partial configurations.

Minimum backup artifacts:

- encrypted SQLite snapshot file
- environment configuration
- application version or image tag
- logs from the last healthy startup on the previous version

## 3. Required Validation Commands

Run before deployment:

```bash
npm run type-check
npx eslint src/backend/database/repositories/repository-rollout.ts src/backend/database/repositories/repository-rollout.test.ts src/backend/database/repositories/current-settings-repository.ts src/backend/database/repositories/current-user-repository.ts src/backend/database/repositories/current-session-repository.ts src/backend/database/repositories/current-api-key-repository.ts src/backend/database/repositories/current-trusted-device-repository.ts src/backend/database/repositories/current-credential-repository.ts src/backend/database/repositories/credential-repository.ts src/backend/database/repositories/current-host-repository.ts src/backend/database/repositories/host-repository.ts src/backend/database/repositories/host-credential-repositories.test.ts src/backend/database/repositories/current-sso-provider-repository.ts src/backend/database/repositories/sso-provider-repository.ts src/backend/database/repositories/sso-provider-repository.test.ts src/backend/database/repositories/current-audit-log-repository.ts src/backend/database/repositories/audit-log-repository.ts src/backend/database/repositories/audit-log-repository.test.ts src/backend/database/repositories/current-user-preference-repository.ts src/backend/database/repositories/user-preference-repository.ts src/backend/database/repositories/user-preference-repository.test.ts src/backend/database/repositories/current-open-tab-repository.ts src/backend/database/repositories/open-tab-repository.ts src/backend/database/repositories/open-tab-repository.test.ts src/backend/database/repositories/current-dismissed-alert-repository.ts src/backend/database/repositories/dismissed-alert-repository.ts src/backend/database/repositories/dismissed-alert-repository.test.ts src/backend/database/repositories/current-homepage-layout-repository.ts src/backend/database/repositories/homepage-layout-repository.ts src/backend/database/repositories/homepage-layout-repository.test.ts src/backend/database/repositories/current-homepage-item-repository.ts src/backend/database/repositories/homepage-item-repository.ts src/backend/database/repositories/homepage-item-repository.test.ts src/backend/database/repositories/current-network-topology-repository.ts src/backend/database/repositories/network-topology-repository.ts src/backend/database/repositories/network-topology-repository.test.ts src/backend/database/repositories/current-dashboard-service-link-repository.ts src/backend/database/repositories/dashboard-service-link-repository.ts src/backend/database/repositories/dashboard-service-link-repository.test.ts src/backend/database/repositories/current-session-recording-repository.ts src/backend/database/repositories/session-recording-repository.ts src/backend/database/repositories/session-recording-repository.test.ts src/backend/database/repositories/current-command-history-repository.ts src/backend/database/repositories/command-history-repository.ts src/backend/database/repositories/command-history-repository.test.ts src/backend/database/repositories/current-recent-activity-repository.ts src/backend/database/repositories/recent-activity-repository.ts src/backend/database/repositories/recent-activity-repository.test.ts src/backend/database/repositories/current-ssh-credential-usage-repository.ts src/backend/database/repositories/ssh-credential-usage-repository.ts src/backend/database/repositories/ssh-credential-usage-repository.test.ts src/backend/database/repositories/current-transfer-recent-repository.ts src/backend/database/repositories/transfer-recent-repository.ts src/backend/database/repositories/transfer-recent-repository.test.ts src/backend/database/repositories/current-file-manager-bookmark-repository.ts src/backend/database/repositories/file-manager-bookmark-repository.ts src/backend/database/repositories/file-manager-bookmark-repository.test.ts src/backend/database/repositories/current-c2s-tunnel-preset-repository.ts src/backend/database/repositories/c2s-tunnel-preset-repository.ts src/backend/database/repositories/c2s-tunnel-preset-repository.test.ts src/backend/database/repositories/current-tmux-session-tag-repository.ts src/backend/database/repositories/tmux-session-tag-repository.ts src/backend/database/repositories/tmux-session-tag-repository.test.ts src/backend/database/repositories/current-opkssh-token-repository.ts src/backend/database/repositories/opkssh-token-repository.ts src/backend/database/repositories/opkssh-token-repository.test.ts src/backend/database/repositories/current-vault-token-repository.ts src/backend/database/repositories/vault-token-repository.ts src/backend/database/repositories/vault-token-repository.test.ts src/backend/database/repositories/current-vault-profile-repository.ts src/backend/database/repositories/vault-profile-repository.ts src/backend/database/repositories/vault-profile-repository.test.ts src/backend/database/repositories/current-host-metrics-preference-repository.ts src/backend/database/repositories/host-metrics-preference-repository.ts src/backend/database/repositories/host-metrics-preference-repository.test.ts src/backend/database/repositories/current-host-health-repository.ts src/backend/database/repositories/host-health-repository.ts src/backend/database/repositories/host-health-repository.test.ts src/backend/database/repositories/current-host-metrics-history-repository.ts src/backend/database/repositories/host-metrics-history-repository.ts src/backend/database/repositories/host-metrics-history-repository.test.ts src/backend/database/repositories/current-alert-repository.ts src/backend/database/repositories/alert-repository.ts src/backend/database/repositories/alert-repository.test.ts src/backend/database/repositories/current-user-data-export-repository.ts src/backend/database/repositories/user-data-export-repository.ts src/backend/database/repositories/user-data-export-repository.test.ts src/backend/database/repositories/current-host-folder-repository.ts src/backend/database/repositories/host-folder-repository.ts src/backend/database/repositories/host-folder-repository.test.ts src/backend/database/repositories/current-host-resolution-repository.ts src/backend/database/repositories/host-resolution-repository.ts src/backend/database/repositories/host-resolution-repository.test.ts src/backend/database/repositories/current-snippet-repository.ts src/backend/database/repositories/snippet-repository.ts src/backend/database/repositories/snippet-repository.test.ts src/backend/database/repositories/current-role-repository.ts src/backend/database/repositories/role-repository.ts src/backend/database/repositories/role-repository.test.ts src/backend/database/repositories/current-rbac-access-repository.ts src/backend/database/repositories/rbac-access-repository.ts src/backend/database/repositories/rbac-access-repository.test.ts src/backend/database/routes/rbac.ts src/backend/database/routes/snippets.ts src/backend/database/routes/host.ts src/backend/database/routes/credentials.ts src/backend/database/routes/delete-user-data.ts src/backend/database/routes/open-tabs.ts src/backend/database/routes/user-preferences.ts src/backend/database/routes/user-admin-routes.ts src/backend/database/routes/ldap-auth-routes.ts src/backend/database/routes/users.ts src/backend/database/routes/user-oidc-utils.ts src/backend/database/routes/sso-provider-routes.ts src/backend/database/routes/audit-log-routes.ts src/backend/database/routes/host-folder-routes.ts src/backend/database/routes/host-file-manager-bookmark-routes.ts src/backend/database/routes/c2s-tunnel-presets.ts src/backend/database/routes/alerts.ts src/backend/database/routes/alert-rules-routes.ts src/backend/database/routes/homepage-layout-routes.ts src/backend/database/routes/homepage-items-routes.ts src/backend/database/routes/network-topology.ts src/backend/database/routes/dashboard-service-links-routes.ts src/backend/database/routes/session-log-routes.ts src/backend/database/routes/host-command-history-routes.ts src/backend/database/routes/terminal.ts src/backend/database/routes/user-password-reset-routes.ts src/backend/ssh/terminal-session-manager.ts src/backend/ssh/tmux-monitor.ts src/backend/ssh/opkssh-auth.ts src/backend/ssh/vault-signer-auth.ts src/backend/ssh/vault-oidc-auth.ts src/backend/ssh/host-resolver.ts src/backend/ssh/host-metrics-preferences-routes.ts src/backend/ssh/managers/health.ts src/backend/ssh/host-metrics.ts src/backend/ssh/host-metrics-history-routes.ts src/backend/ssh/alert-engine.ts src/backend/utils/user-data-export.ts src/backend/utils/audit-logger.ts src/backend/utils/audit-logger.test.ts src/backend/utils/permission-manager.ts src/backend/utils/shared-credential-manager.ts src/backend/starter.ts
npm run test -- src/backend/database/runtime/config.test.ts src/backend/database/runtime/sqlite-adapter.test.ts src/backend/database/repositories/repository-rollout.test.ts src/backend/database/repositories/settings-repository.test.ts src/backend/database/repositories/user-session-repositories.test.ts src/backend/database/repositories/api-key-repository.test.ts src/backend/database/repositories/trusted-device-repository.test.ts src/backend/database/repositories/sso-provider-repository.test.ts src/backend/database/repositories/audit-log-repository.test.ts src/backend/database/repositories/user-preference-repository.test.ts src/backend/database/repositories/open-tab-repository.test.ts src/backend/database/repositories/dismissed-alert-repository.test.ts src/backend/database/repositories/homepage-layout-repository.test.ts src/backend/database/repositories/homepage-item-repository.test.ts src/backend/database/repositories/network-topology-repository.test.ts src/backend/database/repositories/dashboard-service-link-repository.test.ts src/backend/database/repositories/session-recording-repository.test.ts src/backend/database/repositories/command-history-repository.test.ts src/backend/database/repositories/recent-activity-repository.test.ts src/backend/database/repositories/ssh-credential-usage-repository.test.ts src/backend/database/repositories/transfer-recent-repository.test.ts src/backend/database/repositories/file-manager-bookmark-repository.test.ts src/backend/database/repositories/c2s-tunnel-preset-repository.test.ts src/backend/database/repositories/tmux-session-tag-repository.test.ts src/backend/database/repositories/opkssh-token-repository.test.ts src/backend/database/repositories/vault-token-repository.test.ts src/backend/database/repositories/vault-profile-repository.test.ts src/backend/database/repositories/host-metrics-preference-repository.test.ts src/backend/database/repositories/host-health-repository.test.ts src/backend/database/repositories/host-metrics-history-repository.test.ts src/backend/database/repositories/alert-repository.test.ts src/backend/database/repositories/user-data-export-repository.test.ts src/backend/database/repositories/host-folder-repository.test.ts src/backend/database/repositories/host-resolution-repository.test.ts src/backend/database/repositories/snippet-repository.test.ts src/backend/database/repositories/role-repository.test.ts src/backend/database/repositories/rbac-access-repository.test.ts src/backend/database/repositories/host-credential-repositories.test.ts src/backend/database/repositories/field-encryption-boundary.test.ts src/backend/utils/field-crypto.test.ts src/backend/utils/audit-logger.test.ts src/backend/guacamole/token-service.test.ts src/backend/database/routes/user-oidc-utils.test.ts src/backend/database/routes/termix-id.test.ts src/backend/database/routes/user-totp-routes.test.ts src/backend/utils/permission-manager.test.ts src/backend/ssh/credential-username.test.ts src/backend/ssh/tmux-monitor-helpers.test.ts
git diff --check
```

## 4. Smoke Test Matrix

Run these against the gray target:

| Area          | Required check                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| Startup       | App starts from existing encrypted snapshot without schema errors                                      |
| Login         | Password login succeeds for an existing local user                                                     |
| Sessions      | Refresh, logout, and session list/revoke still work                                                    |
| Users         | `/users/me`, user list, admin create, make/remove admin still work                                     |
| Registration  | New local user registration works when registration is enabled                                         |
| Password      | Change password, logout, and login with the new password                                               |
| OIDC          | Existing OIDC login works; auto-provision check only if enabled                                        |
| API keys      | Admin create/list/delete API key; API key authentication updates usage                                 |
| Settings      | Read/write user settings and global auth settings                                                      |
| Preferences   | Read/write user preferences and user cleanup still work                                                |
| Open tabs     | Tab restore, single upsert, bulk sync, update/delete, active session list, and user cleanup work       |
| Alerts        | Active alert filtering, dismiss/undismiss, dismissed list, export, and user cleanup work               |
| Homepage      | Homepage layout read/write still works                                                                 |
| Topology      | Network topology read/write and user cleanup still work                                                |
| Dashboard     | Dashboard service link list/create/update/delete still works                                           |
| Command log   | Terminal and host command history save/list/delete and cleanup still work                              |
| Activity      | Recent activity cleanup for host, folder, password reset, and user deletion still works                |
| Usage         | SSH credential usage tracking and host/folder/user cleanup still work                                  |
| SSO providers | Login provider list, admin provider list/create/update/delete, and OIDC/LDAP login config loading work |
| Audit logs    | Audit write, audit list filters, action filter list, and user cleanup still work                       |
| Roles         | Admin list/create/update/delete role and assign/remove a user role                                     |
| RBAC access   | Host/snippet share/revoke/list and shared host/snippet endpoints work                                  |
| Security      | Non-admin user is rejected from admin-only endpoints                                                   |

Do not continue gray rollout if any check fails.

Also verify these startup log cases before production gray:

| Environment value                            | Expected startup behavior                          |
| -------------------------------------------- | -------------------------------------------------- |
| `DATABASE_LAYER_REPOSITORY_ROLLOUT=all`      | startup logs `mode: all` and all supported domains |
| `DATABASE_LAYER_REPOSITORY_ROLLOUT=off`      | migrated repository use fails closed               |
| `DATABASE_LAYER_REPOSITORY_ROLLOUT=settings` | only settings repository boundary is allowed       |

Then check `/database/migration/status` as an admin and confirm
`repositoryRollout.mode`, `repositoryRollout.enabledDomains`, and
`repositoryRollout.explicit` match the intended gray target.
`repositoryRollout.warnings` should be empty for the recommended full gray
slice.

## 5. Rollout Stages

Recommended stages:

1. Local fixture run with copied production-like data.
2. Internal staging with one admin and one normal user.
3. Internal gray target with real integrations enabled.
4. Small production gray group.

Do not run multiple backend instances from this branch. The current runtime still
uses the encrypted SQLite snapshot model and is not safe for multi-writer
deployment.

## 6. Rollback

Rollback should be operationally simple because this gray scope does not change
the data format or require an external database.

Rollback steps:

1. Stop the gray build.
2. Restore the pre-gray encrypted database snapshot if any write-path smoke test
   failed.
3. Deploy the previous known-good commit or image tag.
4. Start the previous version.
5. Verify startup, login, settings read, and one admin endpoint.

If the gray build only served read paths and no smoke test failed, restoring the
snapshot may not be necessary. If there is any doubt, restore the snapshot.

## 7. Stop Conditions

Stop gray rollout immediately if any of these happen:

- Login failure spike.
- API key authentication failure for known-good keys.
- Admin authorization mismatch.
- OIDC callback failure for existing users.
- Missing or stale settings after write.
- Data snapshot save errors.
- Any database error mentioning missing tables, unknown columns, or failed
  serialization.
- Any user encryption or data unlock failure.
- Any unexpected `Repository domain ... is disabled` error for a domain that was
  intended to be enabled.

## 8. Current Gray Readiness

Current branch can be considered gray-candidate only after all validation
commands and smoke checks above pass on staging.

The branch should remain draft until gray evidence is attached to the PR.
