import {db} from '../database/db/index.js';
import {sshData, sshCredentials} from '../database/db/schema.js';
import {eq, and} from 'drizzle-orm';
import {credentialService} from './credentials.js';
import {encryptionService} from './encryption.js';
import chalk from 'chalk';

const logger = {
    info: (msg: string): void => {
        const timestamp = chalk.gray(`[${new Date().toLocaleTimeString()}]`);
        console.log(`${timestamp} ${chalk.cyan('[INFO]')} ${chalk.hex('#7c3aed')('[SSH]')} ${msg}`);
    },
    warn: (msg: string): void => {
        const timestamp = chalk.gray(`[${new Date().toLocaleTimeString()}]`);
        console.warn(`${timestamp} ${chalk.yellow('[WARN]')} ${chalk.hex('#7c3aed')('[SSH]')} ${msg}`);
    },
    error: (msg: string, err?: unknown): void => {
        const timestamp = chalk.gray(`[${new Date().toLocaleTimeString()}]`);
        console.error(`${timestamp} ${chalk.redBright('[ERROR]')} ${chalk.hex('#7c3aed')('[SSH]')} ${msg}`);
        if (err) console.error(err);
    },
    success: (msg: string): void => {
        const timestamp = chalk.gray(`[${new Date().toLocaleTimeString()}]`);
        console.log(`${timestamp} ${chalk.greenBright('[SUCCESS]')} ${chalk.hex('#7c3aed')('[SSH]')} ${msg}`);
    }
};

export interface SSHHostWithCredentials {
    id: number;
    userId: string;
    name?: string;
    ip: string;
    port: number;
    username: string;
    folder?: string;
    tags: string[];
    pin: boolean;
    authType: string;
    // Auth data - either from credential or legacy fields
    password?: string;
    key?: string;
    keyPassword?: string;
    keyType?: string;
    credentialId?: number;
    credentialName?: string;
    // Other fields
    enableTerminal: boolean;
    enableTunnel: boolean;
    tunnelConnections: any[];
    enableFileManager: boolean;
    defaultPath?: string;
    createdAt: string;
    updatedAt: string;
}

class SSHHostService {
    /**
     * Get SSH host with resolved credentials
     */
    async getHostWithCredentials(userId: string, hostId: number): Promise<SSHHostWithCredentials | null> {
        try {
            const hosts = await db
                .select()
                .from(sshData)
                .where(and(
                    eq(sshData.id, hostId),
                    eq(sshData.userId, userId)
                ));

            if (hosts.length === 0) {
                return null;
            }

            const host = hosts[0];
            return await this.resolveHostCredentials(host);
        } catch (error) {
            logger.error(`Failed to get host ${hostId} with credentials`, error);
            throw error;
        }
    }

    /**
     * Apply a credential to an SSH host
     */
    async applyCredentialToHost(userId: string, hostId: number, credentialId: number): Promise<void> {
        try {
            // Verify credential exists and belongs to user
            const credential = await credentialService.getCredentialWithSecrets(userId, credentialId);
            if (!credential) {
                throw new Error('Credential not found');
            }

            // Update host to reference the credential and clear legacy fields
            await db
                .update(sshData)
                .set({
                    credentialId: credentialId,
                    username: credential.username,
                    authType: credential.authType,
                    // Clear legacy credential fields since we're using the credential reference
                    password: null,
                    key: null,
                    keyPassword: null,
                    keyType: null,
                    updatedAt: new Date().toISOString()
                })
                .where(and(
                    eq(sshData.id, hostId),
                    eq(sshData.userId, userId)
                ));

            // Record credential usage
            await credentialService.recordUsage(userId, credentialId, hostId);

            logger.success(`Applied credential ${credentialId} to host ${hostId}`);
        } catch (error) {
            logger.error(`Failed to apply credential ${credentialId} to host ${hostId}`, error);
            throw error;
        }
    }

    /**
     * Remove credential from host (revert to legacy mode)
     */
    async removeCredentialFromHost(userId: string, hostId: number): Promise<void> {
        try {
            await db
                .update(sshData)
                .set({
                    credentialId: null,
                    updatedAt: new Date().toISOString()
                })
                .where(and(
                    eq(sshData.id, hostId),
                    eq(sshData.userId, userId)
                ));

            logger.success(`Removed credential reference from host ${hostId}`);
        } catch (error) {
            logger.error(`Failed to remove credential from host ${hostId}`, error);
            throw error;
        }
    }

