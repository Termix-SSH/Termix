import express from 'express';
import {db} from '../db/index.js';
import {sshData, sshCredentials, fileManagerRecent, fileManagerPinned, fileManagerShortcuts} from '../db/schema.js';
import {eq, and, desc} from 'drizzle-orm';
import type {Request, Response, NextFunction} from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { sshLogger } from '../../utils/logger.js';

const router = express.Router();

const upload = multer({storage: multer.memoryStorage()});

interface JWTPayload {
    userId: string;
}

function isNonEmptyString(value: any): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isValidPort(port: any): port is number {
    return typeof port === 'number' && port > 0 && port <= 65535;
}

function authenticateJWT(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        sshLogger.warn('Missing or invalid Authorization header');
        return res.status(401).json({error: 'Missing or invalid Authorization header'});
    }
    const token = authHeader.split(' ')[1];
    const jwtSecret = process.env.JWT_SECRET || 'secret';
    try {
        const payload = jwt.verify(token, jwtSecret) as JWTPayload;
        (req as any).userId = payload.userId;
        next();
    } catch (err) {
        sshLogger.warn('Invalid or expired token');
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
        sshLogger.warn('Unauthorized attempt to access internal SSH host endpoint');
        return res.status(403).json({error: 'Forbidden'});
    }
    try {
        const data = await db.select().from(sshData);
        const result = data.map((row: any) => {
            return {
                ...row,
                tags: typeof row.tags === 'string' ? (row.tags ? row.tags.split(',').filter(Boolean) : []) : [],
                pin: !!row.pin,
                enableTerminal: !!row.enableTerminal,
                enableTunnel: !!row.enableTunnel,
                tunnelConnections: row.tunnelConnections ? JSON.parse(row.tunnelConnections) : [],
                enableFileManager: !!row.enableFileManager,
            };
        });
        res.json(result);
    } catch (err) {
        sshLogger.error('Failed to fetch SSH data (internal)', err);
        res.status(500).json({error: 'Failed to fetch SSH data'});
    }
});

