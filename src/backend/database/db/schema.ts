import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  password_hash: text("password_hash").notNull(),
  is_admin: integer("is_admin", { mode: "boolean" }).notNull().default(false),

  is_oidc: integer("is_oidc", { mode: "boolean" }).notNull().default(false),
  oidc_identifier: text("oidc_identifier"),
  client_id: text("client_id"),
  client_secret: text("client_secret"),
  issuer_url: text("issuer_url"),
  authorization_url: text("authorization_url"),
  token_url: text("token_url"),
  identifier_path: text("identifier_path"),
  name_path: text("name_path"),
  scopes: text().default("openid email profile"),

  totp_secret: text("totp_secret"),
  totp_enabled: integer("totp_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  totp_backup_codes: text("totp_backup_codes"),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
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

export const sshData = sqliteTable("ssh_data", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name"),
  ip: text("ip").notNull(),
  port: integer("port").notNull(),
  username: text("username").notNull(),
  folder: text("folder"),
  tags: text("tags"),
  pin: integer("pin", { mode: "boolean" }).notNull().default(false),
  authType: text("auth_type").notNull(),
  forceKeyboardInteractive: text("force_keyboard_interactive"),

  password: text("password"),
  key: text("key", { length: 8192 }),
  key_password: text("key_password"),
  keyType: text("key_type"),

  autostartPassword: text("autostart_password"),
  autostartKey: text("autostart_key", { length: 8192 }),
  autostartKeyPassword: text("autostart_key_password"),

  credentialId: integer("credential_id").references(() => sshCredentials.id, { onDelete: "set null" }),
  overrideCredentialUsername: integer("override_credential_username", {
    mode: "boolean",
  }),
  enableTerminal: integer("enable_terminal", { mode: "boolean" })
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
  enableDocker: integer("enable_docker", { mode: "boolean" })
    .notNull()
    .default(false),
  defaultPath: text("default_path"),
  statsConfig: text("stats_config"),
  terminalConfig: text("terminal_config"),
  quickActions: text("quick_actions"),
  notes: text("notes"),

  useSocks5: integer("use_socks5", { mode: "boolean" }),
  socks5Host: text("socks5_host"),
  socks5Port: integer("socks5_port"),
  socks5Username: text("socks5_username"),
  socks5Password: text("socks5_password"),
  socks5ProxyChain: text("socks5_proxy_chain"), // JSON array for proxy chains

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
    .references(() => sshData.id, { onDelete: "cascade" }),
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
    .references(() => sshData.id, { onDelete: "cascade" }),
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
    .references(() => sshData.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  path: text("path").notNull(),
  createdAt: text("created_at")
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
  username: text("username").notNull(),
  password: text("password"),
  key: text("key", { length: 16384 }),
  private_key: text("private_key", { length: 16384 }),
  public_key: text("public_key", { length: 4096 }),
  key_password: text("key_password"),
  keyType: text("key_type"),
  detectedKeyType: text("detected_key_type"),
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
    .references(() => sshData.id, { onDelete: "cascade" }),
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
    .references(() => sshData.id, { onDelete: "cascade" }),
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
    .references(() => sshData.id, { onDelete: "cascade" }),
  command: text("command").notNull(),
  executedAt: text("executed_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// RBAC Phase 1: Host Sharing
export const hostAccess = sqliteTable("host_access", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  hostId: integer("host_id")
    .notNull()
    .references(() => sshData.id, { onDelete: "cascade" }),

  // Share target: either userId OR roleId (at least one must be set)
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" }), // Optional
  roleId: integer("role_id")
    .references(() => roles.id, { onDelete: "cascade" }), // Optional

  grantedBy: text("granted_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  // Permission level
  permissionLevel: text("permission_level")
    .notNull()
    .default("use"), // "view" | "use" | "manage"

  // Time-based access
  expiresAt: text("expires_at"), // NULL = never expires

  // Metadata
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  lastAccessedAt: text("last_accessed_at"),
  accessCount: integer("access_count").notNull().default(0),
});

// RBAC Phase 2: Roles
export const roles = sqliteTable("roles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(), // For i18n
  description: text("description"),

  // System roles cannot be deleted
  isSystem: integer("is_system", { mode: "boolean" })
    .notNull()
    .default(false),

  // Permissions stored as JSON array (optional - used for grouping only in current phase)
  permissions: text("permissions"), // ["hosts.*", "credentials.read", ...] - optional

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

// RBAC Phase 3: Audit Logging
export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  // Who
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  username: text("username").notNull(), // Snapshot in case user deleted

  // What
  action: text("action").notNull(), // "create", "read", "update", "delete", "share"
  resourceType: text("resource_type").notNull(), // "host", "credential", "user", "session"
  resourceId: text("resource_id"), // Can be text or number, store as text
  resourceName: text("resource_name"), // Human-readable identifier

  // Context
  details: text("details"), // JSON: { oldValue, newValue, reason, ... }
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),

  // Result
  success: integer("success", { mode: "boolean" }).notNull(),
  errorMessage: text("error_message"),

  // When
  timestamp: text("timestamp")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const sessionRecordings = sqliteTable("session_recordings", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  hostId: integer("host_id")
    .notNull()
    .references(() => sshData.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accessId: integer("access_id").references(() => hostAccess.id, {
    onDelete: "set null",
  }),

  // Session info
  startedAt: text("started_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  endedAt: text("ended_at"),
  duration: integer("duration"), // seconds

  // Command log (lightweight)
  commands: text("commands"), // JSON: [{ts, cmd, exitCode, blocked}]
  dangerousActions: text("dangerous_actions"), // JSON: blocked commands

  // Full recording (optional, heavy)
  recordingPath: text("recording_path"), // Path to .cast file

  // Metadata
  terminatedByOwner: integer("terminated_by_owner", { mode: "boolean" })
    .default(false),
  terminationReason: text("termination_reason"),
});