    /**
     * Get all hosts using a specific credential
     */
    async getHostsUsingCredential(userId: string, credentialId: number): Promise<SSHHostWithCredentials[]> {
        try {
            const hosts = await db
                .select()
                .from(sshData)
                .where(and(
                    eq(sshData.credentialId, credentialId),
                    eq(sshData.userId, userId)
                ));

            const result: SSHHostWithCredentials[] = [];
            for (const host of hosts) {
                const resolved = await this.resolveHostCredentials(host);
                result.push(resolved);
            }

            return result;
        } catch (error) {
            logger.error(`Failed to get hosts using credential ${credentialId}`, error);
            throw error;
        }
    }

    /**
     * Resolve host credentials from either credential reference or legacy fields
     */
    private async resolveHostCredentials(host: any): Promise<SSHHostWithCredentials> {
        const baseHost: SSHHostWithCredentials = {
            id: host.id,
            userId: host.userId,
            name: host.name,
            ip: host.ip,
            port: host.port,
            username: host.username,
            folder: host.folder,
            tags: typeof host.tags === 'string' 
                ? (host.tags ? host.tags.split(',').filter(Boolean) : []) 
                : [],
            pin: !!host.pin,
            authType: host.authType,
            enableTerminal: !!host.enableTerminal,
            enableTunnel: !!host.enableTunnel,
            tunnelConnections: host.tunnelConnections ? JSON.parse(host.tunnelConnections) : [],
            enableFileManager: !!host.enableFileManager,
            defaultPath: host.defaultPath,
            createdAt: host.createdAt,
            updatedAt: host.updatedAt,
        };

        // If host uses a credential reference, get credentials from there
        if (host.credentialId) {
            try {
                const credential = await credentialService.getCredentialWithSecrets(host.userId, host.credentialId);
                if (credential) {
                    baseHost.credentialId = credential.id;
                    baseHost.credentialName = credential.name;
                    baseHost.username = credential.username;
                    baseHost.authType = credential.authType;
                    baseHost.password = credential.password;
                    baseHost.key = credential.key;
                    baseHost.keyPassword = credential.keyPassword;
                    baseHost.keyType = credential.keyType;
                } else {
                    logger.warn(`Credential ${host.credentialId} not found for host ${host.id}, using legacy data`);
                    // Fall back to legacy data
                    this.addLegacyCredentials(baseHost, host);
                }
            } catch (error) {
                logger.error(`Failed to resolve credential ${host.credentialId} for host ${host.id}`, error);
                // Fall back to legacy data
                this.addLegacyCredentials(baseHost, host);
            }
        } else {
            // Use legacy credential fields
            this.addLegacyCredentials(baseHost, host);
        }

        return baseHost;
    }

    private addLegacyCredentials(baseHost: SSHHostWithCredentials, host: any): void {
        baseHost.password = host.password;
        baseHost.key = host.key;
        baseHost.keyPassword = host.keyPassword;
        baseHost.keyType = host.keyType;
    }

    /**
     * Migrate a host from legacy credentials to a managed credential
     */
    async migrateHostToCredential(userId: string, hostId: number, credentialName: string): Promise<number> {
        try {
            const host = await this.getHostWithCredentials(userId, hostId);
            if (!host) {
                throw new Error('Host not found');
            }

            if (host.credentialId) {
                throw new Error('Host already uses managed credentials');
            }

            // Create a new credential from the host's legacy data
            const credentialData = {
                name: credentialName,
                description: `Migrated from host ${host.name || host.ip}`,
                folder: host.folder,
                tags: host.tags,
                authType: host.authType as 'password' | 'key',
                username: host.username,
                password: host.password,
                key: host.key,
                keyPassword: host.keyPassword,
                keyType: host.keyType,
            };

            const credential = await credentialService.createCredential(userId, credentialData);

            // Apply the new credential to the host
            await this.applyCredentialToHost(userId, hostId, credential.id);

            logger.success(`Migrated host ${hostId} to managed credential ${credential.id}`);
            return credential.id;
        } catch (error) {
            logger.error(`Failed to migrate host ${hostId} to credential`, error);
            throw error;
        }
    }
}

export const sshHostService = new SSHHostService();