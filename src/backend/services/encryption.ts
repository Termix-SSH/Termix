import crypto from 'crypto';
import chalk from 'chalk';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const TAG_LENGTH = 16; // 128 bits

interface EncryptionResult {
    encrypted: string;
    iv: string;
    tag: string;
}

interface DecryptionInput {
    encrypted: string;
    iv: string;
    tag: string;
}

class EncryptionService {
    private key: Buffer;

    constructor() {
        // Get or generate encryption key
        const keyEnv = process.env.CREDENTIAL_ENCRYPTION_KEY;
        if (keyEnv) {
            this.key = Buffer.from(keyEnv, 'hex');
            if (this.key.length !== KEY_LENGTH) {
                throw new Error(`Invalid encryption key length. Expected ${KEY_LENGTH} bytes, got ${this.key.length}`);
            }
        } else {
            // Generate a new key - in production, this should be stored securely
            this.key = crypto.randomBytes(KEY_LENGTH);
            console.warn(chalk.yellow(`[SECURITY] Generated new encryption key. Store this in CREDENTIAL_ENCRYPTION_KEY: ${this.key.toString('hex')}`));
        }
    }

    /**
     * Encrypt sensitive data
     * @param plaintext - The data to encrypt
     * @returns Encryption result with encrypted data, IV, and tag
     */
    encrypt(plaintext: string): EncryptionResult {
        try {
            const iv = crypto.randomBytes(IV_LENGTH);
            const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
            
            let encrypted = cipher.update(plaintext, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            const tag = cipher.getAuthTag();
            
            return {
                encrypted,
                iv: iv.toString('hex'),
                tag: tag.toString('hex')
            };
        } catch (error) {
            throw new Error(`Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Decrypt sensitive data
     * @param input - Encrypted data with IV and tag
     * @returns Decrypted plaintext
     */
    decrypt(input: DecryptionInput): string {
        try {
            const iv = Buffer.from(input.iv, 'hex');
            const tag = Buffer.from(input.tag, 'hex');
            const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
            decipher.setAuthTag(tag);
            
            let decrypted = decipher.update(input.encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            
            return decrypted;
        } catch (error) {
            throw new Error(`Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Encrypt data and return as single base64-encoded string
     * Format: iv:tag:encrypted
     */
    encryptToString(plaintext: string): string {
        const result = this.encrypt(plaintext);
        const combined = `${result.iv}:${result.tag}:${result.encrypted}`;
        return Buffer.from(combined).toString('base64');
    }

    /**
     * Decrypt data from base64-encoded string
     */
    decryptFromString(encryptedString: string): string {
        try {
            const combined = Buffer.from(encryptedString, 'base64').toString();
            const parts = combined.split(':');
            
            if (parts.length !== 3) {
                throw new Error('Invalid encrypted string format');
            }
            
            return this.decrypt({
                iv: parts[0],
                tag: parts[1],
                encrypted: parts[2]
            });
        } catch (error) {
            throw new Error(`Failed to decrypt string: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Validate that a string can be decrypted (useful for testing)
     */
    canDecrypt(encryptedString: string): boolean {
        try {
            this.decryptFromString(encryptedString);
            return true;
        } catch {
            return false;
        }
    }
}

// Singleton instance
export const encryptionService = new EncryptionService();

// Types for external use
export type { EncryptionResult, DecryptionInput };