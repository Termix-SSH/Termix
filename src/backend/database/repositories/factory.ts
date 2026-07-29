import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import { getDb, getSqlite } from "../db/index.js";
import { needsExplicitPersist, resolveDatabaseDialect } from "../db/dialect.js";
import { primeSettingsCache, readCachedSetting } from "./settings-cache.js";
import type { DatabaseContext } from "./database-context.js";
import { WebauthnCredentialRepository } from "./webauthn-credential-repository.js";
import { AlertRepository } from "./alert-repository.js";
import { ApiKeyRepository } from "./api-key-repository.js";
import { AuditLogRepository } from "./audit-log-repository.js";
import { C2sTunnelPresetRepository } from "./c2s-tunnel-preset-repository.js";
import { CommandHistoryRepository } from "./command-history-repository.js";
import { CredentialRepository } from "./credential-repository.js";
import { DashboardServiceLinkRepository } from "./dashboard-service-link-repository.js";
import { DismissedAlertRepository } from "./dismissed-alert-repository.js";
import { FileManagerBookmarkRepository } from "./file-manager-bookmark-repository.js";
import { HomepageItemRepository } from "./homepage-item-repository.js";
import { HomepageLayoutRepository } from "./homepage-layout-repository.js";
import { HostFolderRepository } from "./host-folder-repository.js";
import { HostHealthRepository } from "./host-health-repository.js";
import { HostMetricsHistoryRepository } from "./host-metrics-history-repository.js";
import { HostMetricsPreferenceRepository } from "./host-metrics-preference-repository.js";
import { HostRepository } from "./host-repository.js";
import { HostResolutionRepository } from "./host-resolution-repository.js";
import { NetworkTopologyRepository } from "./network-topology-repository.js";
import { OpenTabRepository } from "./open-tab-repository.js";
import { OpksshTokenRepository } from "./opkssh-token-repository.js";
import { RbacAccessRepository } from "./rbac-access-repository.js";
import { RecentActivityRepository } from "./recent-activity-repository.js";
import { RoleRepository } from "./role-repository.js";
import { SessionRecordingRepository } from "./session-recording-repository.js";
import { SessionRepository } from "./session-repository.js";
import { SessionShareRepository } from "./session-share-repository.js";
import { SettingsRepository } from "./settings-repository.js";
import { SharedHostSecretsRepository } from "./shared-host-secrets-repository.js";
import { SnippetRepository } from "./snippet-repository.js";
import { SshCredentialUsageRepository } from "./ssh-credential-usage-repository.js";
import { SyncTombstoneRepository } from "./sync-tombstone-repository.js";
import { SsoProviderRepository } from "./sso-provider-repository.js";
import { TermixIdentityCaRepository } from "./termix-identity-ca-repository.js";
import { TermixIdentityRepository } from "./termix-identity-repository.js";
import { TmuxSessionTagRepository } from "./tmux-session-tag-repository.js";
import { TransferRecentRepository } from "./transfer-recent-repository.js";
import { TrustedDeviceRepository } from "./trusted-device-repository.js";
import { UserDataExportRepository } from "./user-data-export-repository.js";
import { UserPreferenceRepository } from "./user-preference-repository.js";
import { UserRepository } from "./user-repository.js";
import { VaultProfileRepository } from "./vault-profile-repository.js";
import { VaultTokenRepository } from "./vault-token-repository.js";

export function createCurrentRepositoryContext(): DatabaseContext {
  return {
    dialect: "sqlite",
    drizzle: getDb(),
  };
}

/**
 * Post-write hook handed to every repository.
 *
 * Only meaningful for SQLite, where the database lives in memory and has to be
 * serialised back to its encrypted file. On Postgres and MySQL the write is
 * already durable, so no hook is installed at all rather than one that does
 * nothing — repositories call it as `this.onWrite?.()`.
 */
export function createCurrentRepositoryWriteHook(
  reason: string,
): (() => Promise<void>) | undefined {
  if (!needsExplicitPersist(resolveDatabaseDialect())) return undefined;
  return () => DatabaseSaveTrigger.forceSave(reason);
}

/**
 * Raw driver handle for the few synchronous call sites that cannot await —
 * getCurrentSettingValue below, and settings reads during startup. Repositories
 * must not use this: they take a DatabaseContext, which is drizzle-only.
 * Porting to another engine means giving these callers an async path first.
 */
export function getCurrentRepositorySqlite() {
  return getSqlite();
}

/**
 * Synchronous settings read.
 *
 * SQLite can be queried synchronously, so it is read directly and stays
 * authoritative. Other engines have no synchronous query, so the value comes
 * from the cache primed at startup and kept current by SettingsRepository.
 */
