import {drizzle} from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema.js';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { MigrationManager } from '../migrations/migrator.js';

const dbIconSymbol = '🗄️';
const getTimeStamp = (): string => chalk.gray(`[${new Date().toLocaleTimeString()}]`);
const formatMessage = (level: string, colorFn: chalk.Chalk, message: string): string => {
    return `${getTimeStamp()} ${colorFn(`[${level.toUpperCase()}]`)} ${chalk.hex('#1e3a8a')(`[${dbIconSymbol}]`)} ${message}`;
};
const logger = {
    info: (msg: string): void => {
        console.log(formatMessage('info', chalk.cyan, msg));
    },
    warn: (msg: string): void => {
        console.warn(formatMessage('warn', chalk.yellow, msg));
    },
    error: (msg: string, err?: unknown): void => {
        console.error(formatMessage('error', chalk.redBright, msg));
        if (err) console.error(err);
    },
    success: (msg: string): void => {
        console.log(formatMessage('success', chalk.greenBright, msg));
    },
    debug: (msg: string): void => {
        if (process.env.NODE_ENV !== 'production') {
            console.debug(formatMessage('debug', chalk.magenta, msg));
        }
    }
};

const dataDir = process.env.DATA_DIR || './db/data';
const dbDir = path.resolve(dataDir);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, {recursive: true});
}

const dbPath = path.join(dataDir, 'db.sqlite');
const sqlite = new Database(dbPath);

sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users
    (
        id
        TEXT
        PRIMARY
        KEY,
        username
        TEXT
        NOT
        NULL,
        password_hash
        TEXT
        NOT
        NULL,
        is_admin
        INTEGER
        NOT
        NULL
        DEFAULT
        0,

        is_oidc
        INTEGER
        NOT
        NULL
        DEFAULT
        0,
        client_id
        TEXT
        NOT
        NULL,
        client_secret
        TEXT
        NOT
        NULL,
        issuer_url
        TEXT
        NOT
        NULL,
        authorization_url
        TEXT
        NOT
        NULL,
        token_url
        TEXT
        NOT
        NULL,
        redirect_uri
        TEXT,
        identifier_path
        TEXT
        NOT
        NULL,
        name_path
        TEXT
        NOT
        NULL,
        scopes
        TEXT
        NOT
        NULL
    );

    CREATE TABLE IF NOT EXISTS settings
    (
        key
        TEXT
        PRIMARY
        KEY,
        value
        TEXT
        NOT
        NULL
    );

    CREATE TABLE IF NOT EXISTS ssh_data
    (
        id
        INTEGER
        PRIMARY
        KEY
        AUTOINCREMENT,
        user_id
        TEXT
        NOT
        NULL,
        name
        TEXT,
        ip
        TEXT
        NOT
        NULL,
        port
        INTEGER
        NOT
        NULL,
        username
        TEXT
        NOT
        NULL,
        folder
        TEXT,
        tags
        TEXT,
        pin
        INTEGER
        NOT
        NULL
        DEFAULT
        0,
        auth_type
        TEXT
        NOT
        NULL,
        password
        TEXT,
        key
        TEXT,
        key_password
        TEXT,
        key_type
        TEXT,
        enable_terminal
        INTEGER
        NOT
        NULL
        DEFAULT
        1,
        enable_tunnel
        INTEGER
        NOT
        NULL
        DEFAULT
        1,
        tunnel_connections
        TEXT,
        enable_file_manager
        INTEGER
        NOT
        NULL
        DEFAULT
        1,
        default_path
        TEXT,
        created_at
        TEXT
        NOT
        NULL
        DEFAULT
        CURRENT_TIMESTAMP,
        updated_at
        TEXT
        NOT
        NULL
        DEFAULT
        CURRENT_TIMESTAMP,
        FOREIGN
        KEY
    (
        user_id
    ) REFERENCES users
    (
        id
    )
        );

    CREATE TABLE IF NOT EXISTS file_manager_recent
    (
        id
        INTEGER
        PRIMARY
        KEY
        AUTOINCREMENT,
        user_id
        TEXT
        NOT
        NULL,
        host_id
        INTEGER
        NOT
        NULL,
        name
        TEXT
        NOT
        NULL,
        path
        TEXT
        NOT
        NULL,
        last_opened
        TEXT
        NOT
        NULL
        DEFAULT
        CURRENT_TIMESTAMP,
        FOREIGN
        KEY
    (
        user_id
    ) REFERENCES users
    (
        id
    ),
        FOREIGN KEY
    (
        host_id
    ) REFERENCES ssh_data
    (
        id
    )
        );

    CREATE TABLE IF NOT EXISTS file_manager_pinned
    (
        id
        INTEGER
        PRIMARY
        KEY
        AUTOINCREMENT,
        user_id
        TEXT
        NOT
        NULL,
        host_id
        INTEGER
        NOT
        NULL,
        name
        TEXT
        NOT
        NULL,
        path
        TEXT
        NOT
        NULL,
        pinned_at
        TEXT
        NOT
        NULL
        DEFAULT
        CURRENT_TIMESTAMP,
        FOREIGN
        KEY
    (
        user_id
    ) REFERENCES users
    (
        id
    ),
        FOREIGN KEY
    (
        host_id
    ) REFERENCES ssh_data
    (
        id
    )
        );

    CREATE TABLE IF NOT EXISTS file_manager_shortcuts
    (
        id
        INTEGER
        PRIMARY
        KEY
        AUTOINCREMENT,
        user_id
        TEXT
        NOT
        NULL,
        host_id
        INTEGER
        NOT
        NULL,
        name
        TEXT
        NOT
        NULL,
        path
        TEXT
        NOT
        NULL,
        created_at
        TEXT
        NOT
        NULL
        DEFAULT
        CURRENT_TIMESTAMP,
        FOREIGN
        KEY
    (
        user_id
    ) REFERENCES users
    (
        id
    ),
        FOREIGN KEY
    (
        host_id
    ) REFERENCES ssh_data
    (
        id
    )
        );

    CREATE TABLE IF NOT EXISTS dismissed_alerts
    (
        id
        INTEGER
        PRIMARY
        KEY
        AUTOINCREMENT,
        user_id
        TEXT
        NOT
        NULL,
        alert_id
        TEXT
        NOT
        NULL,
        dismissed_at
        TEXT
        NOT
        NULL
        DEFAULT
        CURRENT_TIMESTAMP,
        FOREIGN
        KEY
    (
        user_id
    ) REFERENCES users
    (
        id
    )
        );
