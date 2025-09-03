import {sqliteTable, text, integer} from 'drizzle-orm/sqlite-core';
import {sql} from 'drizzle-orm';

export const users = sqliteTable('users', {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    password_hash: text('password_hash').notNull(),
    is_admin: integer('is_admin', {mode: 'boolean'}).notNull().default(false),

    is_oidc: integer('is_oidc', {mode: 'boolean'}).notNull().default(false),
    oidc_identifier: text('oidc_identifier'),
    client_id: text('client_id'),
    client_secret: text('client_secret'),
    issuer_url: text('issuer_url'),
    authorization_url: text('authorization_url'),
    token_url: text('token_url'),
    identifier_path: text('identifier_path'),
    name_path: text('name_path'),
    scopes: text().default("openid email profile"),

    totp_secret: text('totp_secret'),
    totp_enabled: integer('totp_enabled', {mode: 'boolean'}).notNull().default(false),
    totp_backup_codes: text('totp_backup_codes'),
});

export const settings = sqliteTable('settings', {
    key: text('key').primaryKey(),
    value: text('value').notNull(),
});

export const sshData = sqliteTable('ssh_data', {
    id: integer('id').primaryKey({autoIncrement: true}),
    userId: text('user_id').notNull().references(() => users.id),
    name: text('name'),
    ip: text('ip').notNull(),
    port: integer('port').notNull(),
    username: text('username').notNull(),
    folder: text('folder'),
    tags: text('tags'),
    pin: integer('pin', {mode: 'boolean'}).notNull().default(false),
    authType: text('auth_type').notNull(),
    password: text('password'),
    key: text('key', {length: 8192}),
    keyPassword: text('key_password'),
    keyType: text('key_type'),
    enableTerminal: integer('enable_terminal', {mode: 'boolean'}).notNull().default(true),
    enableTunnel: integer('enable_tunnel', {mode: 'boolean'}).notNull().default(true),
    tunnelConnections: text('tunnel_connections'),
    enableFileManager: integer('enable_file_manager', {mode: 'boolean'}).notNull().default(true),
    defaultPath: text('default_path'),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const fileManagerRecent = sqliteTable('file_manager_recent', {
    id: integer('id').primaryKey({autoIncrement: true}),
    userId: text('user_id').notNull().references(() => users.id),
    hostId: integer('host_id').notNull().references(() => sshData.id),
    name: text('name').notNull(),
    path: text('path').notNull(),
    lastOpened: text('last_opened').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const fileManagerPinned = sqliteTable('file_manager_pinned', {
    id: integer('id').primaryKey({autoIncrement: true}),
    userId: text('user_id').notNull().references(() => users.id),
    hostId: integer('host_id').notNull().references(() => sshData.id),
    name: text('name').notNull(),
    path: text('path').notNull(),
    pinnedAt: text('pinned_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const fileManagerShortcuts = sqliteTable('file_manager_shortcuts', {
    id: integer('id').primaryKey({autoIncrement: true}),
    userId: text('user_id').notNull().references(() => users.id),
    hostId: integer('host_id').notNull().references(() => sshData.id),
    name: text('name').notNull(),
    path: text('path').notNull(),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const dismissedAlerts = sqliteTable('dismissed_alerts', {
    id: integer('id').primaryKey({autoIncrement: true}),
    userId: text('user_id').notNull().references(() => users.id),
    alertId: text('alert_id').notNull(),
    dismissedAt: text('dismissed_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});