// Route: Create SSH data (requires JWT)
// POST /ssh/host
router.post('/db/host', authenticateJWT, upload.single('key'), async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    let hostData: any;

    if (req.headers['content-type']?.includes('multipart/form-data')) {
        if (req.body.data) {
            try {
                hostData = JSON.parse(req.body.data);
            } catch (err) {
                sshLogger.warn('Invalid JSON data in multipart request', { operation: 'host_create', userId, error: err });
                return res.status(400).json({error: 'Invalid JSON data'});
            }
        } else {
            sshLogger.warn('Missing data field in multipart request', { operation: 'host_create', userId });
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
        authType,
        credentialId,
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
    if (!isNonEmptyString(userId) || !isNonEmptyString(ip) || !isValidPort(port)) {
        sshLogger.warn('Invalid SSH data input validation failed', { 
            operation: 'host_create', 
            userId, 
            hasIp: !!ip, 
            port, 
            isValidPort: isValidPort(port) 
        });
        return res.status(400).json({error: 'Invalid SSH data'});
    }

    const effectiveAuthType = authType || authMethod;
    const sshDataObj: any = {
        userId: userId,
        name,
        folder: folder || null,
        tags: Array.isArray(tags) ? tags.join(',') : (tags || ''),
        ip,
        port,
        username,
        authType: effectiveAuthType,
        credentialId: credentialId || null,
        pin: pin ? 1 : 0,
        enableTerminal: enableTerminal ? 1 : 0,
        enableTunnel: enableTunnel ? 1 : 0,
        tunnelConnections: Array.isArray(tunnelConnections) ? JSON.stringify(tunnelConnections) : null,
        enableFileManager: enableFileManager ? 1 : 0,
        defaultPath: defaultPath || null,
    };

    if (effectiveAuthType === 'password') {
        sshDataObj.password = password || null;
        sshDataObj.key = null;
        sshDataObj.keyPassword = null;
        sshDataObj.keyType = null;
    } else if (effectiveAuthType === 'key') {
        sshDataObj.key = key || null;
        sshDataObj.keyPassword = keyPassword || null;
        sshDataObj.keyType = keyType;
        sshDataObj.password = null;
    }

    try {
        const result = await db.insert(sshData).values(sshDataObj).returning();
        
        if (result.length === 0) {
            sshLogger.warn('No host returned after creation', { operation: 'host_create', userId, name, ip, port });
            return res.status(500).json({error: 'Failed to create host'});
        }
        
        const createdHost = result[0];
        const baseHost = {
            ...createdHost,
            tags: typeof createdHost.tags === 'string' ? (createdHost.tags ? createdHost.tags.split(',').filter(Boolean) : []) : [],
            pin: !!createdHost.pin,
            enableTerminal: !!createdHost.enableTerminal,
            enableTunnel: !!createdHost.enableTunnel,
            tunnelConnections: createdHost.tunnelConnections ? JSON.parse(createdHost.tunnelConnections) : [],
            enableFileManager: !!createdHost.enableFileManager,
        };
        
        const resolvedHost = await resolveHostCredentials(baseHost) || baseHost;
        
        sshLogger.success(`SSH host created: ${name} (${ip}:${port}) by user ${userId}`, { 
            operation: 'host_create_success', 
            userId, 
            hostId: createdHost.id, 
            name, 
            ip, 
            port, 
            authType: effectiveAuthType 
        });
        
        res.json(resolvedHost);
    } catch (err) {
        sshLogger.error('Failed to save SSH host to database', err, { operation: 'host_create', userId, name, ip, port, authType: effectiveAuthType });
        res.status(500).json({error: 'Failed to save SSH data'});
    }
});

// Route: Update SSH data (requires JWT)
// PUT /ssh/host/:id
router.put('/db/host/:id', authenticateJWT, upload.single('key'), async (req: Request, res: Response) => {
    const hostId = req.params.id;
    const userId = (req as any).userId;
    let hostData: any;

    if (req.headers['content-type']?.includes('multipart/form-data')) {
        if (req.body.data) {
            try {
                hostData = JSON.parse(req.body.data);
            } catch (err) {
                sshLogger.warn('Invalid JSON data in multipart request', { operation: 'host_update', hostId: parseInt(hostId), userId, error: err });
                return res.status(400).json({error: 'Invalid JSON data'});
            }
        } else {
            sshLogger.warn('Missing data field in multipart request', { operation: 'host_update', hostId: parseInt(hostId), userId });
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
        authType,
        credentialId,
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
    if (!isNonEmptyString(userId) || !isNonEmptyString(ip) || !isValidPort(port) || !hostId) {
        sshLogger.warn('Invalid SSH data input validation failed for update', { 
            operation: 'host_update', 
            hostId: parseInt(hostId), 
            userId, 
            hasIp: !!ip, 
            port, 
            isValidPort: isValidPort(port) 
        });
        return res.status(400).json({error: 'Invalid SSH data'});
    }

    const effectiveAuthType = authType || authMethod;
    const sshDataObj: any = {
        name,
        folder,
        tags: Array.isArray(tags) ? tags.join(',') : (tags || ''),
        ip,
        port,
        username,
        authType: effectiveAuthType,
        credentialId: credentialId || null,
        pin: pin ? 1 : 0,
        enableTerminal: enableTerminal ? 1 : 0,
        enableTunnel: enableTunnel ? 1 : 0,
        tunnelConnections: Array.isArray(tunnelConnections) ? JSON.stringify(tunnelConnections) : null,
        enableFileManager: enableFileManager ? 1 : 0,
        defaultPath: defaultPath || null,
    };

    if (effectiveAuthType === 'password') {
        if (password) {
            sshDataObj.password = password;
        }
        sshDataObj.key = null;
        sshDataObj.keyPassword = null;
        sshDataObj.keyType = null;
    } else if (effectiveAuthType === 'key') {
        if (key) {
            sshDataObj.key = key;
        }
        if (keyPassword !== undefined) {
            sshDataObj.keyPassword = keyPassword || null;
        }
        if (keyType) {
            sshDataObj.keyType = keyType;
        }
        sshDataObj.password = null;
    }

    try {
        await db.update(sshData)
            .set(sshDataObj)
            .where(and(eq(sshData.id, Number(hostId)), eq(sshData.userId, userId)));
        
        const updatedHosts = await db
            .select()
            .from(sshData)
            .where(and(eq(sshData.id, Number(hostId)), eq(sshData.userId, userId)));
        
        if (updatedHosts.length === 0) {
            sshLogger.warn('Updated host not found after update', { operation: 'host_update', hostId: parseInt(hostId), userId });
            return res.status(404).json({error: 'Host not found after update'});
        }
        
        const updatedHost = updatedHosts[0];
        const baseHost = {
            ...updatedHost,
            tags: typeof updatedHost.tags === 'string' ? (updatedHost.tags ? updatedHost.tags.split(',').filter(Boolean) : []) : [],
            pin: !!updatedHost.pin,
            enableTerminal: !!updatedHost.enableTerminal,
            enableTunnel: !!updatedHost.enableTunnel,
            tunnelConnections: updatedHost.tunnelConnections ? JSON.parse(updatedHost.tunnelConnections) : [],
            enableFileManager: !!updatedHost.enableFileManager,
        };
        
        const resolvedHost = await resolveHostCredentials(baseHost) || baseHost;
        
        sshLogger.success(`SSH host updated: ${name} (${ip}:${port}) by user ${userId}`, { 
            operation: 'host_update_success', 
            userId, 
            hostId: parseInt(hostId), 
            name, 
            ip, 
            port, 
            authType: effectiveAuthType 
        });
        
        res.json(resolvedHost);
    } catch (err) {
        sshLogger.error('Failed to update SSH host in database', err, { operation: 'host_update', hostId: parseInt(hostId), userId, name, ip, port, authType: effectiveAuthType });
        res.status(500).json({error: 'Failed to update SSH data'});
    }
});

// Route: Get SSH data for the authenticated user (requires JWT)
// GET /ssh/host
router.get('/db/host', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    if (!isNonEmptyString(userId)) {
        sshLogger.warn('Invalid userId for SSH data fetch', { operation: 'host_fetch', userId });
        return res.status(400).json({error: 'Invalid userId'});
    }
    try {
        const data = await db
            .select()
            .from(sshData)
            .where(eq(sshData.userId, userId));
        
        const result = await Promise.all(data.map(async (row: any) => {
            const baseHost = {
                ...row,
                tags: typeof row.tags === 'string' ? (row.tags ? row.tags.split(',').filter(Boolean) : []) : [],
                pin: !!row.pin,
                enableTerminal: !!row.enableTerminal,
                enableTunnel: !!row.enableTunnel,
                tunnelConnections: row.tunnelConnections ? JSON.parse(row.tunnelConnections) : [],
                enableFileManager: !!row.enableFileManager,
            };
            
            return await resolveHostCredentials(baseHost) || baseHost;
        }));
        
        res.json(result);
    } catch (err) {
        sshLogger.error('Failed to fetch SSH hosts from database', err, { operation: 'host_fetch', userId });
        res.status(500).json({error: 'Failed to fetch SSH data'});
    }
});

// Route: Get SSH host by ID (requires JWT)
// GET /ssh/host/:id
router.get('/db/host/:id', authenticateJWT, async (req: Request, res: Response) => {
    const hostId = req.params.id;
    const userId = (req as any).userId;
    
    if (!isNonEmptyString(userId) || !hostId) {
        sshLogger.warn('Invalid userId or hostId for SSH host fetch by ID', { operation: 'host_fetch_by_id', hostId: parseInt(hostId), userId });
        return res.status(400).json({error: 'Invalid userId or hostId'});
    }
    try {
        const data = await db
            .select()
            .from(sshData)
            .where(and(eq(sshData.id, Number(hostId)), eq(sshData.userId, userId)));

        if (data.length === 0) {
            sshLogger.warn('SSH host not found', { operation: 'host_fetch_by_id', hostId: parseInt(hostId), userId });
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
        
        res.json(await resolveHostCredentials(result) || result);
    } catch (err) {
        sshLogger.error('Failed to fetch SSH host by ID from database', err, { operation: 'host_fetch_by_id', hostId: parseInt(hostId), userId });
        res.status(500).json({error: 'Failed to fetch SSH host'});
    }
});

// Route: Delete SSH host by id (requires JWT)
// DELETE /ssh/host/:id
router.delete('/db/host/:id', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const hostId = req.params.id;
    
    if (!isNonEmptyString(userId) || !hostId) {
        sshLogger.warn('Invalid userId or hostId for SSH host delete', { operation: 'host_delete', hostId: parseInt(hostId), userId });
        return res.status(400).json({error: 'Invalid userId or id'});
    }
    try {
        const hostToDelete = await db
            .select()
            .from(sshData)
            .where(and(eq(sshData.id, Number(hostId)), eq(sshData.userId, userId)));
        
        if (hostToDelete.length === 0) {
            sshLogger.warn('SSH host not found for deletion', { operation: 'host_delete', hostId: parseInt(hostId), userId });
            return res.status(404).json({error: 'SSH host not found'});
        }
        
        const result = await db.delete(sshData)
            .where(and(eq(sshData.id, Number(hostId)), eq(sshData.userId, userId)));
        
        const host = hostToDelete[0];
        sshLogger.success(`SSH host deleted: ${host.name} (${host.ip}:${host.port}) by user ${userId}`, { 
            operation: 'host_delete_success', 
            userId, 
            hostId: parseInt(hostId), 
            name: host.name, 
            ip: host.ip, 
            port: host.port 
        });
        
        res.json({message: 'SSH host deleted'});
    } catch (err) {
        sshLogger.error('Failed to delete SSH host from database', err, { operation: 'host_delete', hostId: parseInt(hostId), userId });
        res.status(500).json({error: 'Failed to delete SSH host'});
    }
});

// Route: Get recent files (requires JWT)
// GET /ssh/file_manager/recent
router.get('/file_manager/recent', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const hostId = req.query.hostId ? parseInt(req.query.hostId as string) : null;

    if (!isNonEmptyString(userId)) {
        sshLogger.warn('Invalid userId for recent files fetch');
        return res.status(400).json({error: 'Invalid userId'});
    }

    if (!hostId) {
        sshLogger.warn('Host ID is required for recent files fetch');
        return res.status(400).json({error: 'Host ID is required'});
    }

    try {
        const recentFiles = await db
            .select()
            .from(fileManagerRecent)
            .where(and(eq(fileManagerRecent.userId, userId), eq(fileManagerRecent.hostId, hostId)))
            .orderBy(desc(fileManagerRecent.lastOpened))
            .limit(20);

        res.json(recentFiles);
    } catch (err) {
        sshLogger.error('Failed to fetch recent files', err);
        res.status(500).json({error: 'Failed to fetch recent files'});
    }
});

// Route: Add recent file (requires JWT)
// POST /ssh/file_manager/recent
router.post('/file_manager/recent', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { hostId, path, name } = req.body;

    if (!isNonEmptyString(userId) || !hostId || !path) {
        sshLogger.warn('Invalid data for recent file addition');
        return res.status(400).json({error: 'Invalid data'});
    }

    try {
        // Check if file already exists
        const existing = await db
            .select()
            .from(fileManagerRecent)
            .where(and(
                eq(fileManagerRecent.userId, userId),
                eq(fileManagerRecent.hostId, hostId),
                eq(fileManagerRecent.path, path)
            ));

        if (existing.length > 0) {
            // Update last opened time
            await db
                .update(fileManagerRecent)
                .set({ lastOpened: new Date().toISOString() })
                .where(eq(fileManagerRecent.id, existing[0].id));
        } else {
            // Insert new record
            await db.insert(fileManagerRecent).values({
                userId,
                hostId,
                path,
                name: name || path.split('/').pop() || 'Unknown',
                lastOpened: new Date().toISOString()
            });
        }

        res.json({message: 'Recent file added'});
    } catch (err) {
        sshLogger.error('Failed to add recent file', err);
        res.status(500).json({error: 'Failed to add recent file'});
    }
});