export function getCurrentSettingValue(key: string): string | null {
  if (!needsExplicitPersist(resolveDatabaseDialect())) {
    return readCachedSetting(key);
  }

  const row = getCurrentRepositorySqlite()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value?: string } | undefined;

  return row?.value ?? null;
}

export function createCurrentWebauthnCredentialRepository(): WebauthnCredentialRepository {
  return new WebauthnCredentialRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("webauthn_credential_repository_write"),
  );
}

export function createCurrentAlertRepository(): AlertRepository {
  return new AlertRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("alert_repository_write"),
  );
}

export function createCurrentApiKeyRepository(): ApiKeyRepository {
  return new ApiKeyRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("api_key_repository_write"),
  );
}

export function createCurrentAuditLogRepository(): AuditLogRepository {
  return new AuditLogRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("audit_log_repository_write"),
  );
}

export function createCurrentC2sTunnelPresetRepository(): C2sTunnelPresetRepository {
  return new C2sTunnelPresetRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("c2s_tunnel_preset_repository_write"),
  );
}

export function createCurrentCommandHistoryRepository(): CommandHistoryRepository {
  return new CommandHistoryRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("command_history_repository_write"),
  );
}

export function createCurrentCredentialRepository(): CredentialRepository {
  return new CredentialRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("credential_repository_write"),
  );
}

export function createCurrentDashboardServiceLinkRepository(): DashboardServiceLinkRepository {
  return new DashboardServiceLinkRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("dashboard_service_link_repository_write"),
  );
}

export function createCurrentSyncTombstoneRepository(): SyncTombstoneRepository {
  return new SyncTombstoneRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("sync_tombstone_repository_write"),
  );
}

export function createCurrentDismissedAlertRepository(): DismissedAlertRepository {
  return new DismissedAlertRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("dismissed_alert_repository_write"),
  );
}

export function createCurrentFileManagerBookmarkRepository(): FileManagerBookmarkRepository {
  return new FileManagerBookmarkRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("file_manager_bookmarks_repository_write"),
  );
}

export function createCurrentHomepageItemRepository(): HomepageItemRepository {
  return new HomepageItemRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("homepage_item_repository_write"),
  );
}

export function createCurrentHomepageLayoutRepository(): HomepageLayoutRepository {
  return new HomepageLayoutRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("homepage_layout_repository_write"),
  );
}

export function createCurrentHostFolderRepository(): HostFolderRepository {
  return new HostFolderRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("host_folder_repository_write"),
  );
}

export function createCurrentHostHealthRepository(): HostHealthRepository {
  return new HostHealthRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("host_health_repository_write"),
  );
}

export function createCurrentHostMetricsHistoryRepository(): HostMetricsHistoryRepository {
  return new HostMetricsHistoryRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("host_metrics_history_repository_write"),
  );
}

export function createCurrentHostMetricsPreferenceRepository(): HostMetricsPreferenceRepository {
  return new HostMetricsPreferenceRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook(
      "host_metrics_preference_repository_write",
    ),
  );
}

export function createCurrentHostRepository(): HostRepository {
  return new HostRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("host_repository_write"),
  );
}

export function createCurrentHostResolutionRepository(): HostResolutionRepository {
  return new HostResolutionRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("host_resolution_repository_write"),
  );
}

export function createCurrentNetworkTopologyRepository(): NetworkTopologyRepository {
  return new NetworkTopologyRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("network_topology_repository_write"),
  );
}

export function createCurrentOpenTabRepository(): OpenTabRepository {
  return new OpenTabRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("open_tab_repository_write"),
  );
}

export function createCurrentOpksshTokenRepository(): OpksshTokenRepository {
  return new OpksshTokenRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("opkssh_token_repository_write"),
  );
}

export function createCurrentRbacAccessRepository(): RbacAccessRepository {
  return new RbacAccessRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("rbac_access_repository_write"),
  );
}

export function createCurrentRecentActivityRepository(): RecentActivityRepository {
  return new RecentActivityRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("recent_activity_repository_write"),
  );
}

export function createCurrentRoleRepository(): RoleRepository {
  return new RoleRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("role_repository_write"),
  );
}

export function createCurrentSessionRecordingRepository(): SessionRecordingRepository {
  return new SessionRecordingRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("session_recording_repository_write"),
  );
}

export function createCurrentSessionRepository(): SessionRepository {
  return new SessionRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("session_repository_write"),
  );
}

export function createCurrentSessionShareRepository(): SessionShareRepository {
  return new SessionShareRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("session_share_repository_write"),
  );
}

