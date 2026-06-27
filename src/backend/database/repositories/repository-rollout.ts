import { databaseLogger } from "../../utils/logger.js";

export const REPOSITORY_ROLLOUT_ENV = "DATABASE_LAYER_REPOSITORY_ROLLOUT";

export const REPOSITORY_ROLLOUT_DOMAINS = [
  "settings",
  "users",
  "sessions",
  "api_keys",
  "trusted_devices",
  "credentials",
  "hosts",
  "snippets",
  "roles",
  "rbac_access",
  "sso_providers",
  "audit_logs",
  "user_preferences",
  "open_tabs",
  "dismissed_alerts",
  "homepage_layouts",
  "homepage_items",
  "network_topology",
  "dashboard_service_links",
  "session_recordings",
  "command_history",
  "recent_activity",
  "ssh_credential_usage",
  "transfer_recent",
  "file_manager_bookmarks",
  "c2s_tunnel_presets",
  "tmux_session_tags",
  "opkssh_tokens",
  "vault_tokens",
  "vault_profiles",
  "host_metrics_preferences",
  "host_health",
  "host_metrics_history",
  "alerts",
  "user_data_exports",
  "host_folders",
  "host_resolution",
] as const;

export type RepositoryRolloutDomain =
  (typeof REPOSITORY_ROLLOUT_DOMAINS)[number];

export interface RepositoryRolloutConfig {
  mode: "all" | "none" | "partial";
  enabledDomains: RepositoryRolloutDomain[];
  explicit: boolean;
}

export interface RepositoryRolloutStatus extends RepositoryRolloutConfig {
  envKey: typeof REPOSITORY_ROLLOUT_ENV;
  supportedDomains: RepositoryRolloutDomain[];
  warnings: string[];
}

type EnvLike = Record<string, string | undefined>;

