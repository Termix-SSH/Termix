import express from 'express';
import {db} from '../db/index.js';
import {sshData, fileManagerRecent, fileManagerPinned, fileManagerShortcuts} from '../db/schema.js';
import {eq, and, desc} from 'drizzle-orm';
import chalk from 'chalk';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import type {Request, Response, NextFunction} from 'express';

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

const router = express.Router();

function isNonEmptyString(val: any): val is string {
    return typeof val === 'string' && val.trim().length > 0;
}

function isValidPort(val: any): val is number {
    return typeof val === 'number' && val > 0 && val < 65536;
}

interface JWTPayload {
    userId: string;
    iat?: number;
    exp?: number;
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024,
    },
    fileFilter: (req, file, cb) => {
        if (file.fieldname === 'key') {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type'));
        }
    }
});

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

function isLocalhost(req: Request) {
    const ip = req.ip || req.connection?.remoteAddress;
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

// Internal-only endpoint for autostart (no JWT)
router.get('/db/host/internal', async (req: Request, res: Response) => {
    if (!isLocalhost(req) && req.headers['x-internal-request'] !== '1') {
        logger.warn('Unauthorized attempt to access internal SSH host endpoint');
        return res.status(403).json({error: 'Forbidden'});
    }
    try {
        const data = await db.select().from(sshData);
        const result = data.map((row: any) => ({
            ...row,
            tags: typeof row.tags === 'string' ? (row.tags ? row.tags.split(',').filter(Boolean) : []) : [],
            pin: !!row.pin,
            enableTerminal: !!row.enableTerminal,
            enableTunnel: !!row.enableTunnel,
            tunnelConnections: row.tunnelConnections ? JSON.parse(row.tunnelConnections) : [],
            enableFileManager: !!row.enableFileManager,
        }));
        res.json(result);
    } catch (err) {
        logger.error('Failed to fetch SSH data (internal)', err);
        res.status(500).json({error: 'Failed to fetch SSH data'});
    }
});

// Route: Create SSH data (requires JWT)
// POST /ssh/host
router.post('/db/host', authenticateJWT, upload.single('key'), async (req: Request, res: Response) => {
    let hostData: any;

    if (req.headers['content-type']?.includes('multipart/form-data')) {
        if (req.body.data) {
            try {
                hostData = JSON.parse(req.body.data);
            } catch (err) {
                logger.warn('Invalid JSON data in multipart request');
                return res.status(400).json({error: 'Invalid JSON data'});
            }
        } else {
            logger.warn('Missing data field in multipart request');
            return res.status(400).json({error: 'Missing data field'});
        }

        if (req.file) {
            hostData.key = req.file.buffer.toString('utf8');
        }
    } else {
        hostData = req.body;
    }

    const {
        name,
        folder,
        tags,
        ip,
        port,
        username,
        password,
        authMethod,
        key,
        keyPassword,
        keyType,
        pin,
        enableTerminal,
        enableTunnel,
        enableFileManager,
        defaultPath,
        tunnelConnections
    } = hostData;
    const userId = (req as any).userId;
    if (!isNonEmptyString(userId) || !isNonEmptyString(ip) || !isValidPort(port)) {
        logger.warn('Invalid SSH data input');
        return res.status(400).json({error: 'Invalid SSH data'});
    }

    const sshDataObj: any = {
        userId: userId,
        name,
        folder,
        tags: Array.isArray(tags) ? tags.join(',') : (tags || ''),
        ip,
        port,
        username,
        authType: authMethod,
        pin: !!pin ? 1 : 0,
        enableTerminal: !!enableTerminal ? 1 : 0,
        enableTunnel: !!enableTunnel ? 1 : 0,
        tunnelConnections: Array.isArray(tunnelConnections) ? JSON.stringify(tunnelConnections) : null,
        enableFileManager: !!enableFileManager ? 1 : 0,
        defaultPath: defaultPath || null,
    };

    if (authMethod === 'password') {
        sshDataObj.password = password;
        sshDataObj.key = null;
        sshDataObj.keyPassword = null;
        sshDataObj.keyType = null;
    } else if (authMethod === 'key') {
        sshDataObj.key = key;
        sshDataObj.keyPassword = keyPassword;
        sshDataObj.keyType = keyType;
        sshDataObj.password = null;
    }

    try {
        await db.insert(sshData).values(sshDataObj);
        res.json({message: 'SSH data created'});
    } catch (err) {
        logger.error('Failed to save SSH data', err);
        res.status(500).json({error: 'Failed to save SSH data'});
    }
});

// Route: Update SSH data (requires JWT)
// PUT /ssh/host/:id
router.put('/db/host/:id', authenticateJWT, upload.single('key'), async (req: Request, res: Response) => {
    let hostData: any;

    if (req.headers['content-type']?.includes('multipart/form-data')) {
        if (req.body.data) {
            try {
                hostData = JSON.parse(req.body.data);
            } catch (err) {
                logger.warn('Invalid JSON data in multipart request');
                return res.status(400).json({error: 'Invalid JSON data'});
            }
        } else {
            logger.warn('Missing data field in multipart request');
            return res.status(400).json({error: 'Missing data field'});
        }

        if (req.file) {
            hostData.key = req.file.buffer.toString('utf8');
        }
    } else {
        hostData = req.body;
    }

    const {
        name,
        folder,
        tags,
        ip,
        port,
        username,
        password,
        authMethod,
        key,
        keyPassword,
        keyType,
        pin,
        enableTerminal,
        enableTunnel,
        enableFileManager,
        defaultPath,
        tunnelConnections
    } = hostData;
    const {id} = req.params;
    const userId = (req as any).userId;
    if (!isNonEmptyString(userId) || !isNonEmptyString(ip) || !isValidPort(port) || !id) {
        logger.warn('Invalid SSH data input for update');
        return res.status(400).json({error: 'Invalid SSH data'});
    }

    const sshDataObj: any = {
        name,
        folder,
        tags: Array.isArray(tags) ? tags.join(',') : (tags || ''),
        ip,
        port,
        username,
        authType: authMethod,
        pin: !!pin ? 1 : 0,
        enableTerminal: !!enableTerminal ? 1 : 0,
        enableTunnel: !!enableTunnel ? 1 : 0,
        tunnelConnections: Array.isArray(tunnelConnections) ? JSON.stringify(tunnelConnections) : null,
        enableFileManager: !!enableFileManager ? 1 : 0,
        defaultPath: defaultPath || null,
    };

    if (authMethod === 'password') {
        sshDataObj.password = password;
        sshDataObj.key = null;
        sshDataObj.keyPassword = null;
        sshDataObj.keyType = null;
    } else if (authMethod === 'key') {
        sshDataObj.key = key;
        sshDataObj.keyPassword = keyPassword;
        sshDataObj.keyType = keyType;
        sshDataObj.password = null;
    }

    try {
        await db.update(sshData)
            .set(sshDataObj)
            .where(and(eq(sshData.id, Number(id)), eq(sshData.userId, userId)));
        res.json({message: 'SSH data updated'});
    } catch (err) {
        logger.error('Failed to update SSH data', err);
        res.status(500).json({error: 'Failed to update SSH data'});
    }
});

// Route: Get SSH data for the authenticated user (requires JWT)
// GET /ssh/host
router.get('/db/host', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    if (!isNonEmptyString(userId)) {
        logger.warn('Invalid userId for SSH data fetch');
        return res.status(400).json({error: 'Invalid userId'});
    }
    try {
        const data = await db
            .select()
            .from(sshData)
            .where(eq(sshData.userId, userId));
        const result = data.map((row: any) => ({
            ...row,
            tags: typeof row.tags === 'string' ? (row.tags ? row.tags.split(',').filter(Boolean) : []) : [],
            pin: !!row.pin,
            enableTerminal: !!row.enableTerminal,
            enableTunnel: !!row.enableTunnel,
            tunnelConnections: row.tunnelConnections ? JSON.parse(row.tunnelConnections) : [],
            enableFileManager: !!row.enableFileManager,
        }));
        res.json(result);
    } catch (err) {
        logger.error('Failed to fetch SSH data', err);
        res.status(500).json({error: 'Failed to fetch SSH data'});
    }
});