export function createCurrentSettingsRepository(): SettingsRepository {
  return new SettingsRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("settings_repository_write"),
  );
}

export function createCurrentSharedHostSecretsRepository(): SharedHostSecretsRepository {
  return new SharedHostSecretsRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("shared_host_secrets_repository_write"),
  );
}

export function createCurrentSnippetRepository(): SnippetRepository {
  return new SnippetRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("snippet_repository_write"),
  );
}

export function createCurrentSshCredentialUsageRepository(): SshCredentialUsageRepository {
  return new SshCredentialUsageRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("ssh_credential_usage_repository_write"),
  );
}

export function createCurrentSsoProviderRepository(): SsoProviderRepository {
  return new SsoProviderRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("sso_provider_repository_write"),
  );
}

export function createCurrentTermixIdentityCaRepository(): TermixIdentityCaRepository {
  return new TermixIdentityCaRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("termix_identity_ca_repository_write"),
  );
}

export function createCurrentTermixIdentityRepository(): TermixIdentityRepository {
  return new TermixIdentityRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("termix_identity_repository_write"),
  );
}

export function createCurrentTmuxSessionTagRepository(): TmuxSessionTagRepository {
  return new TmuxSessionTagRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("tmux_session_tag_repository_write"),
  );
}

export function createCurrentTransferRecentRepository(): TransferRecentRepository {
  return new TransferRecentRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("transfer_recent_repository_write"),
  );
}

export function createCurrentTrustedDeviceRepository(): TrustedDeviceRepository {
  return new TrustedDeviceRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("trusted_device_repository_write"),
  );
}

export function createCurrentUserDataExportRepository(): UserDataExportRepository {
  return new UserDataExportRepository(createCurrentRepositoryContext());
}

export function createCurrentUserPreferenceRepository(): UserPreferenceRepository {
  return new UserPreferenceRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("user_preference_repository_write"),
  );
}

export function createCurrentUserRepository(): UserRepository {
  return new UserRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("user_repository_write"),
  );
}

export function createCurrentVaultProfileRepository(): VaultProfileRepository {
  return new VaultProfileRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("vault_profile_repository_write"),
  );
}

export function createCurrentVaultTokenRepository(): VaultTokenRepository {
  return new VaultTokenRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("vault_token_repository_write"),
  );
}

/**
 * Loads the settings cache. Must run during startup on engines without a
 * synchronous read, before anything calls getCurrentSettingValue.
 */
export async function primeCurrentSettingsCache(): Promise<void> {
  const rows = await createCurrentSettingsRepository().listAll();
  primeSettingsCache(rows);
}

/**
 * How often a replica re-reads the settings table.
 *
 * Override with SETTINGS_CACHE_REFRESH_SECONDS; 0 disables the refresh.
 */
const REFRESH_SECONDS_ENV = "SETTINGS_CACHE_REFRESH_SECONDS";
const DEFAULT_REFRESH_SECONDS = 30;

let refreshTimer: NodeJS.Timeout | null = null;

/**
 * Keeps the settings cache from drifting on a multi-replica deployment.
 *
 * The cache is per-process and updated in the process that writes. That is
 * enough for SQLite, where there is only ever one process. On Postgres and
 * MySQL — which exist here precisely so more than one instance can share the
 * data — a setting changed on one replica would otherwise never reach the
 * others, because the synchronous read has no way to go back to the database.
 *
 * Periodic re-priming does not make the value immediately consistent. It bounds
 * how long it can be wrong, which is the difference between a setting that
 * takes effect on the next tick and one that takes effect at the next restart.
 */
export function startSettingsCacheRefresh(
  env = process.env,
  refresh: () => Promise<void> = primeCurrentSettingsCache,
): void {
  if (refreshTimer) return;

  const seconds = refreshIntervalSeconds(env);
  if (seconds === null) return;

  refreshTimer = setInterval(() => {
    void refresh().catch(() => {
      // A failed refresh leaves the previous values in place, which is the
      // right outcome: a transient database blip should not blank the cache.
      // Every caller reads a missing setting as "use the default", so an empty
      // cache would silently revert configuration across the deployment.
    });
  }, seconds * 1000);

  refreshTimer.unref();
}

/** The configured interval, or null when refreshing is switched off. */
export function refreshIntervalSeconds(env = process.env): number | null {
  const seconds = Number(env[REFRESH_SECONDS_ENV] ?? DEFAULT_REFRESH_SECONDS);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/** Test seam. */
export function stopSettingsCacheRefresh(): void {
  if (!refreshTimer) return;
  clearInterval(refreshTimer);
  refreshTimer = null;
}
