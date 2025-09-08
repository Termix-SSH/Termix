import express from 'express';
import {credentialService} from '../../services/credentials.js';
import type {Request, Response, NextFunction} from 'express';
import jwt from 'jsonwebtoken';
import chalk from 'chalk';

const credIconSymbol = '🔐';
const getTimeStamp = (): string => chalk.gray(`[${new Date().toLocaleTimeString()}]`);
const formatMessage = (level: string, colorFn: chalk.Chalk, message: string): string => {
    return `${getTimeStamp()} ${colorFn(`[${level.toUpperCase()}]`)} ${chalk.hex('#0f766e')(`[${credIconSymbol}]`)} ${message}`;
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
    }
};

const router = express.Router();

interface JWTPayload {
    userId: string;
    iat?: number;
    exp?: number;
}

function isNonEmptyString(val: any): val is string {
    return typeof val === 'string' && val.trim().length > 0;
}

function authenticateJWT(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        logger.warn('Missing or invalid Authorization header');
        return res.status(401).json({error: 'Missing or invalid Authorization header'});
    }
    const token = authHeader.split(' ')[1];
    const jwtSecret = process.env.JWT_SECRET || 'secret';
    try {
        const payload = jwt.verify(token, jwtSecret) as JWTPayload;
        (req as any).userId = payload.userId;
        next();
    } catch (err) {
        logger.warn('Invalid or expired token');
        return res.status(401).json({error: 'Invalid or expired token'});
    }
}

// Create a new credential
// POST /credentials
router.post('/', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const {
        name,
        description,
        folder,
        tags,
        authType,
        username,
        password,
        key,
        keyPassword,
        keyType
    } = req.body;

    if (!isNonEmptyString(userId) || !isNonEmptyString(name) || !isNonEmptyString(username)) {
        logger.warn('Invalid credential creation data');
        return res.status(400).json({error: 'Name and username are required'});
    }

    if (!['password', 'key'].includes(authType)) {
        logger.warn('Invalid auth type');
        return res.status(400).json({error: 'Auth type must be "password" or "key"'});
    }

    try {
        const credential = await credentialService.createCredential(userId, {
            name,
            description,
            folder,
            tags,
            authType,
            username,
            password,
            key,
            keyPassword,
            keyType
        });

        logger.success(`Created credential: ${name}`);
        res.status(201).json(credential);
    } catch (err) {
        logger.error('Failed to create credential', err);
        res.status(500).json({
            error: err instanceof Error ? err.message : 'Failed to create credential'
        });
    }
});

// Get all credentials for the authenticated user
// GET /credentials
router.get('/', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    
    if (!isNonEmptyString(userId)) {
        logger.warn('Invalid userId for credential fetch');
        return res.status(400).json({error: 'Invalid userId'});
    }

    try {
        const credentials = await credentialService.getUserCredentials(userId);
        res.json(credentials);
    } catch (err) {
        logger.error('Failed to fetch credentials', err);
        res.status(500).json({error: 'Failed to fetch credentials'});
    }
});

// Get all unique credential folders for the authenticated user  
// GET /credentials/folders
router.get('/folders', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    
    if (!isNonEmptyString(userId)) {
        logger.warn('Invalid userId for credential folder fetch');
        return res.status(400).json({error: 'Invalid userId'});
    }

    try {
        const folders = await credentialService.getCredentialsFolders(userId);
        res.json(folders);
    } catch (err) {
        logger.error('Failed to fetch credential folders', err);
        res.status(500).json({error: 'Failed to fetch credential folders'});
    }
});

// Get a specific credential by ID (with decrypted secrets)
// GET /credentials/:id
router.get('/:id', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const {id} = req.params;

    if (!isNonEmptyString(userId) || !id) {
        logger.warn('Invalid request for credential fetch');
        return res.status(400).json({error: 'Invalid request'});
    }

    try {
        const credential = await credentialService.getCredentialWithSecrets(userId, parseInt(id));
        
        if (!credential) {
            return res.status(404).json({error: 'Credential not found'});
        }

        res.json(credential);
    } catch (err) {
        logger.error('Failed to fetch credential', err);
        res.status(500).json({
            error: err instanceof Error ? err.message : 'Failed to fetch credential'
        });
    }
});

// Update a credential
// PUT /credentials/:id
router.put('/:id', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const {id} = req.params;
    const updateData = req.body;

    if (!isNonEmptyString(userId) || !id) {
        logger.warn('Invalid request for credential update');
        return res.status(400).json({error: 'Invalid request'});
    }

    try {
        const credential = await credentialService.updateCredential(userId, parseInt(id), updateData);
        logger.success(`Updated credential ID ${id}`);
        res.json(credential);
    } catch (err) {
        logger.error('Failed to update credential', err);
        res.status(500).json({
            error: err instanceof Error ? err.message : 'Failed to update credential'
        });
    }
});

// Delete a credential
// DELETE /credentials/:id
router.delete('/:id', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const {id} = req.params;

    if (!isNonEmptyString(userId) || !id) {
        logger.warn('Invalid request for credential deletion');
        return res.status(400).json({error: 'Invalid request'});
    }

    try {
        await credentialService.deleteCredential(userId, parseInt(id));
        logger.success(`Deleted credential ID ${id}`);
        res.json({message: 'Credential deleted successfully'});
    } catch (err) {
        logger.error('Failed to delete credential', err);
        res.status(500).json({
            error: err instanceof Error ? err.message : 'Failed to delete credential'
        });
    }
});

// Apply a credential to an SSH host (for quick application)
// POST /credentials/:id/apply-to-host/:hostId
router.post('/:id/apply-to-host/:hostId', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const {id: credentialId, hostId} = req.params;

    if (!isNonEmptyString(userId) || !credentialId || !hostId) {
        logger.warn('Invalid request for credential application');
        return res.status(400).json({error: 'Invalid request'});
    }

    try {
        const {sshHostService} = await import('../../services/ssh-host.js');
        await sshHostService.applyCredentialToHost(userId, parseInt(hostId), parseInt(credentialId));
        
        logger.success(`Applied credential ${credentialId} to host ${hostId}`);
        res.json({message: 'Credential applied to host successfully'});
    } catch (err) {
        logger.error('Failed to apply credential to host', err);
        res.status(500).json({
            error: err instanceof Error ? err.message : 'Failed to apply credential to host'
        });
    }
});

// Get hosts using a specific credential
// GET /credentials/:id/hosts
router.get('/:id/hosts', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const {id: credentialId} = req.params;

    if (!isNonEmptyString(userId) || !credentialId) {
        logger.warn('Invalid request for credential hosts fetch');
        return res.status(400).json({error: 'Invalid request'});
    }

    try {
        const {sshHostService} = await import('../../services/ssh-host.js');
        const hosts = await sshHostService.getHostsUsingCredential(userId, parseInt(credentialId));
        
        res.json(hosts);
    } catch (err) {
        logger.error('Failed to fetch hosts using credential', err);
        res.status(500).json({
            error: err instanceof Error ? err.message : 'Failed to fetch hosts using credential'
        });
    }
});

export default router;