const DOMAIN_ALIASES: Record<string, RepositoryRolloutDomain> = {
  api: "api_keys",
  api_key: "api_keys",
  api_keys: "api_keys",
  apikey: "api_keys",
  apikeys: "api_keys",
  audit: "audit_logs",
  audit_log: "audit_logs",
  audit_logs: "audit_logs",
  auditlog: "audit_logs",
  auditlogs: "audit_logs",
  alert: "alerts",
  alerts: "alerts",
  dashboard_link: "dashboard_service_links",
  dashboard_links: "dashboard_service_links",
  dashboard_service_link: "dashboard_service_links",
  dashboard_service_links: "dashboard_service_links",
  dashboardlink: "dashboard_service_links",
  dashboardlinks: "dashboard_service_links",
  command_history: "command_history",
  commandhistory: "command_history",
  credential: "credentials",
  credentials: "credentials",
  history: "command_history",
  ssh_credential: "credentials",
  ssh_credentials: "credentials",
  sshcredential: "credentials",
  sshcredentials: "credentials",
  terminal_history: "command_history",
  dismissed_alert: "dismissed_alerts",
  dismissed_alerts: "dismissed_alerts",
  dismissedalert: "dismissed_alerts",
  dismissedalerts: "dismissed_alerts",
  dismissed: "dismissed_alerts",
  homepage_layout: "homepage_layouts",
  homepage_layouts: "homepage_layouts",
  homepagelayout: "homepage_layouts",
  homepagelayouts: "homepage_layouts",
  layout: "homepage_layouts",
  layouts: "homepage_layouts",
  homepage_item: "homepage_items",
  homepage_items: "homepage_items",
  homepageitem: "homepage_items",
  homepageitems: "homepage_items",
  host_folder: "host_folders",
  host_folders: "host_folders",
  hostfolder: "host_folders",
  hostfolders: "host_folders",
  host: "hosts",
  hosts: "hosts",
  snippet: "snippets",
  snippets: "snippets",
  host_resolution: "host_resolution",
  host_resolver: "host_resolution",
  hostresolution: "host_resolution",
  hostresolver: "host_resolution",
  resolver: "host_resolution",
  ssh_folder: "host_folders",
  ssh_folders: "host_folders",
  sshfolder: "host_folders",
  sshfolders: "host_folders",
  item: "homepage_items",
  items: "homepage_items",
  recording: "session_recordings",
  recordings: "session_recordings",
  session_recording: "session_recordings",
  session_recordings: "session_recordings",
  sessionrecording: "session_recordings",
  sessionrecordings: "session_recordings",
  network_topologies: "network_topology",
  network_topology: "network_topology",
  networktopologies: "network_topology",
  networktopology: "network_topology",
  topology: "network_topology",
  activity: "recent_activity",
  recent_activities: "recent_activity",
  recent_activity: "recent_activity",
  recentactivity: "recent_activity",
  credential_usage: "ssh_credential_usage",
  ssh_credential_usage: "ssh_credential_usage",
  sshcredentialusage: "ssh_credential_usage",
  usage: "ssh_credential_usage",
  transfer: "transfer_recent",
  transfer_recent: "transfer_recent",
  transferrecent: "transfer_recent",
  export: "user_data_exports",
  exports: "user_data_exports",
  user_data_export: "user_data_exports",
  user_data_exports: "user_data_exports",
  userdataexport: "user_data_exports",
  userdataexports: "user_data_exports",
  bookmark: "file_manager_bookmarks",
  bookmarks: "file_manager_bookmarks",
  file_bookmarks: "file_manager_bookmarks",
  file_manager_bookmark: "file_manager_bookmarks",
  file_manager_bookmarks: "file_manager_bookmarks",
  filemanagerbookmarks: "file_manager_bookmarks",
  c2s: "c2s_tunnel_presets",
  c2s_preset: "c2s_tunnel_presets",
  c2s_presets: "c2s_tunnel_presets",
  c2s_tunnel_preset: "c2s_tunnel_presets",
  c2s_tunnel_presets: "c2s_tunnel_presets",
  c2stunnelpresets: "c2s_tunnel_presets",
  tmux: "tmux_session_tags",
  tmux_tag: "tmux_session_tags",
  tmux_tags: "tmux_session_tags",
  tmux_session_tag: "tmux_session_tags",
  tmux_session_tags: "tmux_session_tags",
  tmuxsessiontags: "tmux_session_tags",
  opkssh: "opkssh_tokens",
  opkssh_token: "opkssh_tokens",
  opkssh_tokens: "opkssh_tokens",
  opksshtoken: "opkssh_tokens",
  opksshtokens: "opkssh_tokens",
  vault_token: "vault_tokens",
  vault_tokens: "vault_tokens",
  vaulttoken: "vault_tokens",
  vaulttokens: "vault_tokens",
  vault_profile: "vault_profiles",
  vault_profiles: "vault_profiles",
  vaultprofile: "vault_profiles",
  vaultprofiles: "vault_profiles",
  host_metrics_preference: "host_metrics_preferences",
  host_metrics_preferences: "host_metrics_preferences",
  hostmetricspreference: "host_metrics_preferences",
  hostmetricspreferences: "host_metrics_preferences",
  metrics_preferences: "host_metrics_preferences",
  health: "host_health",
  host_health: "host_health",
  host_health_checks: "host_health",
  host_health_history: "host_health",
  hosthealth: "host_health",
  host_metrics_history: "host_metrics_history",
  hostmetricshistory: "host_metrics_history",
  metrics_history: "host_metrics_history",
  open_tab: "open_tabs",
  open_tabs: "open_tabs",
  opentab: "open_tabs",
  opentabs: "open_tabs",
  setting: "settings",
  settings: "settings",
  session: "sessions",
  sessions: "sessions",
  trusted_device: "trusted_devices",
  trusted_devices: "trusted_devices",
  trusteddevice: "trusted_devices",
  trusteddevices: "trusted_devices",
  preference: "user_preferences",
  preferences: "user_preferences",
  user_preference: "user_preferences",
  user_preferences: "user_preferences",
  userpreference: "user_preferences",
  userpreferences: "user_preferences",
  role: "roles",
  roles: "roles",
  rbac: "rbac_access",
  rbac_access: "rbac_access",
  rbacaccess: "rbac_access",
  sso: "sso_providers",
  sso_provider: "sso_providers",
  sso_providers: "sso_providers",
  ssoprovider: "sso_providers",
  ssoproviders: "sso_providers",
  user: "users",
  users: "users",
};