`);

const addColumnIfNotExists = (table: string, column: string, definition: string) => {
    try {
        sqlite.prepare(`SELECT ${column}
                        FROM ${table} LIMIT 1`).get();
    } catch (e) {
        try {
            sqlite.exec(`ALTER TABLE ${table}
                ADD COLUMN ${column} ${definition};`);
        } catch (alterError) {
            logger.warn(`Failed to add column ${column} to ${table}: ${alterError}`);
        }
    }
};

const migrateSchema = () => {
    logger.info('Checking for schema updates...');

    addColumnIfNotExists('users', 'is_admin', 'INTEGER NOT NULL DEFAULT 0');

    addColumnIfNotExists('users', 'is_oidc', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfNotExists('users', 'oidc_identifier', 'TEXT');
    addColumnIfNotExists('users', 'client_id', 'TEXT');
    addColumnIfNotExists('users', 'client_secret', 'TEXT');
    addColumnIfNotExists('users', 'issuer_url', 'TEXT');
    addColumnIfNotExists('users', 'authorization_url', 'TEXT');
    addColumnIfNotExists('users', 'token_url', 'TEXT');
    try {
        sqlite.prepare(`ALTER TABLE users DROP COLUMN redirect_uri`).run();
    } catch (e) {
    }

    addColumnIfNotExists('users', 'identifier_path', 'TEXT');
    addColumnIfNotExists('users', 'name_path', 'TEXT');
    addColumnIfNotExists('users', 'scopes', 'TEXT');

    addColumnIfNotExists('users', 'totp_secret', 'TEXT');
    addColumnIfNotExists('users', 'totp_enabled', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfNotExists('users', 'totp_backup_codes', 'TEXT');

    addColumnIfNotExists('ssh_data', 'name', 'TEXT');
    addColumnIfNotExists('ssh_data', 'folder', 'TEXT');
    addColumnIfNotExists('ssh_data', 'tags', 'TEXT');
    addColumnIfNotExists('ssh_data', 'pin', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfNotExists('ssh_data', 'auth_type', 'TEXT NOT NULL DEFAULT "password"');
    addColumnIfNotExists('ssh_data', 'password', 'TEXT');
    addColumnIfNotExists('ssh_data', 'key', 'TEXT');
    addColumnIfNotExists('ssh_data', 'key_password', 'TEXT');
    addColumnIfNotExists('ssh_data', 'key_type', 'TEXT');
    addColumnIfNotExists('ssh_data', 'enable_terminal', 'INTEGER NOT NULL DEFAULT 1');
    addColumnIfNotExists('ssh_data', 'enable_tunnel', 'INTEGER NOT NULL DEFAULT 1');
    addColumnIfNotExists('ssh_data', 'tunnel_connections', 'TEXT');
    addColumnIfNotExists('ssh_data', 'enable_file_manager', 'INTEGER NOT NULL DEFAULT 1');
    addColumnIfNotExists('ssh_data', 'default_path', 'TEXT');
    addColumnIfNotExists('ssh_data', 'created_at', 'TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP');
    addColumnIfNotExists('ssh_data', 'updated_at', 'TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP');
    
    // Add credential_id column for SSH credentials management
    addColumnIfNotExists('ssh_data', 'credential_id', 'INTEGER REFERENCES ssh_credentials(id)');

    addColumnIfNotExists('file_manager_recent', 'host_id', 'INTEGER NOT NULL');
    addColumnIfNotExists('file_manager_pinned', 'host_id', 'INTEGER NOT NULL');
    addColumnIfNotExists('file_manager_shortcuts', 'host_id', 'INTEGER NOT NULL');

    logger.success('Schema migration completed');
};

const initializeDatabase = async () => {
    migrateSchema();

    // Run new migration system
    const migrationManager = new MigrationManager(sqlite);
    await migrationManager.runMigrations();

    try {
        const row = sqlite.prepare("SELECT value FROM settings WHERE key = 'allow_registration'").get();
        if (!row) {
            sqlite.prepare("INSERT INTO settings (key, value) VALUES ('allow_registration', 'true')").run();
        }
    } catch (e) {
        logger.warn('Could not initialize default settings');
    }
};

// Initialize database (async)
initializeDatabase().catch(error => {
    logger.error('Failed to initialize database:', error);
    process.exit(1);
});

export const db = drizzle(sqlite, {schema});