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
  mysqlEnum,
  text,
  varchar,
  int,
  boolean,
  index,
  uniqueIndex,
  foreignKey,
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

  registeredAt: text("registered_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  donationModalDismissed: boolean("donation_modal_dismissed")
    .notNull()
    .default(false),
});

export const settings = mysqlTable("settings", {
  key: varchar("key", { length: 255 }).primaryKey(),
  value: text("value").notNull(),
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
    createdAt: text("created_at")
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
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    expiresAt: text("expires_at").notNull(),
    lastUsedAt: text("last_used_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [index("idx_trusted_devices_user_id").on(table.userId)],
);

/**
 * A sign-in identity from an external provider (OIDC, LDAP, GitHub, ...).
 * Replaces identifier strings like "ldap:<provider>:<id>" on users.
 */
export const userExternalIdentities = mysqlTable(
  "user_external_identities",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerId: varchar("provider_id", { length: 255 }).notNull(),
    /** The provider's id for the user, at most 255 characters. */
    subject: varchar("subject", { length: 255 }).notNull(),
    email: text("email"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex("idx_user_external_identities_provider_subject").on(
      table.providerId,
      table.subject,
    ),
    index("idx_user_external_identities_user").on(table.userId),
  ],
);

/**
 * Which second factors a user enrolled in, by plugin. Kept when the plugin is
 * disabled or removed, so login fails closed instead of skipping the factor.
 */
export const userSecondFactors = mysqlTable(
  "user_second_factors",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pluginId: varchar("plugin_id", { length: 255 }).notNull(),
    factorId: varchar("factor_id", { length: 255 }).notNull(),
    enrolledAt: text("enrolled_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex("idx_user_second_factors_user_factor").on(
      table.userId,
      table.pluginId,
      table.factorId,
    ),
  ],
);

export const hosts = mysqlTable(
  "ssh_data",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectionType: text("connection_type").notNull().default("ssh"),
    name: text("name"),
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
    jumpHosts: text("jump_hosts"),
    statusCheckEnabled: boolean("status_check_enabled")
      .notNull()
      .default(true),
    statusCheckInterval: int("status_check_interval"),
    terminalConfig: text("terminal_config"),
    quickActions: text("quick_actions"),
    notes: text("notes"),
    enableSsh: boolean("enable_ssh").notNull().default(true),

    sshPort: int("ssh_port").default(22),

    rdpCredentialId: int("rdp_credential_id").references(() => sshCredentials.id, { onDelete: "set null" }),
    rdpUser: text("rdp_user"),
    rdpPassword: text("rdp_password"),
    rdpDomain: text("rdp_domain"),

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
    // Desktop only: a host kept on this device that never goes to the server.
    localOnly: boolean("local_only").notNull().default(false),
    // Desktop only: set on the read-only copy of a host someone shared with
    // the linked account. JSON with the share's owner and permission level.
    sharedSource: text("shared_source"),

    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at")
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


export const sshCredentials = mysqlTable(
  "ssh_credentials",
  {
  id: int("id").autoincrement().primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
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
  sharedSource: text("shared_source"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at")
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

export const sshFolders = mysqlTable(
  "ssh_folders",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color"),
    icon: text("icon"),
    credentialId: int("credential_id").references(() => sshCredentials.id, {
      onDelete: "set null",
    }),
    // Manual drag-to-reorder position among sibling folders. Null falls back
    // to name sort, same convention as hosts.sortOrder.
    sortOrder: int("sort_order"),
    syncId: varchar("sync_id", { length: 255 }).unique(),
    localOnly: boolean("local_only").notNull().default(false),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at")
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

    createdAt: text("created_at")
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
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at")
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

    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at")
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

  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at")
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

export const apiKeys = mysqlTable(
  "api_keys",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
    expiresAt: text("expires_at"),
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
    label: text("label").notNull(),
    tabOrder: int("tab_order").notNull().default(0),
    backendSessionId: text("backend_session_id"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at")
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
  showPinAppRailButton: boolean("show_pin_app_rail_button"),
  foldersCollapsed: boolean("folders_collapsed"),
  confirmSnippetExecution: boolean("confirm_snippet_execution"),
  disableUpdateCheck: boolean("disable_update_check"),
  confirmTabClose: boolean("confirm_tab_close"),
  hiddenRailTabs: text("hidden_rail_tabs"),
  compactHostView: boolean("compact_host_view"),
  statusColorScheme: text("status_color_scheme"),
  customThemes: text("custom_themes"),
  customKeybindings: text("custom_keybindings"),
  terminalDefaults: text("terminal_defaults"),
  terminalMacros: text("terminal_macros"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export const hostSidebarPreferences = mysqlTable("host_sidebar_preferences", {
  userId: varchar("user_id", { length: 255 })
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  // JSON-encoded HostSidebarPreferences. No secrets in this blob, stored as
  // plain JSON.
  data: text("data").notNull(),
  updatedAt: text("updated_at")
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
    updatedAt: text("updated_at")
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
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

// --- sync begin ---
/**
 * One row per synced record a user owns, on both ends of a sync link.
 *
 * On a server, revision counts the record's changes and seq is the position
 * in the user's change feed, which is what a desktop's cursor points at. On a
 * linked desktop, revision is the last server revision this device saw and
 * hash is what the record looked like then, so a different hash now means a
 * local edit waiting to be pushed.
 */
export const syncRecords = mysqlTable(
  "sync_records",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityType: varchar("entity_type", { length: 255 }).notNull(),
    syncId: varchar("sync_id", { length: 255 }).notNull(),
    revision: int("revision").notNull().default(0),
    seq: int("seq").notNull().default(0),
    hash: text("hash"),
    deleted: boolean("deleted").notNull().default(false),
    // Desktop only: why the server refused the last push of this record, and
    // the hash that was refused, so the same content is not re-sent forever.
    error: text("error"),
    errorHash: text("error_hash"),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex("idx_sync_records_user_entity_sync").on(
      table.userId,
      table.entityType,
      table.syncId,
    ),
    index("idx_sync_records_user_seq").on(table.userId, table.seq),
  ],
);

/**
 * Desktop only: a local edit that lost to a newer server edit. The server
 * version was applied; this keeps the local one so the user can pick it.
 */
export const syncConflicts = mysqlTable(
  "sync_conflicts",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    syncId: text("sync_id").notNull(),
    localRow: text("local_row").notNull(),
    serverRevision: int("server_revision").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [index("idx_sync_conflicts_user").on(table.userId)],
);

/**
 * Desktop only: the server this install is linked to. One row at most.
 * Secrets (session token, proxy headers, basic auth) are encrypted with the
 * system key.
 */
export const syncLink = mysqlTable("sync_link", {
  id: int("id").autoincrement().primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  serverUrl: text("server_url").notNull(),
  serverName: text("server_name"),
  serverVersion: text("server_version"),
  sessionToken: text("session_token"),
  customHeaders: text("custom_headers"),
  basicAuth: text("basic_auth"),
  allowInvalidCertificate: boolean("allow_invalid_certificate")
    .notNull()
    .default(false),
  remoteUserId: text("remote_user_id"),
  remoteUsername: text("remote_username"),
  // The linked account as the server describes it: roles, admin, permissions.
  account: text("account"),
  scope: text("scope"),
  knownTypes: text("known_types"),
  cursor: int("cursor").notNull().default(0),
  status: text("status").notNull().default("idle"),
  lastError: text("last_error"),
  linkedAt: text("linked_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  lastSyncAt: text("last_sync_at"),
});
// --- sync end ---

// --- credential sharing ---

/**
 * Who may use or manage someone else's credential. "use" attaches it to
 * hosts and connects, "manage" also edits and re-shares it.
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

    expiresAt: text("expires_at"),

    createdAt: text("created_at")
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
    credentialAccessId: int("credential_access_id").notNull(),
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

    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    foreignKey({
      columns: [table.credentialAccessId],
      foreignColumns: [credentialAccess.id],
      name: "shared_cred_secrets_access_id_fk",
    }).onDelete("cascade"),
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

// --- folder access rules ---

/**
 * A standing share on a host folder. Sharing a folder fans out host_access
 * grants to the hosts in it today; this row is what makes hosts created in
 * or moved into the folder later inherit the same access.
 */
export const folderAccess = mysqlTable(
  "folder_access",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerUserId: varchar("owner_user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The folder path as stored on hosts ("Parent / Child"); subfolders inherit.
    folder: varchar("folder", { length: 255 }).notNull(),

    userId: varchar("user_id", { length: 255 }).references(() => users.id, { onDelete: "cascade" }),
    roleId: int("role_id").references(() => roles.id, {
      onDelete: "cascade",
    }),

    grantedBy: varchar("granted_by", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    permissionLevel: text("permission_level").notNull().default("connect"),
    expiresAt: text("expires_at"),

    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    index("idx_folder_access_owner_folder").on(table.ownerUserId, table.folder),
  ],
);

// --- plugins begin ---

/**
 * An installed plugin. id matches the manifest's own id (not autoincrement),
 * so a plugin can be looked up the same way the manifest and registry refer
 * to it. manifest_json is the full manifest as it was at install time, kept
 * for audit/rollback even after a registry updates or removes the entry.
 */
export const plugins = mysqlTable(
  "plugins",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    name: text("name").notNull(),
    version: text("version").notNull(),
    tier: text("tier").notNull().default("available"),
    source: text("source").notNull().default("community"),
    registryId: varchar("registry_id", { length: 255 }),
    /** enabled | disabled | blocked | failed */
    state: text("state").notNull().default("disabled"),
    /** Why the plugin is blocked or failed, for the admin UI. */
    lastError: text("last_error"),
    installedAt: text("installed_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    autoUpdate: boolean("auto_update")
      .notNull()
      .default(false),
    manifestJson: text("manifest_json").notNull(),
  },
  (table) => [index("idx_plugins_registry_id").on(table.registryId)],
);

export const pluginPermissionGrants = mysqlTable(
  "plugin_permission_grants",
  {
    id: int("id").autoincrement().primaryKey(),
    pluginId: varchar("plugin_id", { length: 255 })
      .notNull()
      .references(() => plugins.id, { onDelete: "cascade" }),
    capability: varchar("capability", { length: 255 }).notNull(),
    grantedAt: text("granted_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    /**
     * Who granted it. Null for a bundled grant, which no user made: shipping
     * in the install is the consent. Nullable also stops a user deletion from
     * cascading a bundled plugin's capabilities away.
     */
    grantedBy: varchar("granted_by", { length: 255 }).references(() => users.id, {
      onDelete: "cascade",
    }),
    /** admin | bundled */
    source: text("source").notNull().default("admin"),
  },
  // A plugin's grants are always read together, and re-granting the same
  // capability should update the existing row rather than duplicate it.
  (table) => [
    uniqueIndex("idx_plugin_permission_grants_plugin_capability").on(
      table.pluginId,
      table.capability,
    ),
  ],
);

export const pluginRegistries = mysqlTable("plugin_registries", {
  id: varchar("id", { length: 255 }).primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  kind: text("kind").notNull().default("community"),
  enabled: boolean("enabled").notNull().default(true),
  signingKey: text("signing_key"),
  lastCheckedAt: text("last_checked_at"),
  lastIndexHash: text("last_index_hash"),
});

/**
 * Install counts populated by a background job (GitHub release download
 * counts, aggregated telemetry, or a manual override) rather than by the
 * install/uninstall actions themselves — kept separate from `plugins` so
 * that job can overwrite counts without touching install state.
 */
export const pluginInstallCounts = mysqlTable(
  "plugin_install_counts",
  {
    id: int("id").autoincrement().primaryKey(),
    pluginId: varchar("plugin_id", { length: 255 }).notNull(),
    registryId: varchar("registry_id", { length: 255 }).notNull(),
    count: int("count").notNull().default(0),
    source: text("source").notNull().default("aggregate-telemetry"),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex("idx_plugin_install_counts_plugin_registry").on(
      table.pluginId,
      table.registryId,
    ),
  ],
);

/**
 * Per-plugin key/value state, written through ctx.storage. Rows are always
 * scoped to the calling plugin by the broker, so a plugin cannot name another
 * plugin's scope. Cascades with the plugin so uninstalling leaves nothing.
 */
export const pluginStorage = mysqlTable(
  "plugin_storage",
  {
    id: int("id").autoincrement().primaryKey(),
    pluginId: varchar("plugin_id", { length: 255 })
      .notNull()
      .references(() => plugins.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 255 }).notNull(),
    value: text("value").notNull(),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex("idx_plugin_storage_plugin_key").on(table.pluginId, table.key),
  ],
);

/**
 * Values for the settings fields a plugin declares in contributes.settings.
 *
 * scope_id is polymorphic: null for admin scope, a user id for user scope, a
 * host id rendered as text for host scope. That is why it carries no foreign
 * key - one column cannot point at two tables - so the user and host delete
 * paths remove these rows explicitly. Cascading with the plugin is a real FK,
 * because uninstalling should leave nothing behind.
 *
 * Secret fields are encrypted with the system key before they land here, and
 * `encrypted` records which rows that applies to so a read knows to decrypt.
 */
export const pluginSettings = mysqlTable(
  "plugin_settings",
  {
    id: int("id").autoincrement().primaryKey(),
    pluginId: varchar("plugin_id", { length: 255 })
      .notNull()
      .references(() => plugins.id, { onDelete: "cascade" }),
    scope: mysqlEnum("scope", ["admin", "user", "host", "secret"]).notNull(),
    scopeId: varchar("scope_id", { length: 255 }),
    key: varchar("key", { length: 255 }).notNull(),
    /** JSON-encoded, so a field keeps its declared type across a round trip. */
    value: text("value"),
    encrypted: boolean("encrypted")
      .notNull()
      .default(false),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex("idx_plugin_settings_scope_key").on(
      table.pluginId,
      table.scope,
      table.scopeId,
      table.key,
    ),
    index("idx_plugin_settings_plugin_scope").on(table.pluginId, table.scope),
  ],
);

/**
 * Which of a plugin's migrations have been applied.
 *
 * The checksum is what makes an already-applied migration immutable: editing
 * one that has run blocks that plugin rather than silently leaving two
 * databases with different shapes. Cascades with the plugin so removing its
 * data leaves no ledger behind.
 */
export const pluginMigrations = mysqlTable(
  "plugin_migrations",
  {
    id: int("id").autoincrement().primaryKey(),
    pluginId: varchar("plugin_id", { length: 255 })
      .notNull()
      .references(() => plugins.id, { onDelete: "cascade" }),
    migrationId: varchar("migration_id", { length: 255 }).notNull(),
    checksum: text("checksum").notNull(),
    appliedAt: text("applied_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex("idx_plugin_migrations_plugin_migration").on(
      table.pluginId,
      table.migrationId,
    ),
  ],
);

// --- plugins end ---

// --- rbac plugin permissions begin ---

/**
 * Every role permission core has ever registered.
 *
 * Deliberately has no foreign key to `plugins`: the whole point is that a role
 * keeps working when the plugin that contributed a permission is disabled or
 * uninstalled. Without this, unregistering a group made PUT /rbac/roles/:id
 * reject the entire role.
 */
export const rbacKnownPermissions = mysqlTable(
  "rbac_known_permissions",
  {
    id: int("id").autoincrement().primaryKey(),
    permission: varchar("permission", { length: 255 }).notNull(),
    /** Which plugin contributed it, or null for a core permission. */
    pluginId: text("plugin_id"),
    firstSeenAt: text("first_seen_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex("idx_rbac_known_permissions_permission").on(table.permission),
  ],
);

/**
 * Which plugin role defaults have already been applied.
 *
 * Applying a default is a one-time suggestion, so an admin who revokes it does
 * not get it handed back on the next restart. This lived in `plugin_storage`,
 * which cascades with the plugin, so uninstall-then-reinstall silently re-added
 * a permission that had been deliberately removed.
 */
export const rbacAppliedDefaults = mysqlTable(
  "rbac_applied_defaults",
  {
    id: int("id").autoincrement().primaryKey(),
    roleName: varchar("role_name", { length: 255 }).notNull(),
    permission: varchar("permission", { length: 255 }).notNull(),
    appliedAt: text("applied_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex("idx_rbac_applied_defaults_role_permission").on(
      table.roleName,
      table.permission,
    ),
  ],
);

// --- rbac plugin permissions end ---
