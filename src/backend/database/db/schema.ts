import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  foreignKey,
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

/**
 * A sign-in identity from an external provider (OIDC, LDAP, GitHub, ...).
 * Replaces identifier strings like "ldap:<provider>:<id>" on users.
 */
export const userExternalIdentities = sqliteTable(
  "user_external_identities",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    /** The provider's id for the user, at most 255 characters. */
    subject: text("subject").notNull(),
    email: text("email"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
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
export const userSecondFactors = sqliteTable(
  "user_second_factors",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pluginId: text("plugin_id").notNull(),
    factorId: text("factor_id").notNull(),
    enrolledAt: text("enrolled_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_user_second_factors_user_factor").on(
      table.userId,
      table.pluginId,
      table.factorId,
    ),
  ],
);

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
    jumpHosts: text("jump_hosts"),
    statusCheckEnabled: integer("status_check_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    statusCheckInterval: integer("status_check_interval"),
    terminalConfig: text("terminal_config"),
    quickActions: text("quick_actions"),
    notes: text("notes"),
    enableSsh: integer("enable_ssh", { mode: "boolean" }).notNull().default(true),

    sshPort: integer("ssh_port").default(22),

    rdpCredentialId: integer("rdp_credential_id").references(() => sshCredentials.id, { onDelete: "set null" }),
    rdpUser: text("rdp_user"),
    rdpPassword: text("rdp_password"),
    rdpDomain: text("rdp_domain"),

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

// file_manager_recent, file_manager_pinned, file_manager_shortcuts and
// transfer_recent moved to the file-manager plugin (p_file_manager_*).

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
  showPinAppRailButton: integer("show_pin_app_rail_button", {
    mode: "boolean",
  }),
  foldersCollapsed: integer("folders_collapsed", { mode: "boolean" }),
  confirmSnippetExecution: integer("confirm_snippet_execution", { mode: "boolean" }),
  disableUpdateCheck: integer("disable_update_check", { mode: "boolean" }),
  confirmTabClose: integer("confirm_tab_close", { mode: "boolean" }),
  hiddenRailTabs: text("hidden_rail_tabs"),
  compactHostView: integer("compact_host_view", { mode: "boolean" }),
  statusColorScheme: text("status_color_scheme"),
  customThemes: text("custom_themes"),
  customKeybindings: text("custom_keybindings"),
  terminalDefaults: text("terminal_defaults"),
  terminalMacros: text("terminal_macros"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const hostSidebarPreferences = sqliteTable("host_sidebar_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  // JSON-encoded HostSidebarPreferences. No secrets in this blob, stored as
  // plain JSON.
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

// dashboard_service_links moved to the homepage plugin (p_homepage_dashboard_service_links).

// termix_identities, termix_identity_keys and termix_identity_ca moved to the
// termix-identity plugin (p_termix_identity_*).

// --- alerts begin ---
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
// --- alerts end ---


// homepage_items and homepage_layouts moved to the homepage plugin
// (p_homepage_homepage_items, p_homepage_homepage_layouts).



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

// --- collab rooms ---

// --- credential sharing ---

/**
 * Who may use or manage someone else's credential. Same shape as
 * snippet_access; "use" attaches it to hosts and connects, "manage" also
 * edits and re-shares it.
 */
export const credentialAccess = sqliteTable(
  "credential_access",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    credentialId: integer("credential_id")
      .notNull()
      .references(() => sshCredentials.id, { onDelete: "cascade" }),

    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    roleId: integer("role_id").references(() => roles.id, {
      onDelete: "cascade",
    }),

    grantedBy: text("granted_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    permissionLevel: text("permission_level").notNull().default("use"),

    expiresAt: text("expires_at"),

    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
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
export const sharedCredentialSecrets = sqliteTable(
  "shared_credential_secrets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    credentialAccessId: integer("credential_access_id").notNull(),
    targetUserId: text("target_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialId: integer("credential_id")
      .notNull()
      .references(() => sshCredentials.id, { onDelete: "cascade" }),

    encryptedUsername: text("encrypted_username"),
    authType: text("auth_type").notNull().default("password"),
    encryptedPassword: text("encrypted_password"),
    encryptedKey: text("encrypted_key", { length: 16384 }),
    encryptedKeyPassword: text("encrypted_key_password"),
    keyType: text("key_type"),
    publicKey: text("public_key", { length: 4096 }),
    certPublicKey: text("cert_public_key", { length: 8192 }),

    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
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
export const folderAccess = sqliteTable(
  "folder_access",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The folder path as stored on hosts ("Parent / Child"); subfolders inherit.
    folder: text("folder").notNull(),

    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    roleId: integer("role_id").references(() => roles.id, {
      onDelete: "cascade",
    }),

    grantedBy: text("granted_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    permissionLevel: text("permission_level").notNull().default("connect"),
    expiresAt: text("expires_at"),

    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
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
export const plugins = sqliteTable(
  "plugins",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    version: text("version").notNull(),
    tier: text("tier").notNull().default("available"),
    source: text("source").notNull().default("community"),
    registryId: text("registry_id"),
    /** enabled | disabled | blocked | failed */
    state: text("state").notNull().default("disabled"),
    /** Why the plugin is blocked or failed, for the admin UI. */
    lastError: text("last_error"),
    installedAt: text("installed_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    autoUpdate: integer("auto_update", { mode: "boolean" })
      .notNull()
      .default(false),
    manifestJson: text("manifest_json").notNull(),
  },
  (table) => [index("idx_plugins_registry_id").on(table.registryId)],
);

export const pluginPermissionGrants = sqliteTable(
  "plugin_permission_grants",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    pluginId: text("plugin_id")
      .notNull()
      .references(() => plugins.id, { onDelete: "cascade" }),
    capability: text("capability").notNull(),
    grantedAt: text("granted_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    /**
     * Who granted it. Null for a bundled grant, which no user made: shipping
     * in the install is the consent. Nullable also stops a user deletion from
     * cascading a bundled plugin's capabilities away.
     */
    grantedBy: text("granted_by").references(() => users.id, {
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

export const pluginRegistries = sqliteTable("plugin_registries", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  kind: text("kind").notNull().default("community"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
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
export const pluginInstallCounts = sqliteTable(
  "plugin_install_counts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    pluginId: text("plugin_id").notNull(),
    registryId: text("registry_id").notNull(),
    count: integer("count").notNull().default(0),
    source: text("source").notNull().default("aggregate-telemetry"),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
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
export const pluginStorage = sqliteTable(
  "plugin_storage",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    pluginId: text("plugin_id")
      .notNull()
      .references(() => plugins.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
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
export const pluginSettings = sqliteTable(
  "plugin_settings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    pluginId: text("plugin_id")
      .notNull()
      .references(() => plugins.id, { onDelete: "cascade" }),
    /** admin | user | host */
    scope: text("scope").notNull(),
    scopeId: text("scope_id"),
    key: text("key").notNull(),
    /** JSON-encoded, so a field keeps its declared type across a round trip. */
    value: text("value"),
    encrypted: integer("encrypted", { mode: "boolean" })
      .notNull()
      .default(false),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
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
export const pluginMigrations = sqliteTable(
  "plugin_migrations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    pluginId: text("plugin_id")
      .notNull()
      .references(() => plugins.id, { onDelete: "cascade" }),
    migrationId: text("migration_id").notNull(),
    checksum: text("checksum").notNull(),
    appliedAt: text("applied_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
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
export const rbacKnownPermissions = sqliteTable(
  "rbac_known_permissions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    permission: text("permission").notNull(),
    /** Which plugin contributed it, or null for a core permission. */
    pluginId: text("plugin_id"),
    firstSeenAt: text("first_seen_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
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
export const rbacAppliedDefaults = sqliteTable(
  "rbac_applied_defaults",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roleName: text("role_name").notNull(),
    permission: text("permission").notNull(),
    appliedAt: text("applied_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_rbac_applied_defaults_role_permission").on(
      table.roleName,
      table.permission,
    ),
  ],
);

// --- rbac plugin permissions end ---