// Route: Get SSH host by ID (requires JWT)
// GET /ssh/host/:id
router.get('/db/host/:id', authenticateJWT, async (req: Request, res: Response) => {
    const {id} = req.params;
    const userId = (req as any).userId;

    if (!isNonEmptyString(userId) || !id) {
        logger.warn('Invalid request for SSH host fetch');
        return res.status(400).json({error: 'Invalid request'});
    }

    try {
        const data = await db
            .select()
            .from(sshData)
            .where(and(eq(sshData.id, Number(id)), eq(sshData.userId, userId)));

        if (data.length === 0) {
            return res.status(404).json({error: 'SSH host not found'});
        }

        const host = data[0];
        const result = {
            ...host,
            tags: typeof host.tags === 'string' ? (host.tags ? host.tags.split(',').filter(Boolean) : []) : [],
            pin: !!host.pin,
            enableTerminal: !!host.enableTerminal,
            enableTunnel: !!host.enableTunnel,
            tunnelConnections: host.tunnelConnections ? JSON.parse(host.tunnelConnections) : [],
            enableFileManager: !!host.enableFileManager,
        };

        res.json(result);
    } catch (err) {
        logger.error('Failed to fetch SSH host', err);
        res.status(500).json({error: 'Failed to fetch SSH host'});
    }
});

