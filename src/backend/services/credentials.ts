import {db} from '../database/db/index.js';
import {sshCredentials, sshCredentialUsage, sshData} from '../database/db/schema.js';
import {eq, and, desc, sql} from 'drizzle-orm';
import {encryptionService} from './encryption.js';
import chalk from 'chalk';

const logger = {
    info: (msg: string): void => {
        const timestamp = chalk.gray(`[${new Date().toLocaleTimeString()}]`);
        console.log(`${timestamp} ${chalk.cyan('[INFO]')} ${chalk.hex('#0f766e')('[CRED]')} ${msg}`);
    },
    warn: (msg: string): void => {
        const timestamp = chalk.gray(`[${new Date().toLocaleTimeString()}]`);
        console.warn(`${timestamp} ${chalk.yellow('[WARN]')} ${chalk.hex('#0f766e')('[CRED]')} ${msg}`);
    },
    error: (msg: string, err?: unknown): void => {
        const timestamp = chalk.gray(`[${new Date().toLocaleTimeString()}]`);
        console.error(`${timestamp} ${chalk.redBright('[ERROR]')} ${chalk.hex('#0f766e')('[CRED]')} ${msg}`);
        if (err) console.error(err);
    },
    success: (msg: string): void => {
        const timestamp = chalk.gray(`[${new Date().toLocaleTimeString()}]`);
        console.log(`${timestamp} ${chalk.greenBright('[SUCCESS]')} ${chalk.hex('#0f766e')('[CRED]')} ${msg}`);
    }
};

export interface CredentialInput {
    name: string;
    description?: string;
    folder?: string;
    tags?: string[];
    authType: 'password' | 'key';
    username: string;
    password?: string;
    key?: string;
    keyPassword?: string;
    keyType?: string;
}

export interface CredentialOutput {
    id: number;
    name: string;
    description?: string;
    folder?: string;
    tags: string[];
    authType: 'password' | 'key';
    username: string;
    keyType?: string;
    usageCount: number;
    lastUsed?: string;
    createdAt: string;
    updatedAt: string;
}

export interface CredentialWithSecrets extends CredentialOutput {
    password?: string;
    key?: string;
    keyPassword?: string;
}

class CredentialService {
    /**
     * Create a new credential
     */
    async createCredential(userId: string, input: CredentialInput): Promise<CredentialOutput> {
        try {
            // Validate input
            if (!input.name?.trim()) {
                throw new Error('Credential name is required');
            }
            if (!input.username?.trim()) {
                throw new Error('Username is required');
            }
            if (!['password', 'key'].includes(input.authType)) {
                throw new Error('Invalid auth type');
            }
            if (input.authType === 'password' && !input.password) {
                throw new Error('Password is required for password authentication');
            }
            if (input.authType === 'key' && !input.key) {
                throw new Error('SSH key is required for key authentication');
            }

            // Encrypt sensitive data
            let encryptedPassword: string | null = null;
            let encryptedKey: string | null = null;
            let encryptedKeyPassword: string | null = null;

            if (input.authType === 'password' && input.password) {
                encryptedPassword = encryptionService.encryptToString(input.password);
            } else if (input.authType === 'key') {
                if (input.key) {
                    encryptedKey = encryptionService.encryptToString(input.key);
                }
                if (input.keyPassword) {
                    encryptedKeyPassword = encryptionService.encryptToString(input.keyPassword);
                }
            }

            const credentialData = {
                userId,
                name: input.name.trim(),
                description: input.description?.trim() || null,
                folder: input.folder?.trim() || null,
                tags: Array.isArray(input.tags) ? input.tags.join(',') : (input.tags || ''),
                authType: input.authType,
                username: input.username.trim(),
                encryptedPassword,
                encryptedKey,
                encryptedKeyPassword,
                keyType: input.keyType || null,
                usageCount: 0,
                lastUsed: null,
            };

            const result = await db.insert(sshCredentials).values(credentialData).returning();
            const created = result[0];

            logger.success(`Created credential "${input.name}" (ID: ${created.id})`);

            return this.formatCredentialOutput(created);
        } catch (error) {
            logger.error('Failed to create credential', error);
            throw error;
        }
    }

    /**
     * Get all credentials for a user
     */
    async getUserCredentials(userId: string): Promise<CredentialOutput[]> {
        try {
            const credentials = await db
                .select()
                .from(sshCredentials)
                .where(eq(sshCredentials.userId, userId))
                .orderBy(desc(sshCredentials.updatedAt));

            return credentials.map(cred => this.formatCredentialOutput(cred));
        } catch (error) {
            logger.error('Failed to fetch user credentials', error);
            throw error;
        }
    }

    /**
     * Get a credential by ID with decrypted secrets
     */
    async getCredentialWithSecrets(userId: string, credentialId: number): Promise<CredentialWithSecrets | null> {
        try {
            const credentials = await db
                .select()
                .from(sshCredentials)
                .where(and(
                    eq(sshCredentials.id, credentialId),
                    eq(sshCredentials.userId, userId)
                ));

            if (credentials.length === 0) {
                return null;
            }

            const credential = credentials[0];
            const output: CredentialWithSecrets = {
                ...this.formatCredentialOutput(credential)
            };

            // Decrypt sensitive data
            try {
                if (credential.encryptedPassword) {
                    output.password = encryptionService.decryptFromString(credential.encryptedPassword);
                }
                if (credential.encryptedKey) {
                    output.key = encryptionService.decryptFromString(credential.encryptedKey);
                }
                if (credential.encryptedKeyPassword) {
                    output.keyPassword = encryptionService.decryptFromString(credential.encryptedKeyPassword);
                }
            } catch (decryptError) {
                logger.error(`Failed to decrypt credential ${credentialId}`, decryptError);
                throw new Error('Failed to decrypt credential data');
            }

            return output;
        } catch (error) {
            logger.error('Failed to get credential with secrets', error);
            throw error;
        }
    }