// Route: Remove recent file (requires JWT)
// DELETE /ssh/file_manager/recent/:id
router.delete('/file_manager/recent/:id', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const id = req.params.id;

    if (!isNonEmptyString(userId) || !id) {
        sshLogger.warn('Invalid userId or id for recent file deletion');
        return res.status(400).json({error: 'Invalid userId or id'});
    }

    try {
        await db
            .delete(fileManagerRecent)
            .where(and(eq(fileManagerRecent.id, Number(id)), eq(fileManagerRecent.userId, userId)));

        res.json({message: 'Recent file removed'});
    } catch (err) {
        sshLogger.error('Failed to remove recent file', err);
        res.status(500).json({error: 'Failed to remove recent file'});
    }
});

// Route: Get pinned files (requires JWT)
// GET /ssh/file_manager/pinned
router.get('/file_manager/pinned', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const hostId = req.query.hostId ? parseInt(req.query.hostId as string) : null;

    if (!isNonEmptyString(userId)) {
        sshLogger.warn('Invalid userId for pinned files fetch');
        return res.status(400).json({error: 'Invalid userId'});
    }

    if (!hostId) {
        sshLogger.warn('Host ID is required for pinned files fetch');
        return res.status(400).json({error: 'Host ID is required'});
    }

    try {
        const pinnedFiles = await db
            .select()
            .from(fileManagerPinned)
            .where(and(eq(fileManagerPinned.userId, userId), eq(fileManagerPinned.hostId, hostId)))
            .orderBy(desc(fileManagerPinned.pinnedAt));

        res.json(pinnedFiles);
    } catch (err) {
        sshLogger.error('Failed to fetch pinned files', err);
        res.status(500).json({error: 'Failed to fetch pinned files'});
    }
});

