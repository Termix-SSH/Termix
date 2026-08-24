// GENERATED FILE — do not edit.
//
// Produced from schema.ts by scripts/generate-dialect-schema.cjs.
// Edit the sqlite schema and re-run `node scripts/generate-dialect-schema.cjs`.
// Target dialect: mysql.
//
// DDL source for drizzle-kit. NOT imported to run queries — repositories use
// schema.ts on every dialect. See the generator header for why that is correct.

import {
  mysqlTable,
  text,
  varchar,
  int,
  boolean,
  double,
  index,
  uniqueIndex,
  type AnyMySqlColumn,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

export const users = mysqlTable("users", {
  id: varchar("id", { length: 255 }).primaryKey(),
  username: text("username").notNull(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),

  isOidc: boolean("is_oidc").notNull().default(false),
  oidcIdentifier: text("oidc_identifier"),
  ssoProviderId: int("sso_provider_id"),
  clientId: text("client_id"),
  clientSecret: text("client_secret"),
  issuerUrl: text("issuer_url"),
  authorizationUrl: text("authorization_url"),
  tokenUrl: text("token_url"),
  identifierPath: text("identifier_path"),
  namePath: text("name_path"),
  scopes: text().default("openid email profile"),

  totpSecret: text("totp_secret"),
  totpEnabled: boolean("totp_enabled")
    .notNull()
    .default(false),
  totpBackupCodes: text("totp_backup_codes"),

  registeredAt: text("registered_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  donationModalDismissed: boolean("donation_modal_dismissed")
    .notNull()
    .default(false),
});

export const settings = mysqlTable("settings", {
  key: varchar("key", { length: 255 }).primaryKey(),
  value: text("value").notNull(),
});

export const ssoProviders = mysqlTable("sso_providers", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  type: text("type").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  displayOrder: int("display_order").notNull().default(0),
  config: text("config").notNull(),
  createdAt: varchar("created_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: varchar("updated_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export const sessions = mysqlTable(
  "sessions",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jwtToken: text("jwt_token").notNull(),
    deviceType: text("device_type").notNull(),
    deviceInfo: text("device_info").notNull(),
    oidcSub: text("oidc_sub"),
    oidcSid: text("oidc_sid"),
    ssoProviderId: int("sso_provider_id"),
    createdAt: varchar("created_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    expiresAt: varchar("expires_at", { length: 255 }).notNull(),
    lastActiveAt: text("last_active_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  // Listing a user's devices, and the startup sweep of expired rows.
  (table) => [
    index("idx_sessions_user_id").on(table.userId),
    index("idx_sessions_expires_at").on(table.expiresAt),
  ],
);

export const trustedDevices = mysqlTable(
  "trusted_devices",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceFingerprint: text("device_fingerprint").notNull(),
    deviceType: text("device_type").notNull(),
    deviceInfo: text("device_info").notNull(),
    createdAt: varchar("created_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    expiresAt: varchar("expires_at", { length: 255 }).notNull(),
    lastUsedAt: text("last_used_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [index("idx_trusted_devices_user_id").on(table.userId)],
);

export const webauthnCredentials = mysqlTable("webauthn_credentials", {
  id: varchar("id", { length: 255 }).primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  credentialId: varchar("credential_id", { length: 255 }).notNull(),
  publicKey: text("public_key").notNull(),
  counter: int("counter").notNull().default(0),
  deviceType: text("device_type"),
  backedUp: boolean("backed_up").notNull().default(false),
  transports: text("transports"),
  userVerification: text("user_verification").notNull().default("preferred"),
  createdAt: varchar("created_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  lastUsedAt: text("last_used_at"),
});

export const hosts = mysqlTable(
  "ssh_data",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectionType: text("connection_type").notNull().default("ssh"),
    name: varchar("name", { length: 255 }),
    ip: text("ip").notNull(),
    port: int("port").notNull(),
    username: text("username").notNull(),
    folder: text("folder"),
    // Sub-host nesting: a host acting as an organizational parent for other
    // hosts, mutually exclusive with folder (see host route validation).
    parentHostId: int("parent_host_id").references(
      (): AnyMySqlColumn => hosts.id,
      { onDelete: "set null" },
    ),
    tags: text("tags"),
    pin: boolean("pin").notNull().default(false),
    // Manual drag-to-reorder position within a folder. Null means the host has
    // never been manually reordered; falls back to name sort in that case.
    sortOrder: int("sort_order"),
    authType: text("auth_type").notNull(),
    useWarpgate: boolean("use_warpgate").notNull().default(false),
    shareSshAuth: boolean("share_ssh_auth")
      .notNull()
      .default(false),
    forceKeyboardInteractive: text("force_keyboard_interactive"),

    password: text("password"),
    key: text("key"),
    keyPassword: text("key_password"),
    keyType: text("key_type"),
    sudoPassword: text("sudo_password"),

    autostartPassword: text("autostart_password"),
    autostartKey: text("autostart_key"),
    autostartKeyPassword: text("autostart_key_password"),

    credentialId: int("credential_id").references(() => sshCredentials.id, { onDelete: "set null" }),
    overrideCredentialUsername: boolean("override_credential_username"),
    // When authType is "vault", the host authenticates via a Vault SSH signer
    // profile (shared settings, no secrets). The signing certificate is obtained
    // per-user at connect time via an interactive Vault OIDC flow.
    vaultProfileId: int("vault_profile_id").references(
      () => vaultProfiles.id,
      { onDelete: "set null" },
    ),
    enableTerminal: boolean("enable_terminal")
      .notNull()
      .default(true),
    enableSessionLogging: boolean("enable_session_logging")
      .notNull()
      .default(true),
    allowSessionSharing: boolean("allow_session_sharing")
      .notNull()
      .default(true),
    enableCommandHistory: boolean("enable_command_history")
      .notNull()
      .default(true),
    enableTunnel: boolean("enable_tunnel")
      .notNull()
      .default(true),
    tunnelConnections: text("tunnel_connections"),
    jumpHosts: text("jump_hosts"),
    enableFileManager: boolean("enable_file_manager")
      .notNull()
      .default(true),
    scpLegacy: boolean("scp_legacy").notNull().default(false),
    enableDocker: boolean("enable_docker")
      .notNull()
      .default(false),
    enableTmuxMonitor: boolean("enable_tmux_monitor")
      .notNull()
      .default(false),
    enableTerminalToolbar: boolean("enable_terminal_toolbar")
      .notNull()
      .default(true),
    showTerminalInSidebar: boolean("show_terminal_in_sidebar")
      .notNull()
      .default(true),
    showFileManagerInSidebar: boolean("show_file_manager_in_sidebar")
      .notNull()
      .default(false),
    showTunnelInSidebar: boolean("show_tunnel_in_sidebar")
      .notNull()
      .default(false),
    showDockerInSidebar: boolean("show_docker_in_sidebar")
      .notNull()
      .default(false),
    showServerStatsInSidebar: boolean("show_server_stats_in_sidebar")
      .notNull()
      .default(false),
    defaultPath: text("default_path"),
    statsConfig: text("stats_config"),
    dockerConfig: text("docker_config"),
    enableProxmox: boolean("enable_proxmox")
      .notNull()
      .default(false),
    proxmoxConfig: text("proxmox_config"),
    enableProxmoxStats: boolean("enable_proxmox_stats")
      .notNull()
      .default(false),
    proxmoxStatsConfig: text("proxmox_stats_config"),
    terminalConfig: text("terminal_config"),
    quickActions: text("quick_actions"),
    notes: text("notes"),
    enableSsh: boolean("enable_ssh").notNull().default(true),
    enableRdp: boolean("enable_rdp").notNull().default(false),
    enableVnc: boolean("enable_vnc").notNull().default(false),
    enableTelnet: boolean("enable_telnet").notNull().default(false),

    sshPort: int("ssh_port").default(22),
    rdpPort: int("rdp_port").default(3389),
    vncPort: int("vnc_port").default(5900),
    telnetPort: int("telnet_port").default(23),

    rdpCredentialId: int("rdp_credential_id").references(() => sshCredentials.id, { onDelete: "set null" }),
    rdpUser: text("rdp_user"),
    rdpPassword: text("rdp_password"),
    rdpDomain: text("rdp_domain"),
    rdpSecurity: text("rdp_security"),
    rdpIgnoreCert: boolean("rdp_ignore_cert").default(false),

    vncCredentialId: int("vnc_credential_id").references(() => sshCredentials.id, { onDelete: "set null" }),
    vncPassword: text("vnc_password"),
    vncUser: text("vnc_user"),

    telnetUser: text("telnet_user"),
    telnetPassword: text("telnet_password"),
    telnetCredentialId: int("telnet_credential_id").references(() => sshCredentials.id, { onDelete: "set null" }),

    rdpAuthType: text("rdp_auth_type"),
    vncAuthType: text("vnc_auth_type"),
    telnetAuthType: text("telnet_auth_type"),

    domain: text("domain"),
    security: text("security"),
    ignoreCert: boolean("ignore_cert").default(false),
    guacamoleConfig: text("guacamole_config"),

    useSocks5: boolean("use_socks5"),
    socks5Host: text("socks5_host"),
    socks5Port: int("socks5_port"),
    socks5Username: text("socks5_username"),
    socks5Password: text("socks5_password"),
    socks5ProxyChain: text("socks5_proxy_chain"),

    // null = use the desktop app's global default; "local" | "remote" pins
    // this specific host's SSH/Docker-console/Serial connections to originate
    // from the embedded local backend or a connected remote sync server.
    // Ignored for rdp/vnc/telnet, which always require the remote server.
    connectionOrigin: text("connection_origin"),

    macAddress: text("mac_address"),
    wolBroadcastAddress: text("wol_broadcast_address"),
    portKnockSequence: text("port_knock_sequence"),

    hostKeyFingerprint: text("host_key_fingerprint"),
    hostKeyType: text("host_key_type"),
    hostKeyAlgorithm: text("host_key_algorithm").default("sha256"),
    hostKeyFirstSeen: text("host_key_first_seen"),
    hostKeyLastVerified: text("host_key_last_verified"),
    hostKeyChangedCount: int("host_key_changed_count").default(0),

    // Stable identity used to match this row across two independently-seeded
    // databases (the embedded backend and a connected remote server) during
    // sync -- local autoincrement ids collide across instances.
    syncId: varchar("sync_id", { length: 255 }).unique(),

    createdAt: varchar("created_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: varchar("updated_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  // Every host read is scoped by owner, so user_id carries the host list.
  //
  // `folder` is deliberately not indexed: on Postgres/MySQL an indexed text
  // column is generated as varchar(255), and folder holds a joined nested path
  // with no length cap, so indexing it would truncate deep hierarchies.
  (table) => [
    index("idx_ssh_data_user_id").on(table.userId),
    index("idx_ssh_data_parent_host").on(table.parentHostId),
    index("idx_ssh_data_credential").on(table.credentialId),
  ],
);

export const fileManagerRecent = mysqlTable(
  "file_manager_recent",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hostId: int("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    path: text("path").notNull(),
    lastOpened: text("last_opened")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  // Every file manager surface is read for one user on one host at a time.
  (table) => [
    index("idx_file_manager_recent_user").on(table.userId, table.hostId),
  ],
);

export const fileManagerPinned = mysqlTable(
  "file_manager_pinned",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hostId: int("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    path: text("path").notNull(),
    pinnedAt: text("pinned_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    index("idx_file_manager_pinned_user").on(table.userId, table.hostId),
  ],
);

export const fileManagerShortcuts = mysqlTable(
  "file_manager_shortcuts",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hostId: int("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    path: text("path").notNull(),
    createdAt: varchar("created_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    index("idx_file_manager_shortcuts_user").on(table.userId, table.hostId),
  ],
);

export const transferRecent = mysqlTable(
  "transfer_recent",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceHostId: int("source_host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    destHostId: int("dest_host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    destPath: text("dest_path").notNull(),
    destPathLabel: text("dest_path_label").notNull(),
    lastUsed: text("last_used")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [index("idx_transfer_recent_user").on(table.userId)],
);

export const dismissedAlerts = mysqlTable(
  "dismissed_alerts",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    alertId: text("alert_id").notNull(),
    dismissedAt: text("dismissed_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [index("idx_dismissed_alerts_user_id").on(table.userId)],
);

export const sshCredentials = mysqlTable(
  "ssh_credentials",
  {
  id: int("id").autoincrement().primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  folder: text("folder"),
  tags: text("tags"),
  pin: boolean("pin").notNull().default(false),
  // Manual drag-to-reorder position within a folder. Null means the
  // credential has never been manually reordered; falls back to name sort
  // in that case, same convention as hosts.sortOrder.
  sortOrder: int("sort_order"),
  authType: text("auth_type").notNull(),
  username: text("username"),
  password: text("password"),
  key: text("key"),
  privateKey: text("private_key"),
  publicKey: text("public_key"),
  keyPassword: text("key_password"),
  keyType: text("key_type"),
  detectedKeyType: text("detected_key_type"),

  certPublicKey: text("cert_public_key"),


  usageCount: int("usage_count").notNull().default(0),
  lastUsed: text("last_used"),
  syncId: varchar("sync_id", { length: 255 }).unique(),
  createdAt: varchar("created_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: varchar("updated_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [index("idx_ssh_credentials_user_id").on(table.userId)],
);

export const sshCredentialUsage = mysqlTable(
  "ssh_credential_usage",
  {
    id: int("id").autoincrement().primaryKey(),
    credentialId: int("credential_id")
      .notNull()
      .references(() => sshCredentials.id, { onDelete: "cascade" }),
    hostId: int("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    usedAt: text("used_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    index("idx_ssh_credential_usage_credential").on(table.credentialId),
    index("idx_ssh_credential_usage_user").on(table.userId),
  ],
);

export const snippets = mysqlTable(
  "snippets",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    content: text("content").notNull(),
    description: text("description"),
    folder: text("folder"),
    order: int("order").notNull().default(0),
    syncId: varchar("sync_id", { length: 255 }).unique(),
    createdAt: varchar("created_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: varchar("updated_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    hostFilter: text("host_filter"),
    isNote: boolean("is_note").notNull().default(false),
  },
  (table) => [index("idx_snippets_user_id").on(table.userId)],
);

export const snippetFolders = mysqlTable("snippet_folders", {
  id: int("id").autoincrement().primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  color: text("color"),
  icon: text("icon"),
  syncId: varchar("sync_id", { length: 255 }).unique(),
  createdAt: varchar("created_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: varchar("updated_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export const c2sTunnelPresets = mysqlTable("c2s_tunnel_presets", {
  id: int("id").autoincrement().primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  config: text("config").notNull(),
  platform: text("platform"),
  computerName: text("computer_name"),
  createdAt: varchar("created_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: varchar("updated_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export const snippetAccess = mysqlTable(
  "snippet_access",
  {
    id: int("id").autoincrement().primaryKey(),
    snippetId: int("snippet_id")
      .notNull()
      .references(() => snippets.id, { onDelete: "cascade" }),

    userId: varchar("user_id", { length: 255 }).references(() => users.id, { onDelete: "cascade" }),
    roleId: int("role_id").references(() => roles.id, {
      onDelete: "cascade",
    }),

    grantedBy: varchar("granted_by", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    permissionLevel: text("permission_level").notNull().default("view"),

    expiresAt: varchar("expires_at", { length: 255 }),

    createdAt: varchar("created_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  // Same three lookup shapes as host_access: by grantee, by role, by snippet.
  (table) => [
    index("idx_snippet_access_user_id").on(table.userId),
    index("idx_snippet_access_snippet_id").on(table.snippetId),
    index("idx_snippet_access_role_id").on(table.roleId),
  ],
);

export const sshFolders = mysqlTable(
  "ssh_folders",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    color: text("color"),
    icon: text("icon"),
    credentialId: int("credential_id").references(() => sshCredentials.id, {
      onDelete: "set null",
    }),
    // Manual drag-to-reorder position among sibling folders. Null falls back
    // to name sort, same convention as hosts.sortOrder.
    sortOrder: int("sort_order"),
    syncId: varchar("sync_id", { length: 255 }).unique(),
    createdAt: varchar("created_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: varchar("updated_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [index("idx_ssh_folders_user_id").on(table.userId)],
);

export const recentActivity = mysqlTable(
  "recent_activity",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    hostId: int("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    hostName: text("host_name"),
    timestamp: varchar("timestamp", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  // Always read newest-first for one user, so timestamp follows user_id.
  (table) => [
    index("idx_recent_activity_user_ts").on(table.userId, table.timestamp),
  ],
);

export const commandHistory = mysqlTable(
  "command_history",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hostId: int("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    command: text("command").notNull(),
    executedAt: text("executed_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    index("idx_command_history_user_host").on(table.userId, table.hostId),
  ],
);

export const networkTopology = mysqlTable("network_topology", {
  id: int("id").autoincrement().primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  topology: text("topology"),
  createdAt: varchar("created_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: varchar("updated_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export const hostAccess = mysqlTable(
  "host_access",
  {
    id: int("id").autoincrement().primaryKey(),
    hostId: int("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),

    userId: varchar("user_id", { length: 255 })
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: int("role_id")
      .references(() => roles.id, { onDelete: "cascade" }),

    grantedBy: varchar("granted_by", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    permissionLevel: text("permission_level")
      .notNull()
      .default("connect"),

    expiresAt: varchar("expires_at", { length: 255 }),

    createdAt: varchar("created_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    lastAccessedAt: text("last_accessed_at"),
    accessCount: int("access_count").notNull().default(0),
  },
  // Resolved on every host list request and every permission check, so all
  // three lookup shapes (by grantee, by role, by host) need to be indexed.
  (table) => [
    index("idx_host_access_user_id").on(table.userId),
    index("idx_host_access_role_id").on(table.roleId),
    index("idx_host_access_host_id").on(table.hostId),
    index("idx_host_access_expires_at").on(table.expiresAt),
  ],
);

export const sharedHostAuthOverrides = mysqlTable(
  "shared_host_auth_overrides",
  {
    id: int("id").autoincrement().primaryKey(),
    hostId: int("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    protocol: varchar("protocol", { length: 255 }).notNull().default("ssh"),
    credentialId: int("credential_id")
      .notNull()
      .references(() => sshCredentials.id, { onDelete: "cascade" }),
    createdAt: varchar("created_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: varchar("updated_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex("shared_host_auth_overrides_host_user_protocol_unique").on(
      table.hostId,
      table.userId,
      table.protocol,
    ),
  ],
);

export const sharedHostSecrets = mysqlTable(
  "shared_host_secrets",
  {
    id: int("id").autoincrement().primaryKey(),

    hostAccessId: int("host_access_id")
      .notNull()
      .references(() => hostAccess.id, { onDelete: "cascade" }),

    targetUserId: varchar("target_user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    protocol: varchar("protocol", { length: 255 }).notNull().default("ssh"),
    sourceType: text("source_type").notNull().default("credential"),

    originalCredentialId: int("original_credential_id").references(
      () => sshCredentials.id,
      { onDelete: "cascade" },
    ),

    encryptedUsername: text("encrypted_username"),
    encryptedAuthType: text("encrypted_auth_type"),
    encryptedPassword: text("encrypted_password"),
    encryptedKey: text("encrypted_key"),
    encryptedKeyPassword: text("encrypted_key_password"),
    encryptedKeyType: text("encrypted_key_type"),
    encryptedDomain: text("encrypted_domain"),

    createdAt: varchar("created_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: varchar("updated_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  // Declared inline in the production DDL as UNIQUE(...), but never here,
  // so the generated Postgres and MySQL schemas allowed duplicates the
  // SQLite deployment forbids — and the upsert had nothing to conflict on.
  (table) => [
    uniqueIndex("idx_shared_host_secrets_scope").on(
      table.hostAccessId,
      table.targetUserId,
      table.protocol,
    ),
  ],
);

export const roles = mysqlTable("roles", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description"),

  isSystem: boolean("is_system")
    .notNull()
    .default(false),

  permissions: text("permissions"),

  createdAt: varchar("created_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: varchar("updated_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export const userRoles = mysqlTable(
  "user_roles",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: int("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
  
    grantedBy: varchar("granted_by", { length: 255 }).references(() => users.id, {
      onDelete: "set null",
    }),
    grantedAt: text("granted_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  // Declared inline in the production DDL as UNIQUE(...), but never here,
  // so the generated Postgres and MySQL schemas allowed duplicates the
  // SQLite deployment forbids — and the upsert had nothing to conflict on.
  //
  // The unique pair already serves lookups by user, since user_id leads it.
  // Listing a role's members starts from role_id, which it cannot serve.
  (table) => [
    uniqueIndex("idx_user_roles_user_role").on(table.userId, table.roleId),
    index("idx_user_roles_role_id").on(table.roleId),
  ],
);

export const auditLogs = mysqlTable(
  "audit_logs",
  {
    id: int("id").autoincrement().primaryKey(),

    // Nullable on purpose: the trail outlives the account, and username keeps the
    // entry attributable once the reference is gone.
    userId: varchar("user_id", { length: 255 }).references(() => users.id, { onDelete: "set null" }),
    username: text("username").notNull(),

    action: varchar("action", { length: 255 }).notNull(),
    resourceType: varchar("resource_type", { length: 255 }).notNull(),
    resourceId: text("resource_id"),
    resourceName: text("resource_name"),

    details: text("details"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),

    success: boolean("success").notNull(),
    errorMessage: text("error_message"),

    timestamp: varchar("timestamp", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  // This table only grows, and is always read newest-first with an optional
  // filter. Each composite leads with the filtered column so the same index
  // also satisfies the ORDER BY.
  (table) => [
    index("idx_audit_logs_timestamp").on(table.timestamp),
    index("idx_audit_logs_user_ts").on(table.userId, table.timestamp),
    index("idx_audit_logs_action_ts").on(table.action, table.timestamp),
    index("idx_audit_logs_resource_ts").on(table.resourceType, table.timestamp),
  ],
);

export const sessionRecordings = mysqlTable(
  "session_recordings",
  {
    id: int("id").autoincrement().primaryKey(),

    hostId: int("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    // Nullable on purpose: a recording is evidence about the host as much as the
    // person, so it outlives the account. username keeps it attributable.
    userId: varchar("user_id", { length: 255 }).references(() => users.id, { onDelete: "set null" }),
    username: text("username"),
    accessId: int("access_id").references(() => hostAccess.id, {
      onDelete: "set null",
    }),

    startedAt: varchar("started_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    endedAt: text("ended_at"),
    duration: int("duration"),

    commands: text("commands"),
    dangerousActions: text("dangerous_actions"),

    recordingPath: text("recording_path"),
    protocol: varchar("protocol", { length: 255 }).notNull().default("ssh"),
    format: text("format").notNull().default("text"),

    terminatedByOwner: boolean("terminated_by_owner").default(false),
    terminationReason: text("termination_reason"),
  },
  // Listed newest-first per user, and audited per host.
  (table) => [
    index("idx_session_recordings_user_started").on(
      table.userId,
      table.startedAt,
    ),
    index("idx_session_recordings_host").on(table.hostId),
  ],
);

export const sessionShares = mysqlTable(
  "session_shares",
  {
  id: varchar("id", { length: 255 }).primaryKey(),

  hostId: int("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  ownerUserId: varchar("owner_user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  protocol: varchar("protocol", { length: 255 }).notNull(),

  // Live-session binding: TerminalSessionManager's session.id for SSH, or
  // guacd's own guacamoleConnectionId for rdp/vnc/telnet. Neither is a DB
  // row (process-local, in-memory) so this intentionally has no FK.
  sessionId: varchar("session_id", { length: 255 }).notNull(),
  tabInstanceId: text("tab_instance_id"),

  shareType: text("share_type").notNull(), // "link" | "user"
  targetUserId: varchar("target_user_id", { length: 255 }).references(() => users.id, {
    onDelete: "cascade",
  }),
  linkToken: varchar("link_token", { length: 255 }).unique(),

  permissionLevel: text("permission_level").notNull().default("read-only"),

  createdAt: varchar("created_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  expiresAt: varchar("expires_at", { length: 255 }).notNull(),
  revokedAt: text("revoked_at"),

  lastJoinedAt: text("last_joined_at"),
  joinCount: int("join_count").notNull().default(0),
  },
  // Resolved from the live session on join, and listed per host.
  (table) => [
    index("idx_session_shares_session_id").on(table.sessionId),
    index("idx_session_shares_host_id").on(table.hostId),
  ],
);

export const sessionShareParticipants = mysqlTable(
  "session_share_participants",
  {
    id: int("id").autoincrement().primaryKey(),
    shareId: varchar("share_id", { length: 255 })
      .notNull()
      .references(() => sessionShares.id, { onDelete: "cascade" }),

    userId: varchar("user_id", { length: 255 }).references(() => users.id, {
      onDelete: "cascade",
    }),
    guestLabel: text("guest_label"),

    joinedAt: text("joined_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    leftAt: text("left_at"),
  },
);

export const opksshTokens = mysqlTable(
  "opkssh_tokens",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hostId: int("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
  
    sshCert: text("ssh_cert").notNull(),
    privateKey: text("private_key").notNull(),
  
    email: text("email"),
    sub: text("sub"),
    issuer: text("issuer"),
    audience: text("audience"),
  
    createdAt: varchar("created_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    expiresAt: varchar("expires_at", { length: 255 }).notNull(),
    lastUsed: text("last_used"),
  },
  // Declared inline in the production DDL as UNIQUE(...), but never here,
  // so the generated Postgres and MySQL schemas allowed duplicates the
  // SQLite deployment forbids — and the upsert had nothing to conflict on.
  (table) => [uniqueIndex("idx_opkssh_tokens_user_host").on(table.userId, table.hostId)],
);

// Vault SSH signer profiles. These hold ONLY non-secret connection settings and
// are intended to be shared across users (shared === true makes a profile
// visible to every user on the server). Each user authenticates to Vault via an
// interactive OIDC flow at connect time; no tokens or keys are stored here.
export const vaultProfiles = mysqlTable("vault_profiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  folder: text("folder"),
  tags: text("tags"),
  // Vault server connection (non-secret)
  vaultAddr: text("vault_addr").notNull(),
  vaultNamespace: text("vault_namespace"),
  // OIDC auth method mount + role used to obtain a Vault token interactively
  oidcMount: text("oidc_mount"),
  oidcRole: text("oidc_role"),
  // SSH secrets engine mount + signer role used to sign the ephemeral key
  sshMount: text("ssh_mount"),
  sshRole: text("ssh_role").notNull(),
  validPrincipals: text("valid_principals"),
  // Ephemeral keypair algorithm to generate per connection
  keyType: text("key_type"),
  // When true the profile is visible/usable by all users on the server
  shared: boolean("shared").notNull().default(false),
  syncId: varchar("sync_id", { length: 255 }).unique(),
  createdAt: varchar("created_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: varchar("updated_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

// Per-user cache of the ephemeral SSH private key + Vault-signed certificate.
// Transient: rows live only until the certificate expires. Secret fields are
// encrypted under the user's data-encryption key (see field-crypto.ts).
export const vaultTokens = mysqlTable(
  "vault_tokens",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    profileId: int("profile_id")
      .notNull()
      .references(() => vaultProfiles.id, { onDelete: "cascade" }),
  
    sshCert: text("ssh_cert").notNull(),
    privateKey: text("private_key").notNull(),
  
    createdAt: varchar("created_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    expiresAt: varchar("expires_at", { length: 255 }).notNull(),
    lastUsed: text("last_used"),
  },
  // Declared inline in the production DDL as UNIQUE(...), but never here,
  // so the generated Postgres and MySQL schemas allowed duplicates the
  // SQLite deployment forbids — and the upsert had nothing to conflict on.
  (table) => [uniqueIndex("idx_vault_tokens_user_profile").on(table.userId, table.profileId)],
);

export const apiKeys = mysqlTable(
  "api_keys",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    createdAt: varchar("created_at", { length: 255 }).notNull().default(sql`(CURRENT_TIMESTAMP)`),
    expiresAt: varchar("expires_at", { length: 255 }),
    lastUsedAt: text("last_used_at"),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [index("idx_api_keys_user_id").on(table.userId)],
);

export const userOpenTabs = mysqlTable(
  "user_open_tabs",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tabType: text("tab_type").notNull(),
    hostId: int("host_id").references(() => hosts.id, {
      onDelete: "cascade",
    }),
    label: varchar("label", { length: 255 }).notNull(),
    tabOrder: int("tab_order").notNull().default(0),
    backendSessionId: text("backend_session_id"),
    createdAt: varchar("created_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: varchar("updated_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [index("idx_user_open_tabs_user_id").on(table.userId)],
);

export const userPreferences = mysqlTable("user_preferences", {
  userId: varchar("user_id", { length: 255 })
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  reopenTabsOnLogin: boolean("reopen_tabs_on_login")
    .notNull()
    .default(false),
  theme: text("theme"),
  fontSize: text("font_size"),
  accentColor: text("accent_color"),
  language: text("language"),
  storageMode: text("storage_mode"),
  commandAutocomplete: boolean("command_autocomplete"),
  commandPaletteEnabled: boolean("command_palette_enabled"),
  showHostTags: boolean("show_host_tags"),
  hostTrayOnClick: boolean("host_tray_on_click"),
  pinAppRail: boolean("pin_app_rail"),
  expandAppRailOnHover: boolean("expand_app_rail_on_hover"),
  foldersCollapsed: boolean("folders_collapsed"),
  confirmSnippetExecution: boolean("confirm_snippet_execution"),
  disableUpdateCheck: boolean("disable_update_check"),
  confirmTabClose: boolean("confirm_tab_close"),
  hiddenRailTabs: text("hidden_rail_tabs"),
  // null means the user has not been asked yet; the assistant stays hidden
  // until this is explicitly true and the admin global is on.
  aiAssistantEnabled: boolean("ai_assistant_enabled"),
  // Opt-in to letting the assistant run allowlisted read-only diagnostics
  // without a per-command approval click.
  aiReadOnlyCommands: boolean("ai_read_only_commands"),
  compactHostView: boolean("compact_host_view"),
  statusColorScheme: text("status_color_scheme"),
  customThemes: text("custom_themes"),
  customKeybindings: text("custom_keybindings"),
  terminalDefaults: text("terminal_defaults"),
  rdpDefaults: text("rdp_defaults"),
  terminalMacros: text("terminal_macros"),
  updatedAt: varchar("updated_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export const hostMetricsPreferences = mysqlTable(
  "host_metrics_preferences",
  {
  id: int("id").autoincrement().primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  hostId: int("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  // JSON-encoded HostMetricsLayout. Layout has no secrets, so it is stored as
  // plain JSON (no field-level encryption).
  layout: text("layout").notNull(),
  createdAt: varchar("created_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: varchar("updated_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  },
  // One layout per user per host. Enforced in production since the inline DDL
  // creates it, but it was never declared here, so the generated Postgres and
  // MySQL schemas lacked it — and the upsert has nothing to conflict on.
  (table) => [
    uniqueIndex("idx_host_metrics_prefs_user_host").on(table.userId, table.hostId),
  ],
);

export const proxmoxStatsPreferences = mysqlTable(
  "proxmox_stats_preferences",
  {
  id: int("id").autoincrement().primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  hostId: int("host_id").notNull().references(() => hosts.id, { onDelete: "cascade" }),
  // JSON-encoded ProxmoxStatsLayout. Layout has no secrets, so it is stored as
  // plain JSON (no field-level encryption), same convention as hostMetricsPreferences.layout.
  layout: text("layout").notNull(),
  createdAt: varchar("created_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: varchar("updated_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex("idx_proxmox_stats_prefs_user_host").on(table.userId, table.hostId),
  ],
);

export const hostSidebarPreferences = mysqlTable("host_sidebar_preferences", {
  userId: varchar("user_id", { length: 255 })
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  // JSON-encoded HostSidebarPreferences. No secrets in this blob, stored as
  // plain JSON like hostMetricsPreferences.layout.
  data: text("data").notNull(),
  updatedAt: varchar("updated_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export const credentialSidebarPreferences = mysqlTable(
  "credential_sidebar_preferences",
  {
    userId: varchar("user_id", { length: 255 })
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    // JSON-encoded CredentialSidebarPreferences. No secrets in this blob,
    // same convention as hostSidebarPreferences.data.
    data: text("data").notNull(),
    updatedAt: varchar("updated_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
);

export const uiPreferences = mysqlTable("ui_preferences", {
  userId: varchar("user_id", { length: 255 })
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  // JSON-encoded UiPreferences (preset + per-area overrides + onboarding
  // state). No secrets in this blob, same convention as
  // hostSidebarPreferences.data.
  data: text("data").notNull(),
  updatedAt: varchar("updated_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export const hostHealthChecks = mysqlTable(
  "host_health_checks",
  {
  id: int("id").autoincrement().primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  hostId: int("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  // JSON array of { id, name, type: "tcp"|"http", target, port, path }
  checks: text("checks").notNull(),
  intervalSeconds: int("interval_seconds").notNull().default(300),
  createdAt: varchar("created_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: varchar("updated_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  },
  // Same as above: one set of checks per user per host.
  (table) => [
    uniqueIndex("idx_host_health_checks_user_host").on(table.userId, table.hostId),
  ],
);

export const hostHealthHistory = mysqlTable("host_health_history", {
  id: int("id").autoincrement().primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  hostId: int("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  checkId: text("check_id").notNull(),
  ts: text("ts").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  ok: boolean("ok").notNull(),
  latencyMs: int("latency_ms"),
  detail: text("detail"),
});

export const dashboardServiceLinks = mysqlTable("dashboard_service_links", {
  id: int("id").autoincrement().primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  label: varchar("label", { length: 255 }).notNull(),
  url: text("url").notNull(),
  order: int("order").notNull().default(0),
  syncId: varchar("sync_id", { length: 255 }).unique(),
  createdAt: varchar("created_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: varchar("updated_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

// --- termix-id begin ---
// A user claims a unique public handle. Their published SSH public keys are
// served at an unauthenticated resolver endpoint in authorized_keys format,
// so any server can be provisioned with `curl <host>/termix-id/u/<handle> >> ~/.ssh/authorized_keys`.
export const termixIdentities = mysqlTable("termix_identities", {
  id: int("id").autoincrement().primaryKey(),
  // One Termix ID per user — enforced in schema, not just in code.
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  handle: varchar("handle", { length: 255 }).notNull().unique(),
  description: text("description"),
  createdAt: varchar("created_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: varchar("updated_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export const termixIdentityKeys = mysqlTable("termix_identity_keys", {
  id: int("id").autoincrement().primaryKey(),
  identityId: int("identity_id")
    .notNull()
    .references(() => termixIdentities.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Public keys are non-secret, so they are stored in plaintext (no field-level
  // encryption). This is what lets the unauthenticated resolver serve them.
  publicKey: text("public_key").notNull(),
  // Raw algorithm token (e.g. "ssh-ed25519"), and a normalized group used for
  // the /<ALGO> resolver filter (RSA / ED25519 / ECDSA / ...).
  keyType: text("key_type").notNull(),
  algorithm: text("algorithm").notNull(),
  label: varchar("label", { length: 255 }),
  comment: text("comment"),
  // "manual" (pasted) or "credential" (imported from an ssh_credentials entry).
  source: text("source").notNull().default("manual"),
  credentialId: int("credential_id").references(() => sshCredentials.id, {
    onDelete: "set null",
  }),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: varchar("created_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});
// Per-identity certificate authority. Servers that trust this CA (via
// TrustedUserCAKeys / @cert-authority) accept any user certificate it signs,
// giving central revocation (rotate the CA) and expiry (cert validity).
export const termixIdentityCa = mysqlTable("termix_identity_ca", {
  id: int("id").autoincrement().primaryKey(),
  identityId: int("identity_id")
    .notNull()
    .unique()
    .references(() => termixIdentities.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // CA public key (plaintext — it is published); CA private key is field-encrypted.
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  validityDays: int("validity_days").notNull().default(90),
  createdAt: varchar("created_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: varchar("updated_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});
// --- termix-id end ---

// --- tmux-monitor begin ---
export const tmuxSessionTags = mysqlTable("tmux_session_tags", {
  id: int("id").autoincrement().primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  hostId: int("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  sessionName: text("session_name").notNull(),
  tag: text("tag").notNull(),
  createdAt: varchar("created_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});
// --- tmux-monitor end ---

// --- metrics-history begin ---
export const hostMetricsHistory = mysqlTable("host_metrics_history", {
  id: int("id").autoincrement().primaryKey(),
  hostId: int("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  ts: text("ts")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  cpuPercent: double("cpu_percent"),
  memPercent: double("mem_percent"),
  diskPercent: double("disk_percent"),
  netRxBytes: int("net_rx_bytes"),
  netTxBytes: int("net_tx_bytes"),
});
// --- metrics-history end ---

// --- proxmox-node-history begin ---
export const proxmoxNodeHistory = mysqlTable("proxmox_node_history", {
  id: int("id").autoincrement().primaryKey(),
  hostId: int("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  ts: text("ts")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  cpuPercent: double("cpu_percent"),
  memPercent: double("mem_percent"),
  diskPercent: double("disk_percent"),
  netRxBytes: int("net_rx_bytes"),
  netTxBytes: int("net_tx_bytes"),
});
// --- proxmox-node-history end ---

// --- alerts begin ---
export const alertRules = mysqlTable("alert_rules", {
  id: int("id").autoincrement().primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  hostId: int("host_id").references(() => hosts.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  triggerType: text("trigger_type").notNull(),
  thresholdValue: double("threshold_value"),
  thresholdDurationSeconds: int("threshold_duration_seconds"),
  cooldownMinutes: int("cooldown_minutes").notNull().default(15),
  createdAt: varchar("created_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: varchar("updated_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export const notificationChannels = mysqlTable("notification_channels", {
  id: int("id").autoincrement().primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  type: text("type").notNull(),
  config: text("config").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: varchar("created_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export const alertRuleChannels = mysqlTable("alert_rule_channels", {
  id: int("id").autoincrement().primaryKey(),
  ruleId: int("rule_id")
    .notNull()
    .references(() => alertRules.id, { onDelete: "cascade" }),
  channelId: int("channel_id")
    .notNull()
    .references(() => notificationChannels.id, { onDelete: "cascade" }),
});

export const alertFirings = mysqlTable(
  "alert_firings",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ruleId: int("rule_id")
      .notNull()
      .references(() => alertRules.id, { onDelete: "cascade" }),
    hostId: int("host_id").notNull(),
    hostName: text("host_name").notNull(),
    firedAt: varchar("fired_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    resolvedAt: text("resolved_at"),
    value: double("value"),
    message: text("message").notNull(),
    severity: text("severity").notNull().default("warning"),
    acknowledged: boolean("acknowledged")
      .notNull()
      .default(false),
  },
  // A rule's history is read newest-first; host_id is filtered on its own.
  (table) => [
    index("idx_alert_firings_rule").on(table.ruleId, table.firedAt),
    index("idx_alert_firings_host").on(table.hostId),
  ],
);
// --- alerts end ---

// --- automations begin ---
export const automations = mysqlTable(
  "automations",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    enabled: boolean("enabled").notNull().default(true),
    // The whole trigger + steps graph, shaped by AutomationDefinition. Read and
    // written as a unit, never queried by its inner structure.
    definition: text("definition").notNull(),
    definitionVersion: int("definition_version").notNull().default(1),
    concurrencyPolicy: text("concurrency_policy").notNull().default("skip"),
    maxRunSeconds: int("max_run_seconds").notNull().default(300),
    dryRun: boolean("dry_run").notNull().default(false),
    lastRunAt: text("last_run_at"),
    lastRunStatus: text("last_run_status"),
    createdAt: varchar("created_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: varchar("updated_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  // The scheduler sweeps enabled automations for one user at a time.
  (table) => [index("idx_automations_user").on(table.userId, table.enabled)],
);

/**
 * Durable per-target trigger state. state_key scopes a trigger to what it is
 * actually watching ("<hostId>", "<hostId>:/data", "<hostId>:<container>"), so
 * a sustained-breach window can track one filesystem rather than a whole host.
 * Living in the database rather than memory means cooldowns and dwell windows
 * survive a restart.
 */
export const automationTriggerState = mysqlTable(
  "automation_trigger_state",
  {
    id: int("id").autoincrement().primaryKey(),
    automationId: int("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    stateKey: varchar("state_key", { length: 255 }).notNull(),
    breachStartedAt: text("breach_started_at"),
    lastFiredAt: text("last_fired_at"),
    lastValue: double("last_value"),
    lastObservedState: text("last_observed_state"),
    updatedAt: varchar("updated_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex("idx_automation_trigger_state_key").on(
      table.automationId,
      table.stateKey,
    ),
  ],
);

export const automationSchedules = mysqlTable(
  "automation_schedules",
  {
    id: int("id").autoincrement().primaryKey(),
    automationId: int("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    cron: text("cron"),
    intervalSeconds: int("interval_seconds"),
    timezone: text("timezone"),
    nextDueAt: varchar("next_due_at", { length: 255 }),
    lastTickAt: text("last_tick_at"),
  },
  (table) => [
    uniqueIndex("idx_automation_schedules_automation").on(table.automationId),
    index("idx_automation_schedules_due").on(table.nextDueAt),
  ],
);

export const automationRuns = mysqlTable(
  "automation_runs",
  {
    id: int("id").autoincrement().primaryKey(),
    automationId: int("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    triggerType: text("trigger_type").notNull(),
    triggerContext: text("trigger_context"),
    status: varchar("status", { length: 255 }).notNull(),
    startedAt: varchar("started_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    finishedAt: text("finished_at"),
    durationMs: int("duration_ms"),
    error: text("error"),
    dryRun: boolean("dry_run").notNull().default(false),
    // Set when one automation invoked another, so a chain can be traced.
    parentRunId: int("parent_run_id"),
  },
  (table) => [
    index("idx_automation_runs_automation").on(
      table.automationId,
      table.startedAt,
    ),
    index("idx_automation_runs_user").on(table.userId, table.startedAt),
  ],
);

export const automationRunSteps = mysqlTable(
  "automation_run_steps",
  {
    id: int("id").autoincrement().primaryKey(),
    runId: int("run_id")
      .notNull()
      .references(() => automationRuns.id, { onDelete: "cascade" }),
    stepIndex: int("step_index").notNull(),
    stepId: text("step_id").notNull(),
    stepType: text("step_type").notNull(),
    status: varchar("status", { length: 255 }).notNull(),
    startedAt: varchar("started_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    finishedAt: text("finished_at"),
    output: text("output"),
    error: text("error"),
    truncated: boolean("truncated")
      .notNull()
      .default(false),
  },
  (table) => [
    index("idx_automation_run_steps_run").on(table.runId, table.stepIndex),
  ],
);

export const automationChannels = mysqlTable(
  "automation_channels",
  {
    id: int("id").autoincrement().primaryKey(),
    automationId: int("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    channelId: int("channel_id")
      .notNull()
      .references(() => notificationChannels.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("idx_automation_channels_pair").on(
      table.automationId,
      table.channelId,
    ),
  ],
);
// --- automations end ---

// --- homepage begin ---
export const homepageItems = mysqlTable(
  "homepage_items",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    typeId: text("type_id").notNull(),
    title: text("title"),
    config: text("config").notNull().default("{}"),
    folderId: int("folder_id"),
    syncId: varchar("sync_id", { length: 255 }).unique(),
    createdAt: varchar("created_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: varchar("updated_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [index("idx_homepage_items_user_id").on(table.userId)],
);

export const homepageLayouts = mysqlTable("homepage_layouts", {
  id: int("id").autoincrement().primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  // JSON: { entries: HomepageLayoutEntry[], pan: {x,y}, zoom: number }
  layout: text("layout").notNull().default("{}"),
  updatedAt: varchar("updated_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});
// --- homepage end ---

// --- fleets begin ---
export const fleets = mysqlTable("fleets", {
  id: int("id").autoincrement().primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  color: text("color"),
  icon: text("icon"),
  // JSON array of { tag: string } rules, unioned with static fleetMembers at
  // resolution time. Kept to tag-equality matching for v1.
  tagRules: text("tag_rules"),
  syncId: varchar("sync_id", { length: 255 }).unique(),
  createdAt: varchar("created_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: varchar("updated_at", { length: 255 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export const fleetMembers = mysqlTable(
  "fleet_members",
  {
    id: int("id").autoincrement().primaryKey(),
    fleetId: int("fleet_id")
      .notNull()
      .references(() => fleets.id, { onDelete: "cascade" }),
    hostId: int("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    addedAt: text("added_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  // fleet_id leads the unique pair, so listing a fleet's hosts is already
  // served. Finding the fleets a host belongs to starts from host_id.
  (table) => [
    uniqueIndex("idx_fleet_members_fleet_host").on(table.fleetId, table.hostId),
    index("idx_fleet_members_host").on(table.hostId),
  ],
);

// Latest-only inventory snapshot per host, overwritten on each refresh - no
// historical log, matching the "latest snapshot only" scope decision.
export const fleetInventory = mysqlTable(
  "fleet_inventory",
  {
    id: int("id").autoincrement().primaryKey(),
    hostId: int("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    osPrettyName: text("os_pretty_name"),
    kernel: text("kernel"),
    architecture: text("architecture"),
    hostname: text("hostname"),
    uptimeSeconds: int("uptime_seconds"),
    ip: text("ip"),
    packageManager: text("package_manager"),
    collectedAt: text("collected_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  // host_id leads the unique pair; a user's whole inventory is read by user_id.
  (table) => [
    uniqueIndex("idx_fleet_inventory_host").on(table.hostId, table.userId),
    index("idx_fleet_inventory_user").on(table.userId),
  ],
);
// --- fleets end ---

// --- workspaces begin ---
export const userWorkspaces = mysqlTable(
  "user_workspaces",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    color: text("color"),
    icon: text("icon"),
    // "manual" | "last_session" - exactly one last_session row per user.
    kind: text("kind").notNull().default("manual"),
    isDefault: boolean("is_default")
      .notNull()
      .default(false),
    // JSON-encoded WorkspacePayload: tabs, splitMode, paneTabIds, rowSizes, rowColSizes
    payload: text("payload").notNull().default("{}"),
    syncId: varchar("sync_id", { length: 255 }).unique(),
    createdAt: varchar("created_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: varchar("updated_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    lastUsedAt: text("last_used_at"),
  },
  (table) => [index("idx_user_workspaces_user_id").on(table.userId)],
);
// --- workspaces end ---

// --- sync begin ---
// Records a delete for a synced entity type so the other side of a sync
// pair (embedded desktop backend <-> connected remote server) learns about
// the deletion instead of re-creating the row on its next pull.
export const syncTombstones = mysqlTable("sync_tombstones", {
  id: int("id").autoincrement().primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  syncId: varchar("sync_id", { length: 255 }).notNull(),
  deletedAt: text("deleted_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});
// --- sync end ---

// --- ai begin ---
/**
 * A user's connection to one AI provider. api_key is encrypted at rest via
 * FieldCrypto; it is never returned to the frontend, which only ever sees
 * api_key_prefix for display.
 */
export const aiProviders = mysqlTable(
  "ai_providers",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // ollama | anthropic | openai | gemini | openai_compatible
    providerType: text("provider_type").notNull(),
    label: varchar("label", { length: 255 }).notNull(),
    // Required for ollama and openai_compatible, optional elsewhere.
    baseUrl: text("base_url"),
    apiKey: text("api_key"),
    // First few characters, kept in the clear so the UI can identify a key.
    apiKeyPrefix: text("api_key_prefix"),
    defaultModel: text("default_model"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: varchar("created_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: varchar("updated_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex("idx_ai_providers_user_label").on(table.userId, table.label),
  ],
);

export const aiConversations = mysqlTable(
  "ai_conversations",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title"),
    providerId: int("provider_id"),
    model: text("model"),
    createdAt: varchar("created_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: varchar("updated_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    index("idx_ai_conversations_user").on(table.userId, table.updatedAt),
  ],
);

export const aiMessages = mysqlTable(
  "ai_messages",
  {
    id: int("id").autoincrement().primaryKey(),
    conversationId: int("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    // user | assistant | tool
    role: text("role").notNull(),
    content: text("content").notNull().default(""),
    // Serialized tool calls and their results for this turn.
    toolCalls: text("tool_calls"),
    createdAt: varchar("created_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    index("idx_ai_messages_conversation").on(
      table.conversationId,
      table.createdAt,
    ),
  ],
);

/**
 * A change the assistant wants to make. Nothing here has been applied: the
 * payload is re-validated against the tool schema at apply time and only then
 * dispatched through the same repository logic a human action uses.
 */
export const aiProposals = mysqlTable(
  "ai_proposals",
  {
    id: int("id").autoincrement().primaryKey(),
    conversationId: int("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The propose_* tool name that produced this.
    kind: text("kind").notNull(),
    summary: text("summary"),
    payload: text("payload").notNull().default("{}"),
    // pending | applied | rejected | expired
    status: varchar("status", { length: 255 }).notNull().default("pending"),
    appliedAt: text("applied_at"),
    resultSummary: text("result_summary"),
    createdAt: varchar("created_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    index("idx_ai_proposals_user").on(table.userId, table.status),
    index("idx_ai_proposals_conversation").on(table.conversationId),
  ],
);
// --- ai end ---

// --- collab rooms ---

/**
 * A collaboration room: a group of users watching one "stage" - the live
 * session the current presenter is showing. The stage points at a
 * shareType="room" row in session_shares, so transport, gating, recording and
 * expiry all reuse the session-sharing machinery.
 */
export const collabRooms = mysqlTable(
  "collab_rooms",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    ownerUserId: varchar("owner_user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // Persistent rooms survive being emptied and can be re-used; one-off
    // rooms are ended explicitly and never listed again.
    persistent: boolean("persistent")
      .notNull()
      .default(false),

    presenterUserId: varchar("presenter_user_id", { length: 255 }).references(() => users.id, {
      onDelete: "set null",
    }),
    stageProtocol: text("stage_protocol"),
    stageHostId: int("stage_host_id").references(() => hosts.id, {
      onDelete: "set null",
    }),
    stageShareId: varchar("stage_share_id", { length: 255 }).references(() => sessionShares.id, {
      onDelete: "set null",
    }),

    // Set = anonymous guests may watch the stage through this token.
    guestLinkToken: varchar("guest_link_token", { length: 255 }),

    createdAt: varchar("created_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    endedAt: text("ended_at"),
  },
  (table) => [
    index("idx_collab_rooms_owner").on(table.ownerUserId),
    uniqueIndex("idx_collab_rooms_guest_token").on(table.guestLinkToken),
  ],
);

export const collabRoomMembers = mysqlTable(
  "collab_room_members",
  {
    id: int("id").autoincrement().primaryKey(),
    roomId: varchar("room_id", { length: 255 })
      .notNull()
      .references(() => collabRooms.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // "host" runs the room: invites, force-switches the presenter, ends it.
    roomRole: text("room_role").notNull().default("member"),
    addedBy: varchar("added_by", { length: 255 }).references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: varchar("created_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex("idx_collab_room_members_room_user").on(
      table.roomId,
      table.userId,
    ),
    index("idx_collab_room_members_user").on(table.userId),
  ],
);

// --- secret sources ---

/**
 * An external password manager Termix pulls secrets from at connect time,
 * instead of storing them. Only the access token is secret; it is encrypted
 * with the owner's data key under the row id. Hosts and credentials refer to
 * entries by reference ("op://vault/item/field") in their secret fields.
 */
export const secretSources = mysqlTable(
  "secret_sources",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    // "onepassword-connect" for now; the reference syntax is per kind.
    kind: text("kind").notNull().default("onepassword-connect"),
    baseUrl: text("base_url").notNull(),
    token: text("token").notNull(),
    // Visible to every user; secrets still decrypt with the owner's key.
    shared: boolean("shared").notNull().default(false),
    createdAt: varchar("created_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: varchar("updated_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [index("idx_secret_sources_user").on(table.userId)],
);

// --- credential sharing ---

/**
 * Who may use or manage someone else's credential. Same shape as
 * snippet_access; "use" attaches it to hosts and connects, "manage" also
 * edits and re-shares it.
 */
export const credentialAccess = mysqlTable(
  "credential_access",
  {
    id: int("id").autoincrement().primaryKey(),
    credentialId: int("credential_id")
      .notNull()
      .references(() => sshCredentials.id, { onDelete: "cascade" }),

    userId: varchar("user_id", { length: 255 }).references(() => users.id, { onDelete: "cascade" }),
    roleId: int("role_id").references(() => roles.id, {
      onDelete: "cascade",
    }),

    grantedBy: varchar("granted_by", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    permissionLevel: text("permission_level").notNull().default("use"),

    expiresAt: varchar("expires_at", { length: 255 }),

    createdAt: varchar("created_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    index("idx_credential_access_user_id").on(table.userId),
    index("idx_credential_access_role_id").on(table.roleId),
    index("idx_credential_access_credential_id").on(table.credentialId),
  ],
);

/**
 * A recipient's copy of a shared credential's secrets, re-encrypted under
 * the recipient's data key (the owner's key cannot be used by anyone else).
 * Rebuilt whenever the owner edits the credential; one row per grant and
 * recipient, like shared_host_secrets.
 */
export const sharedCredentialSecrets = mysqlTable(
  "shared_credential_secrets",
  {
    id: int("id").autoincrement().primaryKey(),
    credentialAccessId: int("credential_access_id")
      .notNull()
      .references(() => credentialAccess.id, { onDelete: "cascade" }),
    targetUserId: varchar("target_user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialId: int("credential_id")
      .notNull()
      .references(() => sshCredentials.id, { onDelete: "cascade" }),

    encryptedUsername: text("encrypted_username"),
    authType: text("auth_type").notNull().default("password"),
    encryptedPassword: text("encrypted_password"),
    encryptedKey: text("encrypted_key"),
    encryptedKeyPassword: text("encrypted_key_password"),
    keyType: text("key_type"),
    publicKey: text("public_key"),
    certPublicKey: text("cert_public_key"),

    createdAt: varchar("created_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: varchar("updated_at", { length: 255 })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex("idx_shared_credential_secrets_scope").on(
      table.credentialAccessId,
      table.targetUserId,
    ),
    index("idx_shared_credential_secrets_target").on(
      table.targetUserId,
      table.credentialId,
    ),
  ],
);