// Route: Get all unique folders for the authenticated user (requires JWT)
// GET /ssh/folders
router.get('/db/folders', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    if (!isNonEmptyString(userId)) {
        logger.warn('Invalid userId for SSH folder fetch');
        return res.status(400).json({error: 'Invalid userId'});
    }
    try {
        const data = await db
            .select({folder: sshData.folder})
            .from(sshData)
            .where(eq(sshData.userId, userId));

        const folderCounts: Record<string, number> = {};
        data.forEach(d => {
            if (d.folder && d.folder.trim() !== '') {
                folderCounts[d.folder] = (folderCounts[d.folder] || 0) + 1;
            }
        });

        const folders = Object.keys(folderCounts).filter(folder => folderCounts[folder] > 0);

        res.json(folders);
    } catch (err) {
        logger.error('Failed to fetch SSH folders', err);
        res.status(500).json({error: 'Failed to fetch SSH folders'});
    }
});

// Route: Delete SSH host by id (requires JWT)
// DELETE /ssh/host/:id
router.delete('/db/host/:id', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const {id} = req.params;
    if (!isNonEmptyString(userId) || !id) {
        logger.warn('Invalid userId or id for SSH host delete');
        return res.status(400).json({error: 'Invalid userId or id'});
    }
    try {
        const result = await db.delete(sshData)
            .where(and(eq(sshData.id, Number(id)), eq(sshData.userId, userId)));
        res.json({message: 'SSH host deleted'});
    } catch (err) {
        logger.error('Failed to delete SSH host', err);
        res.status(500).json({error: 'Failed to delete SSH host'});
    }
});

// Route: Get recent files (requires JWT)
// GET /ssh/file_manager/recent
router.get('/file_manager/recent', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const hostId = req.query.hostId ? parseInt(req.query.hostId as string) : null;

    if (!isNonEmptyString(userId)) {
        logger.warn('Invalid userId for recent files fetch');
        return res.status(400).json({error: 'Invalid userId'});
    }

    if (!hostId) {
        logger.warn('Host ID is required for recent files fetch');
        return res.status(400).json({error: 'Host ID is required'});
    }

    try {
        const recentFiles = await db
            .select()
            .from(fileManagerRecent)
            .where(and(
                eq(fileManagerRecent.userId, userId),
                eq(fileManagerRecent.hostId, hostId)
            ))
            .orderBy(desc(fileManagerRecent.lastOpened));
        res.json(recentFiles);
    } catch (err) {
        logger.error('Failed to fetch recent files', err);
        res.status(500).json({error: 'Failed to fetch recent files'});
    }
});