// Route: Add pinned file (requires JWT)
// POST /ssh/file_manager/pinned
router.post('/file_manager/pinned', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { hostId, path, name } = req.body;

    if (!isNonEmptyString(userId) || !hostId || !path) {
        sshLogger.warn('Invalid data for pinned file addition');
        return res.status(400).json({error: 'Invalid data'});
    }

    try {
        // Check if file already exists
        const existing = await db
            .select()
            .from(fileManagerPinned)
            .where(and(
                eq(fileManagerPinned.userId, userId),
                eq(fileManagerPinned.hostId, hostId),
                eq(fileManagerPinned.path, path)
            ));

        if (existing.length > 0) {
            return res.status(409).json({error: 'File already pinned'});
        }

        await db.insert(fileManagerPinned).values({
            userId,
            hostId,
            path,
            name: name || path.split('/').pop() || 'Unknown',
            pinnedAt: new Date().toISOString()
        });

        res.json({message: 'File pinned'});
    } catch (err) {
        sshLogger.error('Failed to pin file', err);
        res.status(500).json({error: 'Failed to pin file'});
    }
});

// Route: Remove pinned file (requires JWT)
// DELETE /ssh/file_manager/pinned/:id
router.delete('/file_manager/pinned/:id', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const id = req.params.id;

    if (!isNonEmptyString(userId) || !id) {
        sshLogger.warn('Invalid userId or id for pinned file deletion');
        return res.status(400).json({error: 'Invalid userId or id'});
    }

    try {
        await db
            .delete(fileManagerPinned)
            .where(and(eq(fileManagerPinned.id, Number(id)), eq(fileManagerPinned.userId, userId)));

        res.json({message: 'Pinned file removed'});
    } catch (err) {
        sshLogger.error('Failed to remove pinned file', err);
        res.status(500).json({error: 'Failed to remove pinned file'});
    }
});

