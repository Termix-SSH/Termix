import type { Database } from 'better-sqlite3';

export const up = (db: Database) => {
    // Create SSH credentials table
    db.exec(`
        CREATE TABLE IF NOT EXISTS ssh_credentials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL REFERENCES users(id),
            name TEXT NOT NULL,
            description TEXT,
            folder TEXT,
            tags TEXT,
            auth_type TEXT NOT NULL,
            username TEXT NOT NULL,
            encrypted_password TEXT,
            encrypted_key TEXT,
            encrypted_key_password TEXT,
            key_type TEXT,
            usage_count INTEGER NOT NULL DEFAULT 0,
            last_used TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Create credential usage tracking table
    db.exec(`
        CREATE TABLE IF NOT EXISTS ssh_credential_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            credential_id INTEGER NOT NULL REFERENCES ssh_credentials(id),
            host_id INTEGER NOT NULL REFERENCES ssh_data(id),
            user_id TEXT NOT NULL REFERENCES users(id),
            used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Add credential_id column to ssh_data table if it doesn't exist
    const columns = db.prepare(`PRAGMA table_info(ssh_data)`).all();
    const hasCredentialId = columns.some((col: any) => col.name === 'credential_id');
    
    if (!hasCredentialId) {
        db.exec(`
            ALTER TABLE ssh_data 
            ADD COLUMN credential_id INTEGER REFERENCES ssh_credentials(id)
        `);
    }

    // Create indexes for better performance
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ssh_credentials_user_id ON ssh_credentials(user_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ssh_credentials_folder ON ssh_credentials(folder)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ssh_credential_usage_credential_id ON ssh_credential_usage(credential_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ssh_credential_usage_host_id ON ssh_credential_usage(host_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ssh_data_credential_id ON ssh_data(credential_id)`);

    console.log('✅ Added SSH credentials management tables');
};

export const down = (db: Database) => {
    // Remove credential_id column from ssh_data table
    db.exec(`
        CREATE TABLE ssh_data_backup AS SELECT 
            id, user_id, name, ip, port, username, folder, tags, pin, auth_type,
            password, key, key_password, key_type, enable_terminal, enable_tunnel,
            tunnel_connections, enable_file_manager, default_path, created_at, updated_at
        FROM ssh_data
    `);
    
    db.exec(`DROP TABLE ssh_data`);
    db.exec(`ALTER TABLE ssh_data_backup RENAME TO ssh_data`);

    // Drop credential tables
    db.exec(`DROP TABLE IF EXISTS ssh_credential_usage`);
    db.exec(`DROP TABLE IF EXISTS ssh_credentials`);

    console.log('✅ Removed SSH credentials management tables');
};