// Route: Add file to recent (requires JWT)
// POST /ssh/file_manager/recent
router.post('/file_manager/recent', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const {name, path, hostId} = req.body;
    if (!isNonEmptyString(userId) || !name || !path || !hostId) {
        logger.warn('Invalid request for adding recent file');
        return res.status(400).json({error: 'Invalid request - userId, name, path, and hostId are required'});
    }
    try {
        const conditions = [
            eq(fileManagerRecent.userId, userId),
            eq(fileManagerRecent.path, path),
            eq(fileManagerRecent.hostId, hostId)
        ];

        const existing = await db
            .select()
            .from(fileManagerRecent)
            .where(and(...conditions));

        if (existing.length > 0) {
            await db
                .update(fileManagerRecent)
                .set({lastOpened: new Date().toISOString()})
                .where(and(...conditions));
        } else {
            await db.insert(fileManagerRecent).values({
                userId,
                hostId,
                name,
                path,
                lastOpened: new Date().toISOString()
            });
        }
        res.json({message: 'File added to recent'});
    } catch (err) {
        logger.error('Failed to add recent file', err);
        res.status(500).json({error: 'Failed to add recent file'});
    }
});

// Route: Remove file from recent (requires JWT)
// DELETE /ssh/file_manager/recent
router.delete('/file_manager/recent', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const {name, path, hostId} = req.body;
    if (!isNonEmptyString(userId) || !name || !path || !hostId) {
        logger.warn('Invalid request for removing recent file');
        return res.status(400).json({error: 'Invalid request - userId, name, path, and hostId are required'});
    }
    try {
        const conditions = [
            eq(fileManagerRecent.userId, userId),
            eq(fileManagerRecent.path, path),
            eq(fileManagerRecent.hostId, hostId)
        ];

        const result = await db
            .delete(fileManagerRecent)
            .where(and(...conditions));
        res.json({message: 'File removed from recent'});
    } catch (err) {
        logger.error('Failed to remove recent file', err);
        res.status(500).json({error: 'Failed to remove recent file'});
    }
});

// Route: Get pinned files (requires JWT)
// GET /ssh/file_manager/pinned
router.get('/file_manager/pinned', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const hostId = req.query.hostId ? parseInt(req.query.hostId as string) : null;

    if (!isNonEmptyString(userId)) {
        logger.warn('Invalid userId for pinned files fetch');
        return res.status(400).json({error: 'Invalid userId'});
    }

    if (!hostId) {
        logger.warn('Host ID is required for pinned files fetch');
        return res.status(400).json({error: 'Host ID is required'});
    }

    try {
        const pinnedFiles = await db
            .select()
            .from(fileManagerPinned)
            .where(and(
                eq(fileManagerPinned.userId, userId),
                eq(fileManagerPinned.hostId, hostId)
            ))
            .orderBy(fileManagerPinned.pinnedAt);
        res.json(pinnedFiles);
    } catch (err) {
        logger.error('Failed to fetch pinned files', err);
        res.status(500).json({error: 'Failed to fetch pinned files'});
    }
});

// Route: Add file to pinned (requires JWT)
// POST /ssh/file_manager/pinned
router.post('/file_manager/pinned', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const {name, path, hostId} = req.body;
    if (!isNonEmptyString(userId) || !name || !path || !hostId) {
        logger.warn('Invalid request for adding pinned file');
        return res.status(400).json({error: 'Invalid request - userId, name, path, and hostId are required'});
    }
    try {
        const conditions = [
            eq(fileManagerPinned.userId, userId),
            eq(fileManagerPinned.path, path),
            eq(fileManagerPinned.hostId, hostId)
        ];

        const existing = await db
            .select()
            .from(fileManagerPinned)
            .where(and(...conditions));

        if (existing.length === 0) {
            await db.insert(fileManagerPinned).values({
                userId,
                hostId,
                name,
                path,
                pinnedAt: new Date().toISOString()
            });
        }
        res.json({message: 'File pinned successfully'});
    } catch (err) {
        logger.error('Failed to pin file', err);
        res.status(500).json({error: 'Failed to pin file'});
    }
});

