import type { Database } from 'better-sqlite3';
import chalk from 'chalk';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = {
    info: (msg: string): void => {
        const timestamp = chalk.gray(`[${new Date().toLocaleTimeString()}]`);
        console.log(`${timestamp} ${chalk.cyan('[MIGRATION]')} ${msg}`);
    },
    warn: (msg: string): void => {
        const timestamp = chalk.gray(`[${new Date().toLocaleTimeString()}]`);
        console.warn(`${timestamp} ${chalk.yellow('[MIGRATION]')} ${msg}`);
    },
    error: (msg: string, err?: unknown): void => {
        const timestamp = chalk.gray(`[${new Date().toLocaleTimeString()}]`);
        console.error(`${timestamp} ${chalk.redBright('[MIGRATION]')} ${msg}`);
        if (err) console.error(err);
    },
    success: (msg: string): void => {
        const timestamp = chalk.gray(`[${new Date().toLocaleTimeString()}]`);
        console.log(`${timestamp} ${chalk.greenBright('[MIGRATION]')} ${msg}`);
    }
};

interface Migration {
    id: string;
    name: string;
    up: (db: Database) => void;
    down: (db: Database) => void;
}

class MigrationManager {
    private db: Database;
    private migrationsPath: string;

    constructor(db: Database) {
        this.db = db;
        this.migrationsPath = __dirname;
        this.ensureMigrationsTable();
    }

    private ensureMigrationsTable() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS migrations (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }

    private getAppliedMigrations(): Set<string> {
        const applied = this.db.prepare('SELECT id FROM migrations').all() as { id: string }[];
        return new Set(applied.map(m => m.id));
    }

    private async loadMigration(filename: string): Promise<Migration | null> {
        try {
            const migrationPath = join(this.migrationsPath, filename);
            // Convert to file:// URL for Windows compatibility
            const migrationUrl = process.platform === 'win32' 
                ? `file:///${migrationPath.replace(/\\/g, '/')}`
                : migrationPath;
            const migration = await import(migrationUrl);
            
            // Extract migration ID and name from filename
            const matches = filename.match(/^(\d+)-(.+)\.(ts|js)$/);
            if (!matches) {
                logger.warn(`Skipping invalid migration filename: ${filename}`);
                return null;
            }

            const [, id, name] = matches;
            
            return {
                id: id.padStart(3, '0'),
                name: name.replace(/-/g, ' '),
                up: migration.up,
                down: migration.down
            };
        } catch (error) {
            logger.error(`Failed to load migration ${filename}:`, error);
            return null;
        }
    }

    private getMigrationFiles(): string[] {
        try {
            return readdirSync(this.migrationsPath)
                .filter(file => (file.endsWith('.ts') || file.endsWith('.js')) && !file.includes('migrator'))
                .sort();
        } catch (error) {
            logger.error('Failed to read migrations directory:', error);
            return [];
        }
    }

    async runMigrations(): Promise<void> {
        logger.info('Starting database migrations...');
        
        const migrationFiles = this.getMigrationFiles();
        if (migrationFiles.length === 0) {
            logger.info('No migrations found');
            return;
        }

        const appliedMigrations = this.getAppliedMigrations();
        const migrations: Migration[] = [];

        // Load all migrations
        for (const filename of migrationFiles) {
            const migration = await this.loadMigration(filename);
            if (migration) {
                migrations.push(migration);
            }
        }

        // Filter out already applied migrations
        const pendingMigrations = migrations.filter(m => !appliedMigrations.has(m.id));
        
        if (pendingMigrations.length === 0) {
            logger.info('All migrations are already applied');
            return;
        }

        logger.info(`Found ${pendingMigrations.length} pending migration(s)`);

        // Run pending migrations in transaction
        const transaction = this.db.transaction(() => {
            for (const migration of pendingMigrations) {
                logger.info(`Applying migration ${migration.id}: ${migration.name}`);
                
                try {
                    migration.up(this.db);
                    
                    // Record the migration
                    this.db.prepare(`
                        INSERT INTO migrations (id, name) 
                        VALUES (?, ?)
                    `).run(migration.id, migration.name);
                    
                    logger.success(`Applied migration ${migration.id}: ${migration.name}`);
                } catch (error) {
                    logger.error(`Failed to apply migration ${migration.id}:`, error);
                    throw error;
                }
            }
        });

        try {
            transaction();
            logger.success(`Successfully applied ${pendingMigrations.length} migration(s)`);
        } catch (error) {
            logger.error('Migration transaction failed, rolling back:', error);
            throw error;
        }
    }

