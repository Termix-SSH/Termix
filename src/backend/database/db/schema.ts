import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
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

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  jwtToken: text("jwt_token").notNull(),
  deviceType: text("device_type").notNull(),
  deviceInfo: text("device_info").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
  lastActiveAt: text("last_active_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const trustedDevices = sqliteTable("trusted_devices", {
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
});

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

export const hosts = sqliteTable("ssh_data", {
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
  tags: text("tags"),
  pin: integer("pin", { mode: "boolean" }).notNull().default(false),
  authType: text("auth_type").notNull(),
  useWarpgate: integer("use_warpgate", { mode: "boolean" }).notNull().default(false),
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

  macAddress: text("mac_address"),
  wolBroadcastAddress: text("wol_broadcast_address"),
  portKnockSequence: text("port_knock_sequence"),

  hostKeyFingerprint: text("host_key_fingerprint"),
  hostKeyType: text("host_key_type"),
  hostKeyAlgorithm: text("host_key_algorithm").default("sha256"),
  hostKeyFirstSeen: text("host_key_first_seen"),
  hostKeyLastVerified: text("host_key_last_verified"),
  hostKeyChangedCount: integer("host_key_changed_count").default(0),

  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const fileManagerRecent = sqliteTable("file_manager_recent", {
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
});

export const fileManagerPinned = sqliteTable("file_manager_pinned", {
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
});

export const fileManagerShortcuts = sqliteTable("file_manager_shortcuts", {
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
});

export const transferRecent = sqliteTable("transfer_recent", {
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
});

export const dismissedAlerts = sqliteTable("dismissed_alerts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  alertId: text("alert_id").notNull(),
  dismissedAt: text("dismissed_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const sshCredentials = sqliteTable("ssh_credentials", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  folder: text("folder"),
  tags: text("tags"),
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

  systemPassword: text("system_password"),
  systemKey: text("system_key", { length: 16384 }),
  systemKeyPassword: text("system_key_password"),

  usageCount: integer("usage_count").notNull().default(0),
  lastUsed: text("last_used"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const sshCredentialUsage = sqliteTable("ssh_credential_usage", {
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
});

export const snippets = sqliteTable("snippets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  content: text("content").notNull(),
  description: text("description"),
  folder: text("folder"),
  order: integer("order").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  hostFilter: text("host_filter"),
});

export const snippetFolders = sqliteTable("snippet_folders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color"),
  icon: text("icon"),
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

export const snippetAccess = sqliteTable("snippet_access", {
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
});

export const sshFolders = sqliteTable("ssh_folders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color"),
  icon: text("icon"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const recentActivity = sqliteTable("recent_activity", {
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
});

export const commandHistory = sqliteTable("command_history", {
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
});

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

export const hostAccess = sqliteTable("host_access", {
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
    .default("view"),

  expiresAt: text("expires_at"),

  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  lastAccessedAt: text("last_accessed_at"),
  accessCount: integer("access_count").notNull().default(0),
  overrideCredentialId: integer("override_credential_id").references(
    () => sshCredentials.id,
    { onDelete: "set null" },
  ),
});

export const sharedCredentials = sqliteTable("shared_credentials", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  hostAccessId: integer("host_access_id")
    .notNull()
    .references(() => hostAccess.id, { onDelete: "cascade" }),

  originalCredentialId: integer("original_credential_id")
    .notNull()
    .references(() => sshCredentials.id, { onDelete: "cascade" }),

  targetUserId: text("target_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  encryptedUsername: text("encrypted_username").notNull(),
  encryptedAuthType: text("encrypted_auth_type").notNull(),
  encryptedPassword: text("encrypted_password"),
  encryptedKey: text("encrypted_key", { length: 16384 }),
  encryptedKeyPassword: text("encrypted_key_password"),
  encryptedKeyType: text("encrypted_key_type"),

  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),

  needsReEncryption: integer("needs_re_encryption", { mode: "boolean" })
    .notNull()
    .default(false),
});

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

export const userRoles = sqliteTable("user_roles", {
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
});

export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
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
});

export const sessionRecordings = sqliteTable("session_recordings", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
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

  terminatedByOwner: integer("terminated_by_owner", { mode: "boolean" })
    .default(false),
  terminationReason: text("termination_reason"),
});

export const opksshTokens = sqliteTable("opkssh_tokens", {
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
});

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
export const vaultTokens = sqliteTable("vault_tokens", {
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
});

export const apiKeys = sqliteTable("api_keys", {
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
});

export const userOpenTabs = sqliteTable("user_open_tabs", {
  id: text("id").primaryKey(),
  userId: text("user_id")
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
  compactHostView: integer("compact_host_view", { mode: "boolean" }),
  statusColorScheme: text("status_color_scheme"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const hostMetricsPreferences = sqliteTable("host_metrics_preferences", {
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
});

export const hostHealthChecks = sqliteTable("host_health_checks", {
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
});

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
  createdAt: text("created_at")
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

export const alertFirings = sqliteTable("alert_firings", {
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
  acknowledged: integer("acknowledged", { mode: "boolean" }).notNull().default(false),
});
// --- alerts end ---

// --- homepage begin ---
export const homepageItems = sqliteTable("homepage_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  typeId: text("type_id").notNull(),
  title: text("title"),
  config: text("config").notNull().default("{}"),
  folderId: integer("folder_id"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

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