// Route: Remove file from pinned (requires JWT)
// DELETE /ssh/file_manager/pinned
router.delete('/file_manager/pinned', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const {name, path, hostId} = req.body;
    if (!isNonEmptyString(userId) || !name || !path || !hostId) {
        logger.warn('Invalid request for removing pinned file');
        return res.status(400).json({error: 'Invalid request - userId, name, path, and hostId are required'});
    }
    try {
        const conditions = [
            eq(fileManagerPinned.userId, userId),
            eq(fileManagerPinned.path, path),
            eq(fileManagerPinned.hostId, hostId)
        ];

        const result = await db
            .delete(fileManagerPinned)
            .where(and(...conditions));
        res.json({message: 'File unpinned successfully'});
    } catch (err) {
        logger.error('Failed to unpin file', err);
        res.status(500).json({error: 'Failed to unpin file'});
    }
});

// Route: Get folder shortcuts (requires JWT)
// GET /ssh/file_manager/shortcuts
router.get('/file_manager/shortcuts', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const hostId = req.query.hostId ? parseInt(req.query.hostId as string) : null;

    if (!isNonEmptyString(userId)) {
        return res.status(400).json({error: 'Invalid userId'});
    }

    if (!hostId) {
        return res.status(400).json({error: 'Host ID is required'});
    }

    try {
        const shortcuts = await db
            .select()
            .from(fileManagerShortcuts)
            .where(and(
                eq(fileManagerShortcuts.userId, userId),
                eq(fileManagerShortcuts.hostId, hostId)
            ))
            .orderBy(fileManagerShortcuts.createdAt);
        res.json(shortcuts);
    } catch (err) {
        logger.error('Failed to fetch shortcuts', err);
        res.status(500).json({error: 'Failed to fetch shortcuts'});
    }
});

// Route: Add folder shortcut (requires JWT)
// POST /ssh/file_manager/shortcuts
router.post('/file_manager/shortcuts', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const {name, path, hostId} = req.body;
    if (!isNonEmptyString(userId) || !name || !path || !hostId) {
        return res.status(400).json({error: 'Invalid request - userId, name, path, and hostId are required'});
    }
    try {
        const conditions = [
            eq(fileManagerShortcuts.userId, userId),
            eq(fileManagerShortcuts.path, path),
            eq(fileManagerShortcuts.hostId, hostId)
        ];

        const existing = await db
            .select()
            .from(fileManagerShortcuts)
            .where(and(...conditions));

        if (existing.length === 0) {
            await db.insert(fileManagerShortcuts).values({
                userId,
                hostId,
                name,
                path,
                createdAt: new Date().toISOString()
            });
        }
        res.json({message: 'Shortcut added successfully'});
    } catch (err) {
        logger.error('Failed to add shortcut', err);
        res.status(500).json({error: 'Failed to add shortcut'});
    }
});

// Route: Remove folder shortcut (requires JWT)
// DELETE /ssh/file_manager/shortcuts
router.delete('/file_manager/shortcuts', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const {name, path, hostId} = req.body;
    if (!isNonEmptyString(userId) || !name || !path || !hostId) {
        return res.status(400).json({error: 'Invalid request - userId, name, path, and hostId are required'});
    }
    try {
        const conditions = [
            eq(fileManagerShortcuts.userId, userId),
            eq(fileManagerShortcuts.path, path),
            eq(fileManagerShortcuts.hostId, hostId)
        ];

        const result = await db
            .delete(fileManagerShortcuts)
            .where(and(...conditions));
        res.json({message: 'Shortcut removed successfully'});
    } catch (err) {
        logger.error('Failed to remove shortcut', err);
        res.status(500).json({error: 'Failed to remove shortcut'});
    }
});