// Route: Get shortcuts (requires JWT)
// GET /ssh/file_manager/shortcuts
router.get('/file_manager/shortcuts', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const hostId = req.query.hostId ? parseInt(req.query.hostId as string) : null;

    if (!isNonEmptyString(userId)) {
        sshLogger.warn('Invalid userId for shortcuts fetch');
        return res.status(400).json({error: 'Invalid userId'});
    }

    if (!hostId) {
        sshLogger.warn('Host ID is required for shortcuts fetch');
        return res.status(400).json({error: 'Host ID is required'});
    }

    try {
        const shortcuts = await db
            .select()
            .from(fileManagerShortcuts)
            .where(and(eq(fileManagerShortcuts.userId, userId), eq(fileManagerShortcuts.hostId, hostId)))
            .orderBy(desc(fileManagerShortcuts.createdAt));

        res.json(shortcuts);
    } catch (err) {
        sshLogger.error('Failed to fetch shortcuts', err);
        res.status(500).json({error: 'Failed to fetch shortcuts'});
    }
});

// Route: Add shortcut (requires JWT)
// POST /ssh/file_manager/shortcuts
router.post('/file_manager/shortcuts', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { hostId, path, name } = req.body;

    if (!isNonEmptyString(userId) || !hostId || !path) {
        sshLogger.warn('Invalid data for shortcut addition');
        return res.status(400).json({error: 'Invalid data'});
    }

    try {
        // Check if shortcut already exists
        const existing = await db
            .select()
            .from(fileManagerShortcuts)
            .where(and(
                eq(fileManagerShortcuts.userId, userId),
                eq(fileManagerShortcuts.hostId, hostId),
                eq(fileManagerShortcuts.path, path)
            ));

        if (existing.length > 0) {
            return res.status(409).json({error: 'Shortcut already exists'});
        }

        await db.insert(fileManagerShortcuts).values({
            userId,
            hostId,
            path,
            name: name || path.split('/').pop() || 'Unknown',
            createdAt: new Date().toISOString()
        });

        res.json({message: 'Shortcut added'});
    } catch (err) {
        sshLogger.error('Failed to add shortcut', err);
        res.status(500).json({error: 'Failed to add shortcut'});
    }
});

