import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),

  isOidc: integer("is_oidc", { mode: "boolean" }).notNull().default(false),
  oidcIdentifier: text("oidc_identifier"),
  ssoProviderId: integer("sso_provider_id"),
  clientId: text("client_id"),
  clientSecret: text("client_secret"),
  issuerUrl: text("issuer_url"),
  authorizationUrl: text("authorization_url"),
  tokenUrl: text("token_url"),
  identifierPath: text("identifier_path"),
  namePath: text("name_path"),
  scopes: text().default("openid email profile"),

  totpSecret: text("totp_secret"),
  totpEnabled: integer("totp_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  totpBackupCodes: text("totp_backup_codes"),

  registeredAt: text("registered_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  donationModalDismissed: integer("donation_modal_dismissed", {
    mode: "boolean",
  })
    .notNull()
    .default(false),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const ssoProviders = sqliteTable("sso_providers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  config: text("config").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jwtToken: text("jwt_token").notNull(),
    deviceType: text("device_type").notNull(),
    deviceInfo: text("device_info").notNull(),
    oidcSub: text("oidc_sub"),
    oidcSid: text("oidc_sid"),
    ssoProviderId: integer("sso_provider_id"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    expiresAt: text("expires_at").notNull(),
    lastActiveAt: text("last_active_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  // Listing a user's devices, and the startup sweep of expired rows.
  (table) => [
    index("idx_sessions_user_id").on(table.userId),
    index("idx_sessions_expires_at").on(table.expiresAt),
  ],
);

export const trustedDevices = sqliteTable(
  "trusted_devices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceFingerprint: text("device_fingerprint").notNull(),
    deviceType: text("device_type").notNull(),
    deviceInfo: text("device_info").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    expiresAt: text("expires_at").notNull(),
    lastUsedAt: text("last_used_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_trusted_devices_user_id").on(table.userId)],
);

export const webauthnCredentials = sqliteTable("webauthn_credentials", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  credentialId: text("credential_id").notNull(),
  publicKey: text("public_key").notNull(),
  counter: integer("counter").notNull().default(0),
  deviceType: text("device_type"),
  backedUp: integer("backed_up", { mode: "boolean" }).notNull().default(false),
  transports: text("transports"),
  userVerification: text("user_verification").notNull().default("preferred"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  lastUsedAt: text("last_used_at"),
});

export const hosts = sqliteTable(
  "ssh_data",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectionType: text("connection_type").notNull().default("ssh"),
    name: text("name"),
    ip: text("ip").notNull(),
    port: integer("port").notNull(),
    username: text("username").notNull(),
    folder: text("folder"),
    // Sub-host nesting: a host acting as an organizational parent for other
    // hosts, mutually exclusive with folder (see host route validation).
    parentHostId: integer("parent_host_id").references(
      (): AnySQLiteColumn => hosts.id,
      { onDelete: "set null" },
    ),
    tags: text("tags"),
    pin: integer("pin", { mode: "boolean" }).notNull().default(false),
    // Manual drag-to-reorder position within a folder. Null means the host has
    // never been manually reordered; falls back to name sort in that case.
    sortOrder: integer("sort_order"),
    authType: text("auth_type").notNull(),
    useWarpgate: integer("use_warpgate", { mode: "boolean" }).notNull().default(false),
    shareSshAuth: integer("share_ssh_auth", { mode: "boolean" })
      .notNull()
      .default(false),
    forceKeyboardInteractive: text("force_keyboard_interactive"),

    password: text("password"),
    key: text("key", { length: 8192 }),
    keyPassword: text("key_password"),
    keyType: text("key_type"),
    sudoPassword: text("sudo_password"),

    autostartPassword: text("autostart_password"),
    autostartKey: text("autostart_key", { length: 8192 }),
    autostartKeyPassword: text("autostart_key_password"),

    credentialId: integer("credential_id").references(() => sshCredentials.id, { onDelete: "set null" }),
    overrideCredentialUsername: integer("override_credential_username", {
      mode: "boolean",
    }),
    // When authType is "vault", the host authenticates via a Vault SSH signer
    // profile (shared settings, no secrets). The signing certificate is obtained
    // per-user at connect time via an interactive Vault OIDC flow.
    vaultProfileId: integer("vault_profile_id").references(
      () => vaultProfiles.id,
      { onDelete: "set null" },
    ),
    enableTerminal: integer("enable_terminal", { mode: "boolean" })
      .notNull()
      .default(true),
    enableSessionLogging: integer("enable_session_logging", { mode: "boolean" })
      .notNull()
      .default(true),
    allowSessionSharing: integer("allow_session_sharing", { mode: "boolean" })
      .notNull()
      .default(true),
    enableCommandHistory: integer("enable_command_history", { mode: "boolean" })
      .notNull()
      .default(true),
    enableTunnel: integer("enable_tunnel", { mode: "boolean" })
      .notNull()
      .default(true),
    tunnelConnections: text("tunnel_connections"),
    jumpHosts: text("jump_hosts"),
    enableFileManager: integer("enable_file_manager", { mode: "boolean" })
      .notNull()
      .default(true),
    scpLegacy: integer("scp_legacy", { mode: "boolean" }).notNull().default(false),
    enableDocker: integer("enable_docker", { mode: "boolean" })
      .notNull()
      .default(false),
    enableTmuxMonitor: integer("enable_tmux_monitor", { mode: "boolean" })
      .notNull()
      .default(false),
    enableTerminalToolbar: integer("enable_terminal_toolbar", { mode: "boolean" })
      .notNull()
      .default(true),
    showTerminalInSidebar: integer("show_terminal_in_sidebar", { mode: "boolean" })
      .notNull()
      .default(true),
    showFileManagerInSidebar: integer("show_file_manager_in_sidebar", { mode: "boolean" })
      .notNull()
      .default(false),
    showTunnelInSidebar: integer("show_tunnel_in_sidebar", { mode: "boolean" })
      .notNull()
      .default(false),
    showDockerInSidebar: integer("show_docker_in_sidebar", { mode: "boolean" })
      .notNull()
      .default(false),
    showServerStatsInSidebar: integer("show_server_stats_in_sidebar", { mode: "boolean" })
      .notNull()
      .default(false),
    defaultPath: text("default_path"),
    statsConfig: text("stats_config"),
    dockerConfig: text("docker_config"),
    enableProxmox: integer("enable_proxmox", { mode: "boolean" })
      .notNull()
      .default(false),
    proxmoxConfig: text("proxmox_config"),
    enableProxmoxStats: integer("enable_proxmox_stats", { mode: "boolean" })
      .notNull()
      .default(false),
    proxmoxStatsConfig: text("proxmox_stats_config"),
    terminalConfig: text("terminal_config"),
    quickActions: text("quick_actions"),
    notes: text("notes"),
    enableSsh: integer("enable_ssh", { mode: "boolean" }).notNull().default(true),
    enableRdp: integer("enable_rdp", { mode: "boolean" }).notNull().default(false),
    enableVnc: integer("enable_vnc", { mode: "boolean" }).notNull().default(false),
    enableTelnet: integer("enable_telnet", { mode: "boolean" }).notNull().default(false),

    sshPort: integer("ssh_port").default(22),
    rdpPort: integer("rdp_port").default(3389),
    vncPort: integer("vnc_port").default(5900),
    telnetPort: integer("telnet_port").default(23),

    rdpCredentialId: integer("rdp_credential_id").references(() => sshCredentials.id, { onDelete: "set null" }),
    rdpUser: text("rdp_user"),
    rdpPassword: text("rdp_password"),
    rdpDomain: text("rdp_domain"),
    rdpSecurity: text("rdp_security"),
    rdpIgnoreCert: integer("rdp_ignore_cert", { mode: "boolean" }).default(false),

    vncCredentialId: integer("vnc_credential_id").references(() => sshCredentials.id, { onDelete: "set null" }),
    vncPassword: text("vnc_password"),
    vncUser: text("vnc_user"),

    telnetUser: text("telnet_user"),
    telnetPassword: text("telnet_password"),
    telnetCredentialId: integer("telnet_credential_id").references(() => sshCredentials.id, { onDelete: "set null" }),

    rdpAuthType: text("rdp_auth_type"),
    vncAuthType: text("vnc_auth_type"),
    telnetAuthType: text("telnet_auth_type"),

    domain: text("domain"),
    security: text("security"),
    ignoreCert: integer("ignore_cert", { mode: "boolean" }).default(false),
    guacamoleConfig: text("guacamole_config"),

    useSocks5: integer("use_socks5", { mode: "boolean" }),
    socks5Host: text("socks5_host"),
    socks5Port: integer("socks5_port"),
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
    hostKeyChangedCount: integer("host_key_changed_count").default(0),

    // Stable identity used to match this row across two independently-seeded
    // databases (the embedded backend and a connected remote server) during
    // sync -- local autoincrement ids collide across instances.
    syncId: text("sync_id").unique(),

    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
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

export const fileManagerRecent = sqliteTable(
  "file_manager_recent",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hostId: integer("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    path: text("path").notNull(),
    lastOpened: text("last_opened")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  // Every file manager surface is read for one user on one host at a time.
  (table) => [
    index("idx_file_manager_recent_user").on(table.userId, table.hostId),
  ],
);

export const fileManagerPinned = sqliteTable(
  "file_manager_pinned",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hostId: integer("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    path: text("path").notNull(),
    pinnedAt: text("pinned_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_file_manager_pinned_user").on(table.userId, table.hostId),
  ],
);

export const fileManagerShortcuts = sqliteTable(
  "file_manager_shortcuts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hostId: integer("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    path: text("path").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_file_manager_shortcuts_user").on(table.userId, table.hostId),
  ],
);

export const transferRecent = sqliteTable(
  "transfer_recent",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceHostId: integer("source_host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    destHostId: integer("dest_host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    destPath: text("dest_path").notNull(),
    destPathLabel: text("dest_path_label").notNull(),
    lastUsed: text("last_used")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_transfer_recent_user").on(table.userId)],
);

export const dismissedAlerts = sqliteTable(
  "dismissed_alerts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    alertId: text("alert_id").notNull(),
    dismissedAt: text("dismissed_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_dismissed_alerts_user_id").on(table.userId)],
);

export const sshCredentials = sqliteTable(
  "ssh_credentials",
  {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  folder: text("folder"),
  tags: text("tags"),
  pin: integer("pin", { mode: "boolean" }).notNull().default(false),
  // Manual drag-to-reorder position within a folder. Null means the
  // credential has never been manually reordered; falls back to name sort
  // in that case, same convention as hosts.sortOrder.
  sortOrder: integer("sort_order"),
  authType: text("auth_type").notNull(),
  username: text("username"),
  password: text("password"),
  key: text("key", { length: 16384 }),
  privateKey: text("private_key", { length: 16384 }),
  publicKey: text("public_key", { length: 4096 }),
  keyPassword: text("key_password"),
  keyType: text("key_type"),
  detectedKeyType: text("detected_key_type"),

  certPublicKey: text("cert_public_key", { length: 8192 }),


  usageCount: integer("usage_count").notNull().default(0),
  lastUsed: text("last_used"),
  syncId: text("sync_id").unique(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_ssh_credentials_user_id").on(table.userId)],
);

export const sshCredentialUsage = sqliteTable(
  "ssh_credential_usage",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    credentialId: integer("credential_id")
      .notNull()
      .references(() => sshCredentials.id, { onDelete: "cascade" }),
    hostId: integer("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    usedAt: text("used_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_ssh_credential_usage_credential").on(table.credentialId),
    index("idx_ssh_credential_usage_user").on(table.userId),
  ],
);

export const snippets = sqliteTable(
  "snippets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    content: text("content").notNull(),
    description: text("description"),
    folder: text("folder"),
    order: integer("order").notNull().default(0),
    syncId: text("sync_id").unique(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    hostFilter: text("host_filter"),
    isNote: integer("is_note", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [index("idx_snippets_user_id").on(table.userId)],
);

export const snippetFolders = sqliteTable("snippet_folders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color"),
  icon: text("icon"),
  syncId: text("sync_id").unique(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const c2sTunnelPresets = sqliteTable("c2s_tunnel_presets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  config: text("config").notNull(),
  platform: text("platform"),
  computerName: text("computer_name"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const snippetAccess = sqliteTable(
  "snippet_access",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    snippetId: integer("snippet_id")
      .notNull()
      .references(() => snippets.id, { onDelete: "cascade" }),

    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    roleId: integer("role_id").references(() => roles.id, {
      onDelete: "cascade",
    }),

    grantedBy: text("granted_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    permissionLevel: text("permission_level").notNull().default("view"),

    expiresAt: text("expires_at"),

    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  // Same three lookup shapes as host_access: by grantee, by role, by snippet.
  (table) => [
    index("idx_snippet_access_user_id").on(table.userId),
    index("idx_snippet_access_snippet_id").on(table.snippetId),
    index("idx_snippet_access_role_id").on(table.roleId),
  ],
);

export const sshFolders = sqliteTable(
  "ssh_folders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color"),
    icon: text("icon"),
    credentialId: integer("credential_id").references(() => sshCredentials.id, {
      onDelete: "set null",
    }),
    // Manual drag-to-reorder position among sibling folders. Null falls back
    // to name sort, same convention as hosts.sortOrder.
    sortOrder: integer("sort_order"),
    syncId: text("sync_id").unique(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_ssh_folders_user_id").on(table.userId)],
);

export const recentActivity = sqliteTable(
  "recent_activity",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    hostId: integer("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    hostName: text("host_name"),
    timestamp: text("timestamp")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  // Always read newest-first for one user, so timestamp follows user_id.
  (table) => [
    index("idx_recent_activity_user_ts").on(table.userId, table.timestamp),
  ],
);

export const commandHistory = sqliteTable(
  "command_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hostId: integer("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    command: text("command").notNull(),
    executedAt: text("executed_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_command_history_user_host").on(table.userId, table.hostId),
  ],
);

export const networkTopology = sqliteTable("network_topology", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  topology: text("topology"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const hostAccess = sqliteTable(
  "host_access",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    hostId: integer("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),

    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: integer("role_id")
      .references(() => roles.id, { onDelete: "cascade" }),

    grantedBy: text("granted_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    permissionLevel: text("permission_level")
      .notNull()
      .default("connect"),

    expiresAt: text("expires_at"),

    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lastAccessedAt: text("last_accessed_at"),
    accessCount: integer("access_count").notNull().default(0),
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

export const sharedHostAuthOverrides = sqliteTable(
  "shared_host_auth_overrides",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    hostId: integer("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    protocol: text("protocol").notNull().default("ssh"),
    credentialId: integer("credential_id")
      .notNull()
      .references(() => sshCredentials.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("shared_host_auth_overrides_host_user_protocol_unique").on(
      table.hostId,
      table.userId,
      table.protocol,
    ),
  ],
);

export const sharedHostSecrets = sqliteTable(
  "shared_host_secrets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    hostAccessId: integer("host_access_id")
      .notNull()
      .references(() => hostAccess.id, { onDelete: "cascade" }),

    targetUserId: text("target_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    protocol: text("protocol").notNull().default("ssh"),
    sourceType: text("source_type").notNull().default("credential"),

    originalCredentialId: integer("original_credential_id").references(
      () => sshCredentials.id,
      { onDelete: "cascade" },
    ),

    encryptedUsername: text("encrypted_username"),
    encryptedAuthType: text("encrypted_auth_type"),
    encryptedPassword: text("encrypted_password"),
    encryptedKey: text("encrypted_key", { length: 16384 }),
    encryptedKeyPassword: text("encrypted_key_password"),
    encryptedKeyType: text("encrypted_key_type"),
    encryptedDomain: text("encrypted_domain"),

    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
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

export const roles = sqliteTable("roles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description"),

  isSystem: integer("is_system", { mode: "boolean" })
    .notNull()
    .default(false),

  permissions: text("permissions"),

  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const userRoles = sqliteTable(
  "user_roles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: integer("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
  
    grantedBy: text("granted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    grantedAt: text("granted_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
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

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    // Nullable on purpose: the trail outlives the account, and username keeps the
    // entry attributable once the reference is gone.
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    username: text("username").notNull(),

    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    resourceName: text("resource_name"),

    details: text("details"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),

    success: integer("success", { mode: "boolean" }).notNull(),
    errorMessage: text("error_message"),

    timestamp: text("timestamp")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
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

export const sessionRecordings = sqliteTable(
  "session_recordings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    hostId: integer("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    // Nullable on purpose: a recording is evidence about the host as much as the
    // person, so it outlives the account. username keeps it attributable.
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    username: text("username"),
    accessId: integer("access_id").references(() => hostAccess.id, {
      onDelete: "set null",
    }),

    startedAt: text("started_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    endedAt: text("ended_at"),
    duration: integer("duration"),

    commands: text("commands"),
    dangerousActions: text("dangerous_actions"),

    recordingPath: text("recording_path"),
    protocol: text("protocol").notNull().default("ssh"),
    format: text("format").notNull().default("text"),

    terminatedByOwner: integer("terminated_by_owner", {
      mode: "boolean",
    }).default(false),
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

export const sessionShares = sqliteTable(
  "session_shares",
  {
  id: text("id").primaryKey(),

  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  protocol: text("protocol").notNull(),

  // Live-session binding: TerminalSessionManager's session.id for SSH, or
  // guacd's own guacamoleConnectionId for rdp/vnc/telnet. Neither is a DB
  // row (process-local, in-memory) so this intentionally has no FK.
  sessionId: text("session_id").notNull(),
  tabInstanceId: text("tab_instance_id"),

  shareType: text("share_type").notNull(), // "link" | "user"
  targetUserId: text("target_user_id").references(() => users.id, {
    onDelete: "cascade",
  }),
  linkToken: text("link_token").unique(),

  permissionLevel: text("permission_level").notNull().default("read-only"),

  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at"),

  lastJoinedAt: text("last_joined_at"),
  joinCount: integer("join_count").notNull().default(0),
  },
  // Resolved from the live session on join, and listed per host.
  (table) => [
    index("idx_session_shares_session_id").on(table.sessionId),
    index("idx_session_shares_host_id").on(table.hostId),
  ],
);

export const sessionShareParticipants = sqliteTable(
  "session_share_participants",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    shareId: text("share_id")
      .notNull()
      .references(() => sessionShares.id, { onDelete: "cascade" }),

    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    guestLabel: text("guest_label"),

    joinedAt: text("joined_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    leftAt: text("left_at"),
  },
);

export const opksshTokens = sqliteTable(
  "opkssh_tokens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hostId: integer("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
  
    sshCert: text("ssh_cert", { length: 8192 }).notNull(),
    privateKey: text("private_key", { length: 8192 }).notNull(),
  
    email: text("email"),
    sub: text("sub"),
    issuer: text("issuer"),
    audience: text("audience"),
  
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    expiresAt: text("expires_at").notNull(),
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
export const vaultProfiles = sqliteTable("vault_profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
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
  shared: integer("shared", { mode: "boolean" }).notNull().default(false),
  syncId: text("sync_id").unique(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// Per-user cache of the ephemeral SSH private key + Vault-signed certificate.
// Transient: rows live only until the certificate expires. Secret fields are
// encrypted under the user's data-encryption key (see field-crypto.ts).
export const vaultTokens = sqliteTable(
  "vault_tokens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    profileId: integer("profile_id")
      .notNull()
      .references(() => vaultProfiles.id, { onDelete: "cascade" }),
  
    sshCert: text("ssh_cert", { length: 8192 }).notNull(),
    privateKey: text("private_key", { length: 8192 }).notNull(),
  
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    expiresAt: text("expires_at").notNull(),
    lastUsed: text("last_used"),
  },
  // Declared inline in the production DDL as UNIQUE(...), but never here,
  // so the generated Postgres and MySQL schemas allowed duplicates the
  // SQLite deployment forbids — and the upsert had nothing to conflict on.
  (table) => [uniqueIndex("idx_vault_tokens_user_profile").on(table.userId, table.profileId)],
);

export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    expiresAt: text("expires_at"),
    lastUsedAt: text("last_used_at"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [index("idx_api_keys_user_id").on(table.userId)],
);

export const userOpenTabs = sqliteTable(
  "user_open_tabs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tabType: text("tab_type").notNull(),
    hostId: integer("host_id").references(() => hosts.id, {
      onDelete: "cascade",
    }),
    label: text("label").notNull(),
    tabOrder: integer("tab_order").notNull().default(0),
    backendSessionId: text("backend_session_id"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_user_open_tabs_user_id").on(table.userId)],
);

export const userPreferences = sqliteTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  reopenTabsOnLogin: integer("reopen_tabs_on_login", { mode: "boolean" })
    .notNull()
    .default(false),
  theme: text("theme"),
  fontSize: text("font_size"),
  accentColor: text("accent_color"),
  language: text("language"),
  storageMode: text("storage_mode"),
  commandAutocomplete: integer("command_autocomplete", { mode: "boolean" }),
  commandPaletteEnabled: integer("command_palette_enabled", { mode: "boolean" }),
  showHostTags: integer("show_host_tags", { mode: "boolean" }),
  hostTrayOnClick: integer("host_tray_on_click", { mode: "boolean" }),
  pinAppRail: integer("pin_app_rail", { mode: "boolean" }),
  expandAppRailOnHover: integer("expand_app_rail_on_hover", {
    mode: "boolean",
  }),
  foldersCollapsed: integer("folders_collapsed", { mode: "boolean" }),
  confirmSnippetExecution: integer("confirm_snippet_execution", { mode: "boolean" }),
  disableUpdateCheck: integer("disable_update_check", { mode: "boolean" }),
  confirmTabClose: integer("confirm_tab_close", { mode: "boolean" }),
  hiddenRailTabs: text("hidden_rail_tabs"),
  // null means the user has not been asked yet; the assistant stays hidden
  // until this is explicitly true and the admin global is on.
  aiAssistantEnabled: integer("ai_assistant_enabled", { mode: "boolean" }),
  // Opt-in to letting the assistant run allowlisted read-only diagnostics
  // without a per-command approval click.
  aiReadOnlyCommands: integer("ai_read_only_commands", { mode: "boolean" }),
  compactHostView: integer("compact_host_view", { mode: "boolean" }),
  statusColorScheme: text("status_color_scheme"),
  customThemes: text("custom_themes"),
  customKeybindings: text("custom_keybindings"),
  terminalDefaults: text("terminal_defaults"),
  rdpDefaults: text("rdp_defaults"),
  terminalMacros: text("terminal_macros"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const hostMetricsPreferences = sqliteTable(
  "host_metrics_preferences",
  {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  // JSON-encoded HostMetricsLayout. Layout has no secrets, so it is stored as
  // plain JSON (no field-level encryption).
  layout: text("layout").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  },
  // One layout per user per host. Enforced in production since the inline DDL
  // creates it, but it was never declared here, so the generated Postgres and
  // MySQL schemas lacked it — and the upsert has nothing to conflict on.
  (table) => [
    uniqueIndex("idx_host_metrics_prefs_user_host").on(table.userId, table.hostId),
  ],
);

export const proxmoxStatsPreferences = sqliteTable(
  "proxmox_stats_preferences",
  {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  hostId: integer("host_id").notNull().references(() => hosts.id, { onDelete: "cascade" }),
  // JSON-encoded ProxmoxStatsLayout. Layout has no secrets, so it is stored as
  // plain JSON (no field-level encryption), same convention as hostMetricsPreferences.layout.
  layout: text("layout").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_proxmox_stats_prefs_user_host").on(table.userId, table.hostId),
  ],
);

export const hostSidebarPreferences = sqliteTable("host_sidebar_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  // JSON-encoded HostSidebarPreferences. No secrets in this blob, stored as
  // plain JSON like hostMetricsPreferences.layout.
  data: text("data").notNull(),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const credentialSidebarPreferences = sqliteTable(
  "credential_sidebar_preferences",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    // JSON-encoded CredentialSidebarPreferences. No secrets in this blob,
    // same convention as hostSidebarPreferences.data.
    data: text("data").notNull(),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
);

export const uiPreferences = sqliteTable("ui_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  // JSON-encoded UiPreferences (preset + per-area overrides + onboarding
  // state). No secrets in this blob, same convention as
  // hostSidebarPreferences.data.
  data: text("data").notNull(),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const hostHealthChecks = sqliteTable(
  "host_health_checks",
  {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  // JSON array of { id, name, type: "tcp"|"http", target, port, path }
  checks: text("checks").notNull(),
  intervalSeconds: integer("interval_seconds").notNull().default(300),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  },
  // Same as above: one set of checks per user per host.
  (table) => [
    uniqueIndex("idx_host_health_checks_user_host").on(table.userId, table.hostId),
  ],
);

export const hostHealthHistory = sqliteTable("host_health_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  checkId: text("check_id").notNull(),
  ts: text("ts").notNull().default(sql`CURRENT_TIMESTAMP`),
  ok: integer("ok", { mode: "boolean" }).notNull(),
  latencyMs: integer("latency_ms"),
  detail: text("detail"),
});

export const dashboardServiceLinks = sqliteTable("dashboard_service_links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  url: text("url").notNull(),
  order: integer("order").notNull().default(0),
  syncId: text("sync_id").unique(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// --- termix-id begin ---
// A user claims a unique public handle. Their published SSH public keys are
// served at an unauthenticated resolver endpoint in authorized_keys format,
// so any server can be provisioned with `curl <host>/termix-id/u/<handle> >> ~/.ssh/authorized_keys`.
export const termixIdentities = sqliteTable("termix_identities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // One Termix ID per user — enforced in schema, not just in code.
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  handle: text("handle").notNull().unique(),
  description: text("description"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const termixIdentityKeys = sqliteTable("termix_identity_keys", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  identityId: integer("identity_id")
    .notNull()
    .references(() => termixIdentities.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Public keys are non-secret, so they are stored in plaintext (no field-level
  // encryption). This is what lets the unauthenticated resolver serve them.
  publicKey: text("public_key", { length: 8192 }).notNull(),
  // Raw algorithm token (e.g. "ssh-ed25519"), and a normalized group used for
  // the /<ALGO> resolver filter (RSA / ED25519 / ECDSA / ...).
  keyType: text("key_type").notNull(),
  algorithm: text("algorithm").notNull(),
  label: text("label"),
  comment: text("comment"),
  // "manual" (pasted) or "credential" (imported from an ssh_credentials entry).
  source: text("source").notNull().default("manual"),
  credentialId: integer("credential_id").references(() => sshCredentials.id, {
    onDelete: "set null",
  }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});
// Per-identity certificate authority. Servers that trust this CA (via
// TrustedUserCAKeys / @cert-authority) accept any user certificate it signs,
// giving central revocation (rotate the CA) and expiry (cert validity).
export const termixIdentityCa = sqliteTable("termix_identity_ca", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  identityId: integer("identity_id")
    .notNull()
    .unique()
    .references(() => termixIdentities.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // CA public key (plaintext — it is published); CA private key is field-encrypted.
  publicKey: text("public_key", { length: 4096 }).notNull(),
  privateKey: text("private_key", { length: 8192 }).notNull(),
  validityDays: integer("validity_days").notNull().default(90),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});
// --- termix-id end ---

// --- tmux-monitor begin ---
export const tmuxSessionTags = sqliteTable("tmux_session_tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  sessionName: text("session_name").notNull(),
  tag: text("tag").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});
// --- tmux-monitor end ---

// --- metrics-history begin ---
export const hostMetricsHistory = sqliteTable("host_metrics_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  ts: text("ts")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  cpuPercent: real("cpu_percent"),
  memPercent: real("mem_percent"),
  diskPercent: real("disk_percent"),
  netRxBytes: integer("net_rx_bytes"),
  netTxBytes: integer("net_tx_bytes"),
});
// --- metrics-history end ---

// --- proxmox-node-history begin ---
export const proxmoxNodeHistory = sqliteTable("proxmox_node_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  ts: text("ts")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  cpuPercent: real("cpu_percent"),
  memPercent: real("mem_percent"),
  diskPercent: real("disk_percent"),
  netRxBytes: integer("net_rx_bytes"),
  netTxBytes: integer("net_tx_bytes"),
});
// --- proxmox-node-history end ---

// --- alerts begin ---
export const alertRules = sqliteTable("alert_rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  hostId: integer("host_id").references(() => hosts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  triggerType: text("trigger_type").notNull(),
  thresholdValue: real("threshold_value"),
  thresholdDurationSeconds: integer("threshold_duration_seconds"),
  cooldownMinutes: integer("cooldown_minutes").notNull().default(15),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const notificationChannels = sqliteTable("notification_channels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull(),
  config: text("config").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const alertRuleChannels = sqliteTable("alert_rule_channels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ruleId: integer("rule_id")
    .notNull()
    .references(() => alertRules.id, { onDelete: "cascade" }),
  channelId: integer("channel_id")
    .notNull()
    .references(() => notificationChannels.id, { onDelete: "cascade" }),
});

export const alertFirings = sqliteTable(
  "alert_firings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ruleId: integer("rule_id")
      .notNull()
      .references(() => alertRules.id, { onDelete: "cascade" }),
    hostId: integer("host_id").notNull(),
    hostName: text("host_name").notNull(),
    firedAt: text("fired_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    resolvedAt: text("resolved_at"),
    value: real("value"),
    message: text("message").notNull(),
    severity: text("severity").notNull().default("warning"),
    acknowledged: integer("acknowledged", { mode: "boolean" })
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
export const automations = sqliteTable(
  "automations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    // The whole trigger + steps graph, shaped by AutomationDefinition. Read and
    // written as a unit, never queried by its inner structure.
    definition: text("definition").notNull(),
    definitionVersion: integer("definition_version").notNull().default(1),
    concurrencyPolicy: text("concurrency_policy").notNull().default("skip"),
    maxRunSeconds: integer("max_run_seconds").notNull().default(300),
    dryRun: integer("dry_run", { mode: "boolean" }).notNull().default(false),
    lastRunAt: text("last_run_at"),
    lastRunStatus: text("last_run_status"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
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
export const automationTriggerState = sqliteTable(
  "automation_trigger_state",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    automationId: integer("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    stateKey: text("state_key").notNull(),
    breachStartedAt: text("breach_started_at"),
    lastFiredAt: text("last_fired_at"),
    lastValue: real("last_value"),
    lastObservedState: text("last_observed_state"),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_automation_trigger_state_key").on(
      table.automationId,
      table.stateKey,
    ),
  ],
);

export const automationSchedules = sqliteTable(
  "automation_schedules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    automationId: integer("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    cron: text("cron"),
    intervalSeconds: integer("interval_seconds"),
    timezone: text("timezone"),
    nextDueAt: text("next_due_at"),
    lastTickAt: text("last_tick_at"),
  },
  (table) => [
    uniqueIndex("idx_automation_schedules_automation").on(table.automationId),
    index("idx_automation_schedules_due").on(table.nextDueAt),
  ],
);

export const automationRuns = sqliteTable(
  "automation_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    automationId: integer("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    triggerType: text("trigger_type").notNull(),
    triggerContext: text("trigger_context"),
    status: text("status").notNull(),
    startedAt: text("started_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    finishedAt: text("finished_at"),
    durationMs: integer("duration_ms"),
    error: text("error"),
    dryRun: integer("dry_run", { mode: "boolean" }).notNull().default(false),
    // Set when one automation invoked another, so a chain can be traced.
    parentRunId: integer("parent_run_id"),
  },
  (table) => [
    index("idx_automation_runs_automation").on(
      table.automationId,
      table.startedAt,
    ),
    index("idx_automation_runs_user").on(table.userId, table.startedAt),
  ],
);

export const automationRunSteps = sqliteTable(
  "automation_run_steps",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id")
      .notNull()
      .references(() => automationRuns.id, { onDelete: "cascade" }),
    stepIndex: integer("step_index").notNull(),
    stepId: text("step_id").notNull(),
    stepType: text("step_type").notNull(),
    status: text("status").notNull(),
    startedAt: text("started_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    finishedAt: text("finished_at"),
    output: text("output"),
    error: text("error"),
    truncated: integer("truncated", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => [
    index("idx_automation_run_steps_run").on(table.runId, table.stepIndex),
  ],
);

export const automationChannels = sqliteTable(
  "automation_channels",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    automationId: integer("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    channelId: integer("channel_id")
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
export const homepageItems = sqliteTable(
  "homepage_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    typeId: text("type_id").notNull(),
    title: text("title"),
    config: text("config").notNull().default("{}"),
    folderId: integer("folder_id"),
    syncId: text("sync_id").unique(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_homepage_items_user_id").on(table.userId)],
);

export const homepageLayouts = sqliteTable("homepage_layouts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  // JSON: { entries: HomepageLayoutEntry[], pan: {x,y}, zoom: number }
  layout: text("layout").notNull().default("{}"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});
// --- homepage end ---

// --- fleets begin ---
export const fleets = sqliteTable("fleets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color"),
  icon: text("icon"),
  // JSON array of { tag: string } rules, unioned with static fleetMembers at
  // resolution time. Kept to tag-equality matching for v1.
  tagRules: text("tag_rules"),
  syncId: text("sync_id").unique(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const fleetMembers = sqliteTable(
  "fleet_members",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fleetId: integer("fleet_id")
      .notNull()
      .references(() => fleets.id, { onDelete: "cascade" }),
    hostId: integer("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    addedAt: text("added_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
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
export const fleetInventory = sqliteTable(
  "fleet_inventory",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    hostId: integer("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    osPrettyName: text("os_pretty_name"),
    kernel: text("kernel"),
    architecture: text("architecture"),
    hostname: text("hostname"),
    uptimeSeconds: integer("uptime_seconds"),
    ip: text("ip"),
    packageManager: text("package_manager"),
    collectedAt: text("collected_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  // host_id leads the unique pair; a user's whole inventory is read by user_id.
  (table) => [
    uniqueIndex("idx_fleet_inventory_host").on(table.hostId, table.userId),
    index("idx_fleet_inventory_user").on(table.userId),
  ],
);
// --- fleets end ---

// --- workspaces begin ---
export const userWorkspaces = sqliteTable(
  "user_workspaces",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color"),
    icon: text("icon"),
    // "manual" | "last_session" - exactly one last_session row per user.
    kind: text("kind").notNull().default("manual"),
    isDefault: integer("is_default", { mode: "boolean" })
      .notNull()
      .default(false),
    // JSON-encoded WorkspacePayload: tabs, splitMode, paneTabIds, rowSizes, rowColSizes
    payload: text("payload").notNull().default("{}"),
    syncId: text("sync_id").unique(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lastUsedAt: text("last_used_at"),
  },
  (table) => [index("idx_user_workspaces_user_id").on(table.userId)],
);
// --- workspaces end ---

// --- sync begin ---
// Records a delete for a synced entity type so the other side of a sync
// pair (embedded desktop backend <-> connected remote server) learns about
// the deletion instead of re-creating the row on its next pull.
export const syncTombstones = sqliteTable("sync_tombstones", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  syncId: text("sync_id").notNull(),
  deletedAt: text("deleted_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});
// --- sync end ---

// --- ai begin ---
/**
 * A user's connection to one AI provider. api_key is encrypted at rest via
 * FieldCrypto; it is never returned to the frontend, which only ever sees
 * api_key_prefix for display.
 */
export const aiProviders = sqliteTable(
  "ai_providers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // ollama | anthropic | openai | gemini | openai_compatible
    providerType: text("provider_type").notNull(),
    label: text("label").notNull(),
    // Required for ollama and openai_compatible, optional elsewhere.
    baseUrl: text("base_url"),
    apiKey: text("api_key", { length: 8192 }),
    // First few characters, kept in the clear so the UI can identify a key.
    apiKeyPrefix: text("api_key_prefix"),
    defaultModel: text("default_model"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_ai_providers_user_label").on(table.userId, table.label),
  ],
);

export const aiConversations = sqliteTable(
  "ai_conversations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title"),
    providerId: integer("provider_id"),
    model: text("model"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_ai_conversations_user").on(table.userId, table.updatedAt),
  ],
);

export const aiMessages = sqliteTable(
  "ai_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    // user | assistant | tool
    role: text("role").notNull(),
    content: text("content").notNull().default(""),
    // Serialized tool calls and their results for this turn.
    toolCalls: text("tool_calls"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
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
export const aiProposals = sqliteTable(
  "ai_proposals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The propose_* tool name that produced this.
    kind: text("kind").notNull(),
    summary: text("summary"),
    payload: text("payload").notNull().default("{}"),
    // pending | applied | rejected | expired
    status: text("status").notNull().default("pending"),
    appliedAt: text("applied_at"),
    resultSummary: text("result_summary"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
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
export const collabRooms = sqliteTable(
  "collab_rooms",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // Persistent rooms survive being emptied and can be re-used; one-off
    // rooms are ended explicitly and never listed again.
    persistent: integer("persistent", { mode: "boolean" })
      .notNull()
      .default(false),

    presenterUserId: text("presenter_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    stageProtocol: text("stage_protocol"),
    stageHostId: integer("stage_host_id").references(() => hosts.id, {
      onDelete: "set null",
    }),
    stageShareId: text("stage_share_id").references(() => sessionShares.id, {
      onDelete: "set null",
    }),

    // Set = anonymous guests may watch the stage through this token.
    guestLinkToken: text("guest_link_token"),

    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    endedAt: text("ended_at"),
  },
  (table) => [
    index("idx_collab_rooms_owner").on(table.ownerUserId),
    uniqueIndex("idx_collab_rooms_guest_token").on(table.guestLinkToken),
  ],
);

export const collabRoomMembers = sqliteTable(
  "collab_room_members",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roomId: text("room_id")
      .notNull()
      .references(() => collabRooms.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // "host" runs the room: invites, force-switches the presenter, ends it.
    roomRole: text("room_role").notNull().default("member"),
    addedBy: text("added_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
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
export const secretSources = sqliteTable(
  "secret_sources",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // "onepassword-connect" for now; the reference syntax is per kind.
    kind: text("kind").notNull().default("onepassword-connect"),
    baseUrl: text("base_url").notNull(),
    token: text("token").notNull(),
    // Visible to every user; secrets still decrypt with the owner's key.
    shared: integer("shared", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_secret_sources_user").on(table.userId)],
);