const DISABLED_VALUES = new Set(["0", "false", "none", "off", "disabled"]);
const ENABLED_VALUES = new Set(["1", "true", "all", "on", "enabled"]);

function parseDomainList(value: string): RepositoryRolloutDomain[] {
  const domains = value
    .split(",")
    .map((part) => part.trim().toLowerCase().replaceAll("-", "_"))
    .filter(Boolean)
    .map((part) => {
      const domain = DOMAIN_ALIASES[part];
      if (!domain) {
        throw new Error(
          `Unsupported ${REPOSITORY_ROLLOUT_ENV} domain '${part}'. Expected one of: ${REPOSITORY_ROLLOUT_DOMAINS.join(", ")}.`,
        );
      }
      return domain;
    });

  return Array.from(new Set(domains));
}

export function parseRepositoryRolloutConfig(
  env: EnvLike = process.env,
): RepositoryRolloutConfig {
  const raw = env[REPOSITORY_ROLLOUT_ENV];
  const normalized = raw?.trim().toLowerCase();

  if (!normalized) {
    return {
      mode: "all",
      enabledDomains: [...REPOSITORY_ROLLOUT_DOMAINS],
      explicit: false,
    };
  }

  if (ENABLED_VALUES.has(normalized)) {
    return {
      mode: "all",
      enabledDomains: [...REPOSITORY_ROLLOUT_DOMAINS],
      explicit: true,
    };
  }

  if (DISABLED_VALUES.has(normalized)) {
    return { mode: "none", enabledDomains: [], explicit: true };
  }

  const enabledDomains = parseDomainList(normalized);
  return {
    mode:
      enabledDomains.length === REPOSITORY_ROLLOUT_DOMAINS.length
        ? "all"
        : "partial",
    enabledDomains,
    explicit: true,
  };
}

export function isRepositoryRolloutDomainEnabled(
  domain: RepositoryRolloutDomain,
  env: EnvLike = process.env,
): boolean {
  return parseRepositoryRolloutConfig(env).enabledDomains.includes(domain);
}

export function getRepositoryRolloutStatus(
  env: EnvLike = process.env,
): RepositoryRolloutStatus {
  const config = parseRepositoryRolloutConfig(env);
  return {
    ...config,
    envKey: REPOSITORY_ROLLOUT_ENV,
    supportedDomains: [...REPOSITORY_ROLLOUT_DOMAINS],
    warnings: getRepositoryRolloutWarnings(config),
  };
}

export function getRepositoryRolloutWarnings(
  config: RepositoryRolloutConfig,
): string[] {
  const warnings: string[] = [];

  if (!config.explicit) {
    warnings.push(
      `${REPOSITORY_ROLLOUT_ENV} is not explicitly set; gray targets should set it so rollout state is visible in deployment config.`,
    );
  }

  if (config.mode === "none") {
    warnings.push(
      "All migrated repository domains are disabled; migrated auth/settings/session paths will fail closed.",
    );
  }

  if (config.mode === "partial") {
    warnings.push(
      `Partial repository rollout enabled for domains: ${config.enabledDomains.join(", ")}.`,
    );
  }

  return warnings;
}

export function assertRepositoryRolloutDomainEnabled(
  domain: RepositoryRolloutDomain,
): void {
  if (isRepositoryRolloutDomainEnabled(domain)) return;

  throw new Error(
    `Repository domain '${domain}' is disabled by ${REPOSITORY_ROLLOUT_ENV}.`,
  );
}

export function logRepositoryRolloutConfig(env: EnvLike = process.env): void {
  const config = getRepositoryRolloutStatus(env);
  databaseLogger.info("Database repository rollout configuration loaded", {
    operation: "repository_rollout_config",
    mode: config.mode,
    enabledDomains: config.enabledDomains,
    explicit: config.explicit,
    envKey: REPOSITORY_ROLLOUT_ENV,
  });

  for (const warning of config.warnings) {
    databaseLogger.warn(warning, {
      operation: "repository_rollout_warning",
      mode: config.mode,
      enabledDomains: config.enabledDomains,
      explicit: config.explicit,
      envKey: REPOSITORY_ROLLOUT_ENV,
    });
  }
}