// Route: Remove shortcut (requires JWT)
// DELETE /ssh/file_manager/shortcuts/:id
router.delete('/file_manager/shortcuts/:id', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const id = req.params.id;

    if (!isNonEmptyString(userId) || !id) {
        sshLogger.warn('Invalid userId or id for shortcut deletion');
        return res.status(400).json({error: 'Invalid userId or id'});
    }

    try {
        await db
            .delete(fileManagerShortcuts)
            .where(and(eq(fileManagerShortcuts.id, Number(id)), eq(fileManagerShortcuts.userId, userId)));

        res.json({message: 'Shortcut removed'});
    } catch (err) {
        sshLogger.error('Failed to remove shortcut', err);
        res.status(500).json({error: 'Failed to remove shortcut'});
    }
});

async function resolveHostCredentials(host: any): Promise<any> {
    try {
        if (host.credentialId && host.userId) {
            const credentials = await db
                .select()
                .from(sshCredentials)
                .where(and(
                    eq(sshCredentials.id, host.credentialId),
                    eq(sshCredentials.userId, host.userId)
                ));

            if (credentials.length > 0) {
                const credential = credentials[0];
                return {
                    ...host,
                    username: credential.username,
                    authType: credential.authType,
                    password: credential.password,
                    key: credential.key,
                    keyPassword: credential.keyPassword,
                    keyType: credential.keyType
                };
            }
        }
        return host;
    } catch (error) {
        sshLogger.warn(`Failed to resolve credentials for host ${host.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return host;
    }
}

// Route: Rename folder (requires JWT)
// PUT /ssh/db/folders/rename
router.put('/folders/rename', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { oldName, newName } = req.body;

    if (!isNonEmptyString(userId) || !oldName || !newName) {
        sshLogger.warn('Invalid data for folder rename');
        return res.status(400).json({error: 'Old name and new name are required'});
    }

    if (oldName === newName) {
        return res.json({message: 'Folder name unchanged'});
    }

    try {
        // Update all hosts with the old folder name
        const updatedHosts = await db
            .update(sshData)
            .set({ 
                folder: newName,
                updatedAt: new Date().toISOString()
            })
            .where(and(
                eq(sshData.userId, userId),
                eq(sshData.folder, oldName)
            ))
            .returning();

        // Update all credentials with the old folder name
        const updatedCredentials = await db
            .update(sshCredentials)
            .set({ 
                folder: newName,
                updatedAt: new Date().toISOString()
            })
            .where(and(
                eq(sshCredentials.userId, userId),
                eq(sshCredentials.folder, oldName)
            ))
            .returning();

        res.json({
            message: 'Folder renamed successfully',
            updatedHosts: updatedHosts.length,
            updatedCredentials: updatedCredentials.length
        });
    } catch (err) {
        sshLogger.error('Failed to rename folder', err, { operation: 'folder_rename', userId, oldName, newName });
        res.status(500).json({error: 'Failed to rename folder'});
    }
});

// Route: Bulk import SSH hosts (requires JWT)
// POST /ssh/bulk-import
router.post('/bulk-import', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { hosts } = req.body;

    if (!Array.isArray(hosts) || hosts.length === 0) {
        return res.status(400).json({ error: 'Hosts array is required and must not be empty' });
    }

    if (hosts.length > 100) {
        return res.status(400).json({ error: 'Maximum 100 hosts allowed per import' });
    }

    const results = {
        success: 0,
        failed: 0,
        errors: [] as string[]
    };

    for (let i = 0; i < hosts.length; i++) {
        const hostData = hosts[i];
        
        try {
            // Validate required fields
            if (!isNonEmptyString(hostData.ip) || !isValidPort(hostData.port) || !isNonEmptyString(hostData.username)) {
                results.failed++;
                results.errors.push(`Host ${i + 1}: Missing required fields (ip, port, username)`);
                continue;
            }

            // Validate authType
            if (!['password', 'key', 'credential'].includes(hostData.authType)) {
                results.failed++;
                results.errors.push(`Host ${i + 1}: Invalid authType. Must be 'password', 'key', or 'credential'`);
                continue;
            }

            // Validate authentication data based on authType
            if (hostData.authType === 'password' && !isNonEmptyString(hostData.password)) {
                results.failed++;
                results.errors.push(`Host ${i + 1}: Password required for password authentication`);
                continue;
            }

            if (hostData.authType === 'key' && !isNonEmptyString(hostData.key)) {
                results.failed++;
                results.errors.push(`Host ${i + 1}: Key required for key authentication`);
                continue;
            }

            if (hostData.authType === 'credential' && !hostData.credentialId) {
                results.failed++;
                results.errors.push(`Host ${i + 1}: credentialId required for credential authentication`);
                continue;
            }

            // Prepare host data for insertion
            const sshDataObj: any = {
                userId: userId,
                name: hostData.name || `${hostData.username}@${hostData.ip}`,
                folder: hostData.folder || 'Default',
                tags: Array.isArray(hostData.tags) ? hostData.tags.join(',') : '',
                ip: hostData.ip,
                port: hostData.port,
                username: hostData.username,
                password: hostData.authType === 'password' ? hostData.password : null,
                authType: hostData.authType,
                credentialId: hostData.authType === 'credential' ? hostData.credentialId : null,
                key: hostData.authType === 'key' ? hostData.key : null,
                keyPassword: hostData.authType === 'key' ? hostData.keyPassword : null,
                keyType: hostData.authType === 'key' ? (hostData.keyType || 'auto') : null,
                pin: hostData.pin || false,
                enableTerminal: hostData.enableTerminal !== false,
                enableTunnel: hostData.enableTunnel !== false,
                enableFileManager: hostData.enableFileManager !== false,
                defaultPath: hostData.defaultPath || '/',
                tunnelConnections: hostData.tunnelConnections ? JSON.stringify(hostData.tunnelConnections) : '[]',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            await db.insert(sshData).values(sshDataObj);
            results.success++;

        } catch (error) {
            results.failed++;
            results.errors.push(`Host ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    res.json({
        message: `Import completed: ${results.success} successful, ${results.failed} failed`,
        success: results.success,
        failed: results.failed,
        errors: results.errors
    });
});

export default router;