// Route: Get SSH host by ID with resolved credentials (requires JWT)
// GET /ssh/host/:id/with-credentials
router.get('/db/host/:id/with-credentials', authenticateJWT, async (req: Request, res: Response) => {
    const {id} = req.params;
    const userId = (req as any).userId;

    if (!isNonEmptyString(userId) || !id) {
        logger.warn('Invalid request for SSH host with credentials fetch');
        return res.status(400).json({error: 'Invalid request'});
    }

    try {
        const {sshHostService} = await import('../../services/ssh-host.js');
        const host = await sshHostService.getHostWithCredentials(userId, parseInt(id));

        if (!host) {
            return res.status(404).json({error: 'SSH host not found'});
        }

        res.json(host);
    } catch (err) {
        logger.error('Failed to fetch SSH host with credentials', err);
        res.status(500).json({error: 'Failed to fetch SSH host with credentials'});
    }
});

// Route: Apply credential to SSH host (requires JWT)
// POST /ssh/host/:id/apply-credential
router.post('/db/host/:id/apply-credential', authenticateJWT, async (req: Request, res: Response) => {
    const {id: hostId} = req.params;
    const {credentialId} = req.body;
    const userId = (req as any).userId;

    if (!isNonEmptyString(userId) || !hostId || !credentialId) {
        logger.warn('Invalid request for applying credential to host');
        return res.status(400).json({error: 'Host ID and credential ID are required'});
    }

    try {
        const {sshHostService} = await import('../../services/ssh-host.js');
        await sshHostService.applyCredentialToHost(userId, parseInt(hostId), parseInt(credentialId));

        res.json({message: 'Credential applied to host successfully'});
    } catch (err) {
        logger.error('Failed to apply credential to host', err);
        res.status(500).json({
            error: err instanceof Error ? err.message : 'Failed to apply credential to host'
        });
    }
});

// Route: Remove credential from SSH host (requires JWT)
// DELETE /ssh/host/:id/credential
router.delete('/db/host/:id/credential', authenticateJWT, async (req: Request, res: Response) => {
    const {id: hostId} = req.params;
    const userId = (req as any).userId;

    if (!isNonEmptyString(userId) || !hostId) {
        logger.warn('Invalid request for removing credential from host');
        return res.status(400).json({error: 'Invalid request'});
    }

    try {
        const {sshHostService} = await import('../../services/ssh-host.js');
        await sshHostService.removeCredentialFromHost(userId, parseInt(hostId));

        res.json({message: 'Credential removed from host successfully'});
    } catch (err) {
        logger.error('Failed to remove credential from host', err);
        res.status(500).json({
            error: err instanceof Error ? err.message : 'Failed to remove credential from host'
        });
    }
});

// Route: Migrate host to managed credential (requires JWT)
// POST /ssh/host/:id/migrate-to-credential
router.post('/db/host/:id/migrate-to-credential', authenticateJWT, async (req: Request, res: Response) => {
    const {id: hostId} = req.params;
    const {credentialName} = req.body;
    const userId = (req as any).userId;

    if (!isNonEmptyString(userId) || !hostId || !credentialName) {
        logger.warn('Invalid request for migrating host to credential');
        return res.status(400).json({error: 'Host ID and credential name are required'});
    }

    try {
        const {sshHostService} = await import('../../services/ssh-host.js');
        const credentialId = await sshHostService.migrateHostToCredential(userId, parseInt(hostId), credentialName);

        res.json({
            message: 'Host migrated to managed credential successfully',
            credentialId
        });
    } catch (err) {
        logger.error('Failed to migrate host to credential', err);
        res.status(500).json({
            error: err instanceof Error ? err.message : 'Failed to migrate host to credential'
        });
    }
});