    /**
     * Update a credential
     */
    async updateCredential(userId: string, credentialId: number, input: Partial<CredentialInput>): Promise<CredentialOutput> {
        try {
            // Check if credential exists and belongs to user
            const existing = await db
                .select()
                .from(sshCredentials)
                .where(and(
                    eq(sshCredentials.id, credentialId),
                    eq(sshCredentials.userId, userId)
                ));

            if (existing.length === 0) {
                throw new Error('Credential not found');
            }

            const updateData: any = {
                updatedAt: new Date().toISOString()
            };

            if (input.name !== undefined) updateData.name = input.name.trim();
            if (input.description !== undefined) updateData.description = input.description?.trim() || null;
            if (input.folder !== undefined) updateData.folder = input.folder?.trim() || null;
            if (input.tags !== undefined) {
                updateData.tags = Array.isArray(input.tags) ? input.tags.join(',') : (input.tags || '');
            }
            if (input.username !== undefined) updateData.username = input.username.trim();
            if (input.authType !== undefined) updateData.authType = input.authType;
            if (input.keyType !== undefined) updateData.keyType = input.keyType;

            // Handle sensitive data updates
            if (input.password !== undefined) {
                updateData.encryptedPassword = input.password ? encryptionService.encryptToString(input.password) : null;
            }
            if (input.key !== undefined) {
                updateData.encryptedKey = input.key ? encryptionService.encryptToString(input.key) : null;
            }
            if (input.keyPassword !== undefined) {
                updateData.encryptedKeyPassword = input.keyPassword ? encryptionService.encryptToString(input.keyPassword) : null;
            }

            await db
                .update(sshCredentials)
                .set(updateData)
                .where(and(
                    eq(sshCredentials.id, credentialId),
                    eq(sshCredentials.userId, userId)
                ));

            // Fetch updated credential
            const updated = await db
                .select()
                .from(sshCredentials)
                .where(eq(sshCredentials.id, credentialId));

            logger.success(`Updated credential ID ${credentialId}`);

            return this.formatCredentialOutput(updated[0]);
        } catch (error) {
            logger.error('Failed to update credential', error);
            throw error;
        }
    }

    /**
     * Delete a credential
     */
    async deleteCredential(userId: string, credentialId: number): Promise<void> {
        try {
            // Check if credential is in use
            const hostsUsingCredential = await db
                .select()
                .from(sshData)
                .where(and(
                    eq(sshData.credentialId, credentialId),
                    eq(sshData.userId, userId)
                ));

            if (hostsUsingCredential.length > 0) {
                throw new Error(`Cannot delete credential: it is currently used by ${hostsUsingCredential.length} host(s)`);
            }

            // Delete usage records
            await db
                .delete(sshCredentialUsage)
                .where(and(
                    eq(sshCredentialUsage.credentialId, credentialId),
                    eq(sshCredentialUsage.userId, userId)
                ));

            // Delete credential
            const result = await db
                .delete(sshCredentials)
                .where(and(
                    eq(sshCredentials.id, credentialId),
                    eq(sshCredentials.userId, userId)
                ));

            logger.success(`Deleted credential ID ${credentialId}`);
        } catch (error) {
            logger.error('Failed to delete credential', error);
            throw error;
        }
    }

    /**
     * Record credential usage
     */
    async recordUsage(userId: string, credentialId: number, hostId: number): Promise<void> {
        try {
            // Record usage
            await db.insert(sshCredentialUsage).values({
                credentialId,
                hostId,
                userId,
            });

            // Update credential usage stats
            await db
                .update(sshCredentials)
                .set({
                    usageCount: sql`${sshCredentials.usageCount} + 1`,
                    lastUsed: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                })
                .where(eq(sshCredentials.id, credentialId));

        } catch (error) {
            logger.error('Failed to record credential usage', error);
            // Don't throw - this is not critical
        }
    }

    /**
     * Get credentials grouped by folder
     */
    async getCredentialsFolders(userId: string): Promise<string[]> {
        try {
            const result = await db
                .select({folder: sshCredentials.folder})
                .from(sshCredentials)
                .where(eq(sshCredentials.userId, userId));

            const folderCounts: Record<string, number> = {};
            result.forEach(r => {
                if (r.folder && r.folder.trim() !== '') {
                    folderCounts[r.folder] = (folderCounts[r.folder] || 0) + 1;
                }
            });

            return Object.keys(folderCounts).filter(folder => folderCounts[folder] > 0);
        } catch (error) {
            logger.error('Failed to get credential folders', error);
            throw error;
        }
    }

    private formatCredentialOutput(credential: any): CredentialOutput {
        return {
            id: credential.id,
            name: credential.name,
            description: credential.description,
            folder: credential.folder,
            tags: typeof credential.tags === 'string' 
                ? (credential.tags ? credential.tags.split(',').filter(Boolean) : []) 
                : [],
            authType: credential.authType,
            username: credential.username,
            keyType: credential.keyType,
            usageCount: credential.usageCount || 0,
            lastUsed: credential.lastUsed,
            createdAt: credential.createdAt,
            updatedAt: credential.updatedAt,
        };
    }
}

export const credentialService = new CredentialService();