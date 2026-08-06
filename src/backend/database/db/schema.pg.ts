// GENERATED FILE — do not edit.
//
// Produced from schema.ts by scripts/generate-dialect-schema.cjs.
// Edit the sqlite schema and re-run `node scripts/generate-dialect-schema.cjs`.
// Target dialect: postgres.
//
// DDL source for drizzle-kit. NOT imported to run queries — repositories use
// schema.ts on every dialect. See the generator header for why that is correct.

import {
  pgTable,
  text,
  varchar,
  integer,
  serial,
  boolean,
  doublePrecision,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable("users", {
  id: varchar("id", { length: 255 }).primaryKey(),
  username: text("username").notNull(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),

  isOidc: boolean("is_oidc").notNull().default(false),
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
  totpEnabled: boolean("totp_enabled")
    .notNull()
    .default(false),
  totpBackupCodes: text("totp_backup_codes"),

  registeredAt: text("registered_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  donationModalDismissed: boolean("donation_modal_dismissed")
    .notNull()
    .default(false),
});

export const settings = pgTable("settings", {
  key: varchar("key", { length: 255 }).primaryKey(),
  value: text("value").notNull(),
});

export const ssoProviders = pgTable("sso_providers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  type: text("type").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  config: text("config").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const sessions = pgTable("sessions", {
  id: varchar("id", { length: 255 }).primaryKey(),
  userId: varchar("user_id", { length: 255 })
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
});

export const trustedDevices = pgTable("trusted_devices", {
  id: varchar("id", { length: 255 }).primaryKey(),
  userId: varchar("user_id", { length: 255 })
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
});

export const webauthnCredentials = pgTable("webauthn_credentials", {
  id: varchar("id", { length: 255 }).primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  credentialId: text("credential_id").notNull(),
  publicKey: text("public_key").notNull(),
  counter: integer("counter").notNull().default(0),
  deviceType: text("device_type"),
  backedUp: boolean("backed_up").notNull().default(false),
  transports: text("transports"),
  userVerification: text("user_verification").notNull().default("preferred"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  lastUsedAt: text("last_used_at"),
});

export const hosts = pgTable("ssh_data", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  connectionType: text("connection_type").notNull().default("ssh"),
  name: varchar("name", { length: 255 }),
  ip: text("ip").notNull(),
  port: integer("port").notNull(),
  username: text("username").notNull(),
  folder: text("folder"),
  tags: text("tags"),
  pin: boolean("pin").notNull().default(false),
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

  credentialId: integer("credential_id").references(() => sshCredentials.id, { onDelete: "set null" }),
  overrideCredentialUsername: boolean("override_credential_username"),
  // When authType is "vault", the host authenticates via a Vault SSH signer
  // profile (shared settings, no secrets). The signing certificate is obtained
  // per-user at connect time via an interactive Vault OIDC flow.
  vaultProfileId: integer("vault_profile_id").references(
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
  terminalConfig: text("terminal_config"),
  quickActions: text("quick_actions"),
  notes: text("notes"),
  enableSsh: boolean("enable_ssh").notNull().default(true),
  enableRdp: boolean("enable_rdp").notNull().default(false),
  enableVnc: boolean("enable_vnc").notNull().default(false),
  enableTelnet: boolean("enable_telnet").notNull().default(false),

  sshPort: integer("ssh_port").default(22),
  rdpPort: integer("rdp_port").default(3389),
  vncPort: integer("vnc_port").default(5900),
  telnetPort: integer("telnet_port").default(23),

  rdpCredentialId: integer("rdp_credential_id").references(() => sshCredentials.id, { onDelete: "set null" }),
  rdpUser: text("rdp_user"),
  rdpPassword: text("rdp_password"),
  rdpDomain: text("rdp_domain"),
  rdpSecurity: text("rdp_security"),
  rdpIgnoreCert: boolean("rdp_ignore_cert").default(false),

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
  ignoreCert: boolean("ignore_cert").default(false),
  guacamoleConfig: text("guacamole_config"),

  useSocks5: boolean("use_socks5"),
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
  syncId: varchar("sync_id", { length: 255 }).unique(),

  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const fileManagerRecent = pgTable("file_manager_recent", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  path: text("path").notNull(),
  lastOpened: text("last_opened")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const fileManagerPinned = pgTable("file_manager_pinned", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  path: text("path").notNull(),
  pinnedAt: text("pinned_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const fileManagerShortcuts = pgTable("file_manager_shortcuts", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  path: text("path").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const transferRecent = pgTable("transfer_recent", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
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
});

export const dismissedAlerts = pgTable("dismissed_alerts", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  alertId: text("alert_id").notNull(),
  dismissedAt: text("dismissed_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const sshCredentials = pgTable("ssh_credentials", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  folder: text("folder"),
  tags: text("tags"),
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


  usageCount: integer("usage_count").notNull().default(0),
  lastUsed: text("last_used"),
  syncId: varchar("sync_id", { length: 255 }).unique(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const sshCredentialUsage = pgTable("ssh_credential_usage", {
  id: serial("id").primaryKey(),
  credentialId: integer("credential_id")
    .notNull()
    .references(() => sshCredentials.id, { onDelete: "cascade" }),
  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  usedAt: text("used_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const snippets = pgTable("snippets", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  content: text("content").notNull(),
  description: text("description"),
  folder: text("folder"),
  order: integer("order").notNull().default(0),
  syncId: varchar("sync_id", { length: 255 }).unique(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  hostFilter: text("host_filter"),
});

export const snippetFolders = pgTable("snippet_folders", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  color: text("color"),
  icon: text("icon"),
  syncId: varchar("sync_id", { length: 255 }).unique(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const c2sTunnelPresets = pgTable("c2s_tunnel_presets", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
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

export const snippetAccess = pgTable("snippet_access", {
  id: serial("id").primaryKey(),
  snippetId: integer("snippet_id")
    .notNull()
    .references(() => snippets.id, { onDelete: "cascade" }),

  userId: varchar("user_id", { length: 255 }).references(() => users.id, { onDelete: "cascade" }),
  roleId: integer("role_id").references(() => roles.id, {
    onDelete: "cascade",
  }),

  grantedBy: varchar("granted_by", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  permissionLevel: text("permission_level").notNull().default("view"),

  expiresAt: text("expires_at"),

  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const sshFolders = pgTable("ssh_folders", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  color: text("color"),
  icon: text("icon"),
  credentialId: integer("credential_id").references(() => sshCredentials.id, {
    onDelete: "set null",
  }),
  syncId: varchar("sync_id", { length: 255 }).unique(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const recentActivity = pgTable("recent_activity", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
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
});

export const commandHistory = pgTable("command_history", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  command: text("command").notNull(),
  executedAt: text("executed_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const networkTopology = pgTable("network_topology", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
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

export const hostAccess = pgTable("host_access", {
  id: serial("id").primaryKey(),
  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),

  userId: varchar("user_id", { length: 255 })
    .references(() => users.id, { onDelete: "cascade" }),
  roleId: integer("role_id")
    .references(() => roles.id, { onDelete: "cascade" }),

  grantedBy: varchar("granted_by", { length: 255 })
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
});

export const sharedHostAuthOverrides = pgTable(
  "shared_host_auth_overrides",
  {
    id: serial("id").primaryKey(),
    hostId: integer("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    protocol: varchar("protocol", { length: 255 }).notNull().default("ssh"),
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

export const sharedHostSecrets = pgTable(
  "shared_host_secrets",
  {
    id: serial("id").primaryKey(),

    hostAccessId: integer("host_access_id")
      .notNull()
      .references(() => hostAccess.id, { onDelete: "cascade" }),

    targetUserId: varchar("target_user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    protocol: varchar("protocol", { length: 255 }).notNull().default("ssh"),
    sourceType: text("source_type").notNull().default("credential"),

    originalCredentialId: integer("original_credential_id").references(
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

export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description"),

  isSystem: boolean("is_system")
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

export const userRoles = pgTable(
  "user_roles",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: integer("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
  
    grantedBy: varchar("granted_by", { length: 255 }).references(() => users.id, {
      onDelete: "set null",
    }),
    grantedAt: text("granted_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  // Declared inline in the production DDL as UNIQUE(...), but never here,
  // so the generated Postgres and MySQL schemas allowed duplicates the
  // SQLite deployment forbids — and the upsert had nothing to conflict on.
  (table) => [uniqueIndex("idx_user_roles_user_role").on(table.userId, table.roleId)],
);

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),

  // Nullable on purpose: the trail outlives the account, and username keeps the
  // entry attributable once the reference is gone.
  userId: varchar("user_id", { length: 255 }).references(() => users.id, { onDelete: "set null" }),
  username: text("username").notNull(),

  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id"),
  resourceName: text("resource_name"),

  details: text("details"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),

  success: boolean("success").notNull(),
  errorMessage: text("error_message"),

  timestamp: text("timestamp")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const sessionRecordings = pgTable("session_recordings", {
  id: serial("id").primaryKey(),

  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  // Nullable on purpose: a recording is evidence about the host as much as the
  // person, so it outlives the account. username keeps it attributable.
  userId: varchar("user_id", { length: 255 }).references(() => users.id, { onDelete: "set null" }),
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
  protocol: varchar("protocol", { length: 255 }).notNull().default("ssh"),
  format: text("format").notNull().default("text"),

  terminatedByOwner: boolean("terminated_by_owner")
    .default(false),
  terminationReason: text("termination_reason"),
});

export const sessionShares = pgTable("session_shares", {
  id: varchar("id", { length: 255 }).primaryKey(),

  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  ownerUserId: varchar("owner_user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  protocol: varchar("protocol", { length: 255 }).notNull(),

  // Live-session binding: TerminalSessionManager's session.id for SSH, or
  // guacd's own guacamoleConnectionId for rdp/vnc/telnet. Neither is a DB
  // row (process-local, in-memory) so this intentionally has no FK.
  sessionId: text("session_id").notNull(),
  tabInstanceId: text("tab_instance_id"),

  shareType: text("share_type").notNull(), // "link" | "user"
  targetUserId: varchar("target_user_id", { length: 255 }).references(() => users.id, {
    onDelete: "cascade",
  }),
  linkToken: varchar("link_token", { length: 255 }).unique(),

  permissionLevel: text("permission_level").notNull().default("read-only"),

  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at"),

  lastJoinedAt: text("last_joined_at"),
  joinCount: integer("join_count").notNull().default(0),
});

export const sessionShareParticipants = pgTable(
  "session_share_participants",
  {
    id: serial("id").primaryKey(),
    shareId: varchar("share_id", { length: 255 })
      .notNull()
      .references(() => sessionShares.id, { onDelete: "cascade" }),

    userId: varchar("user_id", { length: 255 }).references(() => users.id, {
      onDelete: "cascade",
    }),
    guestLabel: text("guest_label"),

    joinedAt: text("joined_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    leftAt: text("left_at"),
  },
);

export const opksshTokens = pgTable(
  "opkssh_tokens",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hostId: integer("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
  
    sshCert: text("ssh_cert").notNull(),
    privateKey: text("private_key").notNull(),
  
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
export const vaultProfiles = pgTable("vault_profiles", {
  id: serial("id").primaryKey(),
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
export const vaultTokens = pgTable(
  "vault_tokens",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    profileId: integer("profile_id")
      .notNull()
      .references(() => vaultProfiles.id, { onDelete: "cascade" }),
  
    sshCert: text("ssh_cert").notNull(),
    privateKey: text("private_key").notNull(),
  
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

export const apiKeys = pgTable("api_keys", {
  id: varchar("id", { length: 255 }).primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  tokenHash: text("token_hash").notNull(),
  tokenPrefix: text("token_prefix").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at"),
  lastUsedAt: text("last_used_at"),
  isActive: boolean("is_active").notNull().default(true),
});

export const userOpenTabs = pgTable("user_open_tabs", {
  id: varchar("id", { length: 255 }).primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tabType: text("tab_type").notNull(),
  hostId: integer("host_id").references(() => hosts.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  tabOrder: integer("tab_order").notNull().default(0),
  backendSessionId: text("backend_session_id"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const userPreferences = pgTable("user_preferences", {
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
  compactHostView: boolean("compact_host_view"),
  statusColorScheme: text("status_color_scheme"),
  customThemes: text("custom_themes"),
  customKeybindings: text("custom_keybindings"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const hostMetricsPreferences = pgTable(
  "host_metrics_preferences",
  {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
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

export const hostHealthChecks = pgTable(
  "host_health_checks",
  {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
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

export const hostHealthHistory = pgTable("host_health_history", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  checkId: text("check_id").notNull(),
  ts: text("ts").notNull().default(sql`CURRENT_TIMESTAMP`),
  ok: boolean("ok").notNull(),
  latencyMs: integer("latency_ms"),
  detail: text("detail"),
});

export const dashboardServiceLinks = pgTable("dashboard_service_links", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  url: text("url").notNull(),
  order: integer("order").notNull().default(0),
  syncId: varchar("sync_id", { length: 255 }).unique(),
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
export const termixIdentities = pgTable("termix_identities", {
  id: serial("id").primaryKey(),
  // One Termix ID per user — enforced in schema, not just in code.
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  handle: varchar("handle", { length: 255 }).notNull().unique(),
  description: text("description"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const termixIdentityKeys = pgTable("termix_identity_keys", {
  id: serial("id").primaryKey(),
  identityId: integer("identity_id")
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
  label: text("label"),
  comment: text("comment"),
  // "manual" (pasted) or "credential" (imported from an ssh_credentials entry).
  source: text("source").notNull().default("manual"),
  credentialId: integer("credential_id").references(() => sshCredentials.id, {
    onDelete: "set null",
  }),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});
// Per-identity certificate authority. Servers that trust this CA (via
// TrustedUserCAKeys / @cert-authority) accept any user certificate it signs,
// giving central revocation (rotate the CA) and expiry (cert validity).
export const termixIdentityCa = pgTable("termix_identity_ca", {
  id: serial("id").primaryKey(),
  identityId: integer("identity_id")
    .notNull()
    .unique()
    .references(() => termixIdentities.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // CA public key (plaintext — it is published); CA private key is field-encrypted.
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
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
export const tmuxSessionTags = pgTable("tmux_session_tags", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
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
export const hostMetricsHistory = pgTable("host_metrics_history", {
  id: serial("id").primaryKey(),
  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  ts: text("ts")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  cpuPercent: doublePrecision("cpu_percent"),
  memPercent: doublePrecision("mem_percent"),
  diskPercent: doublePrecision("disk_percent"),
  netRxBytes: integer("net_rx_bytes"),
  netTxBytes: integer("net_tx_bytes"),
});
// --- metrics-history end ---

// --- alerts begin ---
export const alertRules = pgTable("alert_rules", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  hostId: integer("host_id").references(() => hosts.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  triggerType: text("trigger_type").notNull(),
  thresholdValue: doublePrecision("threshold_value"),
  thresholdDurationSeconds: integer("threshold_duration_seconds"),
  cooldownMinutes: integer("cooldown_minutes").notNull().default(15),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const notificationChannels = pgTable("notification_channels", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  type: text("type").notNull(),
  config: text("config").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const alertRuleChannels = pgTable("alert_rule_channels", {
  id: serial("id").primaryKey(),
  ruleId: integer("rule_id")
    .notNull()
    .references(() => alertRules.id, { onDelete: "cascade" }),
  channelId: integer("channel_id")
    .notNull()
    .references(() => notificationChannels.id, { onDelete: "cascade" }),
});

export const alertFirings = pgTable("alert_firings", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
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
  value: doublePrecision("value"),
  message: text("message").notNull(),
  severity: text("severity").notNull().default("warning"),
  acknowledged: boolean("acknowledged").notNull().default(false),
});
// --- alerts end ---

// --- homepage begin ---
export const homepageItems = pgTable("homepage_items", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  typeId: text("type_id").notNull(),
  title: text("title"),
  config: text("config").notNull().default("{}"),
  folderId: integer("folder_id"),
  syncId: varchar("sync_id", { length: 255 }).unique(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const homepageLayouts = pgTable("homepage_layouts", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
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

// --- sync begin ---
// Records a delete for a synced entity type so the other side of a sync
// pair (embedded desktop backend <-> connected remote server) learns about
// the deletion instead of re-creating the row on its next pull.
export const syncTombstones = pgTable("sync_tombstones", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  syncId: varchar("sync_id", { length: 255 }).notNull(),
  deletedAt: text("deleted_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});
// --- sync end ---