// Route: Bulk import SSH hosts from JSON (requires JWT)
// POST /ssh/bulk-import
router.post('/bulk-import', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const {hosts} = req.body;

    if (!Array.isArray(hosts) || hosts.length === 0) {
        logger.warn('Invalid bulk import data - hosts array is required and must not be empty');
        return res.status(400).json({error: 'Hosts array is required and must not be empty'});
    }

    if (hosts.length > 100) {
        logger.warn(`Bulk import attempted with too many hosts: ${hosts.length}`);
        return res.status(400).json({error: 'Maximum 100 hosts allowed per import'});
    }

    const results = {
        success: 0,
        failed: 0,
        errors: [] as string[]
    };

    for (let i = 0; i < hosts.length; i++) {
        const hostData = hosts[i];

        try {
            if (!isNonEmptyString(hostData.ip) || !isValidPort(hostData.port) || !isNonEmptyString(hostData.username)) {
                results.failed++;
                results.errors.push(`Host ${i + 1}: Missing or invalid required fields (ip, port, username)`);
                continue;
            }

            if (hostData.authType !== 'password' && hostData.authType !== 'key') {
                results.failed++;
                results.errors.push(`Host ${i + 1}: Invalid authType. Must be 'password' or 'key'`);
                continue;
            }

            if (hostData.authType === 'password' && !isNonEmptyString(hostData.password)) {
                results.failed++;
                results.errors.push(`Host ${i + 1}: Password required for password authentication`);
                continue;
            }

            if (hostData.authType === 'key' && !isNonEmptyString(hostData.key)) {
                results.failed++;
                results.errors.push(`Host ${i + 1}: SSH key required for key authentication`);
                continue;
            }

            if (hostData.enableTunnel && Array.isArray(hostData.tunnelConnections)) {
                for (let j = 0; j < hostData.tunnelConnections.length; j++) {
                    const conn = hostData.tunnelConnections[j];
                    if (!isValidPort(conn.sourcePort) || !isValidPort(conn.endpointPort) || !isNonEmptyString(conn.endpointHost)) {
                        results.failed++;
                        results.errors.push(`Host ${i + 1}, Tunnel ${j + 1}: Invalid tunnel connection data`);
                        break;
                    }
                }
            }

            const sshDataObj: any = {
                userId: userId,
                name: hostData.name || '',
                folder: hostData.folder || '',
                tags: Array.isArray(hostData.tags) ? hostData.tags.join(',') : (hostData.tags || ''),
                ip: hostData.ip,
                port: hostData.port,
                username: hostData.username,
                authType: hostData.authType,
                pin: !!hostData.pin ? 1 : 0,
                enableTerminal: !!hostData.enableTerminal ? 1 : 0,
                enableTunnel: !!hostData.enableTunnel ? 1 : 0,
                tunnelConnections: Array.isArray(hostData.tunnelConnections) ? JSON.stringify(hostData.tunnelConnections) : null,
                enableFileManager: !!hostData.enableFileManager ? 1 : 0,
                defaultPath: hostData.defaultPath || null,
            };

            if (hostData.authType === 'password') {
                sshDataObj.password = hostData.password;
                sshDataObj.key = null;
                sshDataObj.keyPassword = null;
                sshDataObj.keyType = null;
            } else if (hostData.authType === 'key') {
                sshDataObj.key = hostData.key;
                sshDataObj.keyPassword = hostData.keyPassword || null;
                sshDataObj.keyType = hostData.keyType || null;
                sshDataObj.password = null;
            }

            await db.insert(sshData).values(sshDataObj);
            results.success++;

        } catch (err) {
            results.failed++;
            results.errors.push(`Host ${i + 1}: ${err instanceof Error ? err.message : 'Unknown error'}`);
            logger.error(`Failed to import host ${i + 1}:`, err);
        }
    }

    if (results.success > 0) {
        logger.success(`Bulk import completed: ${results.success} successful, ${results.failed} failed`);
    } else {
        logger.warn(`Bulk import failed: ${results.failed} failed`);
    }

    res.json({
        message: `Import completed: ${results.success} successful, ${results.failed} failed`,
        ...results
    });
});

export default router; 