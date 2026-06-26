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
- Settings reads and writes migrated behind `SettingsRepository`.
- Session create/read/update/revoke/list paths migrated behind
  `SessionRepository`.
- User create/read/update/delete/auth paths migrated behind `UserRepository`.
- API key create/list/delete and authentication last-used updates migrated behind
  `ApiKeyRepository`.
- Trusted device check/add/remove and TOTP trusted-device cleanup migrated
  behind `TrustedDeviceRepository`.
- Current field encryption behavior.

Not included in gray rollout:

- PostgreSQL or MySQL/MariaDB runtime.
- New external database configuration UI.
- New schema migration strategy.
- Host and credential route migration beyond existing repository skeletons.
- RBAC, audit, preferences, file manager, metrics, and notification repository
  migration.
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

Minimum backup artifacts:

- encrypted SQLite snapshot file
- environment configuration
- application version or image tag
- logs from the last healthy startup on the previous version

## 3. Required Validation Commands

Run before deployment:

```bash
npm run type-check
npx eslint src/backend/database/repositories/api-key-repository.ts src/backend/database/repositories/current-api-key-repository.ts src/backend/database/repositories/api-key-repository.test.ts src/backend/database/routes/user-api-key-routes.ts src/backend/database/routes/users.ts src/backend/utils/auth-manager.ts
npm run test -- src/backend/database/runtime/config.test.ts src/backend/database/runtime/sqlite-adapter.test.ts src/backend/database/repositories/settings-repository.test.ts src/backend/database/repositories/user-session-repositories.test.ts src/backend/database/repositories/api-key-repository.test.ts src/backend/database/repositories/host-credential-repositories.test.ts src/backend/database/repositories/field-encryption-boundary.test.ts src/backend/utils/field-crypto.test.ts src/backend/guacamole/token-service.test.ts src/backend/database/routes/user-oidc-utils.test.ts
git diff --check
```

## 4. Smoke Test Matrix

Run these against the gray target:

| Area         | Required check                                                         |
| ------------ | ---------------------------------------------------------------------- |
| Startup      | App starts from existing encrypted snapshot without schema errors      |
| Login        | Password login succeeds for an existing local user                     |
| Sessions     | Refresh, logout, and session list/revoke still work                    |
| Users        | `/users/me`, user list, admin create, make/remove admin still work     |
| Registration | New local user registration works when registration is enabled         |
| Password     | Change password, logout, and login with the new password               |
| OIDC         | Existing OIDC login works; auto-provision check only if enabled        |
| API keys     | Admin create/list/delete API key; API key authentication updates usage |
| Settings     | Read/write user settings and global auth settings                      |
| Security     | Non-admin user is rejected from admin-only endpoints                   |

Do not continue gray rollout if any check fails.

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

## 8. Current Gray Readiness

Current branch can be considered gray-candidate only after all validation
commands and smoke checks above pass on staging.

The branch should remain draft until gray evidence is attached to the PR.
