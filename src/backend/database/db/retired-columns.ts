/**
 * What 26.10.0 removes that 2.9.0 kept so a downgrade to 2.8 lost nothing.
 * Every 2.9 boot copied it into plugin settings, and the upgrade guard only
 * opens a database 2.9 has seen.
 *
 * Kept on purpose: columns a move only reads once the owner's data key opens
 * at a password login (users.totp_*, the rdp, vnc and telnet logins and
 * domain), so a user who never signed in to 2.9 still gets them, and
 * ssh_data.vault_profile_id, whose foreign key SQLite cannot drop in place.
 */

/** Columns drizzle never knew were removed, dropped by hand on every engine. */
export const REMOTE_RETIRED_COLUMNS: Record<string, string[]> = {
  ssh_data: [
    "allow_session_sharing",
    "autostart_key",
    "autostart_key_password",
    "autostart_password",
    "default_path",
    "docker_config",
    "enable_ai_assistant",
    "enable_command_history",
    "enable_docker",
    "enable_file_manager",
    "enable_proxmox",
    "enable_proxmox_stats",
    "enable_rdp",
    "enable_session_logging",
    "enable_telnet",
    "enable_terminal",
    "enable_terminal_toolbar",
    "enable_tmux_monitor",
    "enable_tunnel",
    "enable_vnc",
    "enable_web_ui",
    "guacamole_config",
    "ignore_cert",
    "mac_address",
    "proxmox_config",
    "proxmox_stats_config",
    "rdp_ignore_cert",
    "rdp_port",
    "rdp_security",
    "scp_legacy",
    "security",
    "show_docker_in_sidebar",
    "show_file_manager_in_sidebar",
    "show_server_stats_in_sidebar",
    "show_terminal_in_sidebar",
    "show_tunnel_in_sidebar",
    "stats_config",
    "telnet_port",
    "tunnel_connections",
    "use_warpgate",
    "vnc_port",
    "web_ui_config",
    "wol_broadcast_address",
  ],
  user_preferences: [
    "ai_assistant_enabled",
    "ai_read_only_commands",
    "rdp_defaults",
  ],
};

/** Everything SQLite drops; the first part the drizzle migrations drop too. */
export const RETIRED_COLUMNS: Record<string, string[]> = {
  users: [
    "is_oidc",
    "oidc_identifier",
    "sso_provider_id",
    "client_id",
    "client_secret",
    "issuer_url",
    "authorization_url",
    "token_url",
    "identifier_path",
    "name_path",
    "scopes",
  ],
  sessions: ["oidc_sub", "oidc_sid", "sso_provider_id"],
  user_preferences: [
    "command_autocomplete",
    "terminal_defaults",
    "custom_themes",
    "confirm_snippet_execution",
    "terminal_macros",
    ...REMOTE_RETIRED_COLUMNS.user_preferences,
  ],
  ssh_data: [
    "terminal_config",
    "quick_actions",
    ...REMOTE_RETIRED_COLUMNS.ssh_data,
  ],
};

/** Settings rows the plugins copied, and the markers of the copies. */
export const RETIRED_SETTINGS = [
  "host_defaults",
  "analytics_enabled",
  "analytics_instance_id",
  "terminal_session_timeout_minutes",
  "terminal_session_persistence_enabled",
  "command_history_enabled",
  "touch_input_settings",
  "terminal_image_storage_mode",
  "terminal_image_local_dir",
  "terminal_image_host_path",
  "terminal_image_ttl_ms",
  "terminal_image_max_count",
  "terminal_image_max_storage_bytes",
  "session_sharing_globally_enabled",
  "guac_enabled",
  "guac_url",
  "step_ca_url",
  "step_ca_fingerprint",
  "step_ca_provisioner",
  "step_ca_private_endpoint_allowlist",
  "acme_ssl_settings",
  "global_metrics_interval",
  "metrics_history_retention_days",
  "tailscale_api_base_url",
  "tailscale_api_key",
  "ai_globally_enabled",
  "ai_private_endpoint_allowlist",
  "oidc_silent_login_default",
  "host_status_config_migrated",
];

/**
 * 2.8 editors kept a host's sudo password inside terminal_config, and 2.9
 * still read it from there. Before the column goes it is copied into
 * sudo_password, as plaintext, which the field encryption reads as it is
 * and encrypts on the next save.
 */
export function legacySudoPassword(terminalConfig: unknown): string | null {
  let parsed = terminalConfig;
  try {
    while (typeof parsed === "string") parsed = JSON.parse(parsed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const value = (parsed as { sudoPassword?: unknown }).sudoPassword;
  return typeof value === "string" && value ? value : null;
}

export interface LegacySudoRow {
  id: number;
  terminal_config: unknown;
  sudo_password: unknown;
}

/** The hosts whose sudo password still only lives in terminal_config. */
export function legacySudoMoves(
  rows: LegacySudoRow[],
): Array<{ id: number; sudoPassword: string }> {
  return rows.flatMap((row) => {
    if (row.sudo_password) return [];
    const sudoPassword = legacySudoPassword(row.terminal_config);
    return sudoPassword ? [{ id: Number(row.id), sudoPassword }] : [];
  });
}

/**
 * Rewrites the 2.8 `$oidc.preferred_username` placeholder to
 * `$external.username` wherever a host username is saved. Plain SQL that
 * runs the same on SQLite, Postgres and MySQL; the drizzle migrations carry
 * a copy.
 */
export const LEGACY_USERNAME_PLACEHOLDER_UPDATES = [
  "UPDATE ssh_data SET username = REPLACE(username, '$oidc.preferred_username', '$external.username') WHERE username LIKE '%$oidc.preferred_username%'",
  "UPDATE ssh_credentials SET username = REPLACE(username, '$oidc.preferred_username', '$external.username') WHERE username LIKE '%$oidc.preferred_username%'",
  "UPDATE host_defaults SET value = REPLACE(value, '$oidc.preferred_username', '$external.username') WHERE value LIKE '%$oidc.preferred_username%'",
];