    async rollbackMigration(targetId?: string): Promise<void> {
        logger.warn('Starting migration rollback...');
        
        const appliedMigrations = this.db.prepare(`
            SELECT id, name FROM migrations 
            ORDER BY id DESC
        `).all() as { id: string; name: string }[];

        if (appliedMigrations.length === 0) {
            logger.info('No migrations to rollback');
            return;
        }

        const migrationsToRollback = targetId 
            ? appliedMigrations.filter(m => m.id >= targetId)
            : [appliedMigrations[0]]; // Only rollback the latest

        const migrationFiles = this.getMigrationFiles();
        const migrations: Migration[] = [];

        // Load migrations that need to be rolled back
        for (const filename of migrationFiles) {
            const migration = await this.loadMigration(filename);
            if (migration && migrationsToRollback.some(m => m.id === migration.id)) {
                migrations.push(migration);
            }
        }

        // Sort in reverse order for rollback
        migrations.sort((a, b) => b.id.localeCompare(a.id));

        const transaction = this.db.transaction(() => {
            for (const migration of migrations) {
                logger.info(`Rolling back migration ${migration.id}: ${migration.name}`);
                
                try {
                    migration.down(this.db);
                    
                    // Remove the migration record
                    this.db.prepare(`DELETE FROM migrations WHERE id = ?`).run(migration.id);
                    
                    logger.success(`Rolled back migration ${migration.id}: ${migration.name}`);
                } catch (error) {
                    logger.error(`Failed to rollback migration ${migration.id}:`, error);
                    throw error;
                }
            }
        });

        try {
            transaction();
            logger.success(`Successfully rolled back ${migrations.length} migration(s)`);
        } catch (error) {
            logger.error('Rollback transaction failed:', error);
            throw error;
        }
    }

    getMigrationStatus(): { id: string; name: string; applied: boolean }[] {
        const migrationFiles = this.getMigrationFiles();
        const appliedMigrations = this.getAppliedMigrations();
        
        return migrationFiles.map(filename => {
            const matches = filename.match(/^(\d+)-(.+)\.(ts|js)$/);
            if (!matches) return null;
            
            const [, id, name] = matches;
            const migrationId = id.padStart(3, '0');
            
            return {
                id: migrationId,
                name: name.replace(/-/g, ' '),
                applied: appliedMigrations.has(migrationId)
            };
        }).filter(Boolean) as { id: string; name: string; applied: boolean }[];
    }

    printStatus(): void {
        const status = this.getMigrationStatus();
        
        logger.info('Migration Status:');
        console.log(chalk.gray('─'.repeat(60)));
        
        status.forEach(migration => {
            const statusIcon = migration.applied ? chalk.green('✓') : chalk.yellow('○');
            const statusText = migration.applied ? chalk.green('Applied') : chalk.yellow('Pending');
            console.log(`${statusIcon} ${migration.id} - ${migration.name} [${statusText}]`);
        });
        
        console.log(chalk.gray('─'.repeat(60)));
        const appliedCount = status.filter(m => m.applied).length;
        console.log(`Total: ${status.length} migrations, ${appliedCount} applied, ${status.length - appliedCount} pending`);
    }
}

export { MigrationManager };
export type { Migration };