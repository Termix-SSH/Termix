import express from 'express';
import {db} from '../db/index.js';
import {users, settings} from '../db/schema.js';
import {eq, and} from 'drizzle-orm';
import chalk from 'chalk';
import bcrypt from 'bcryptjs';
import {nanoid} from 'nanoid';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import type {Request, Response, NextFunction} from 'express';

async function verifyOIDCToken(idToken: string, issuerUrl: string, clientId: string): Promise<any> {
    try {
        const normalizedIssuerUrl = issuerUrl.endsWith('/') ? issuerUrl.slice(0, -1) : issuerUrl;
        const possibleIssuers = [
            issuerUrl,
            normalizedIssuerUrl,
            issuerUrl.replace(/\/application\/o\/[^\/]+$/, ''),
            normalizedIssuerUrl.replace(/\/application\/o\/[^\/]+$/, '')
        ];

        const jwksUrls = [
            `${normalizedIssuerUrl}/.well-known/jwks.json`,
            `${normalizedIssuerUrl}/jwks/`,
            `${normalizedIssuerUrl.replace(/\/application\/o\/[^\/]+$/, '')}/.well-known/jwks.json`
        ];

        try {
            const discoveryUrl = `${normalizedIssuerUrl}/.well-known/openid-configuration`;
            const discoveryResponse = await fetch(discoveryUrl);
            if (discoveryResponse.ok) {
                const discovery = await discoveryResponse.json() as any;
                if (discovery.jwks_uri) {
                    jwksUrls.unshift(discovery.jwks_uri);
                }
            }
        } catch (discoveryError) {
            logger.error(`OIDC discovery failed: ${discoveryError}`);
        }

        let jwks: any = null;
        let jwksUrl: string | null = null;

        for (const url of jwksUrls) {
            try {
                const response = await fetch(url);
                if (response.ok) {
                    jwks = await response.json();
                    jwksUrl = url;
                    break;
                }
            } catch (error) {
                continue;
            }
        }

        if (!jwks) {
            throw new Error('Failed to fetch JWKS from any URL');
        }

        const header = JSON.parse(Buffer.from(idToken.split('.')[0], 'base64').toString());
        const keyId = header.kid;

        const publicKey = jwks.keys.find((key: any) => key.kid === keyId);
        if (!publicKey) {
            throw new Error(`No matching public key found for key ID: ${keyId}`);
        }

        const {importJWK, jwtVerify} = await import('jose');
        const key = await importJWK(publicKey);

        const {payload} = await jwtVerify(idToken, key, {
            issuer: possibleIssuers,
            audience: clientId,
        });

        return payload;
    } catch (error) {
        logger.error('OIDC token verification failed:', error);
        throw error;
    }
}

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

interface JWTPayload {
    userId: string;
    iat?: number;
    exp?: number;
}

// JWT authentication middleware
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

// Route: Create traditional user (username/password)
// POST /users/create
router.post('/create', async (req, res) => {
    try {
        const row = db.$client.prepare("SELECT value FROM settings WHERE key = 'allow_registration'").get();
        if (row && (row as any).value !== 'true') {
            return res.status(403).json({error: 'Registration is currently disabled'});
        }
    } catch (e) {
    }

    const {username, password} = req.body;

    if (!isNonEmptyString(username) || !isNonEmptyString(password)) {
        logger.warn('Invalid user creation attempt - missing username or password');
        return res.status(400).json({error: 'Username and password are required'});
    }

    try {
        const existing = await db
            .select()
            .from(users)
            .where(eq(users.username, username));
        if (existing && existing.length > 0) {
            logger.warn(`Attempt to create duplicate username: ${username}`);
            return res.status(409).json({error: 'Username already exists'});
        }

        let isFirstUser = false;
        try {
            const countResult = db.$client.prepare('SELECT COUNT(*) as count FROM users').get();
            isFirstUser = ((countResult as any)?.count || 0) === 0;
        } catch (e) {
            isFirstUser = true;
        }

        const saltRounds = parseInt(process.env.SALT || '10', 10);
        const password_hash = await bcrypt.hash(password, saltRounds);
        const id = nanoid();

        await db.insert(users).values({
            id,
            username,
            password_hash,
            is_admin: isFirstUser,
            is_oidc: false,
            client_id: '',
            client_secret: '',
            issuer_url: '',
            authorization_url: '',
            token_url: '',
            identifier_path: '',
            name_path: '',
            scopes: 'openid email profile',
            totp_secret: null,
            totp_enabled: false,
            totp_backup_codes: null,
        });

        logger.success(`Traditional user created: ${username} (is_admin: ${isFirstUser})`);
        res.json({message: 'User created', is_admin: isFirstUser});
    } catch (err) {
        logger.error('Failed to create user', err);
        res.status(500).json({error: 'Failed to create user'});
    }
});

// Route: Create OIDC provider configuration (admin only)
// POST /users/oidc-config
router.post('/oidc-config', authenticateJWT, async (req, res) => {
    const userId = (req as any).userId;
    try {
        const user = await db.select().from(users).where(eq(users.id, userId));
        if (!user || user.length === 0 || !user[0].is_admin) {
            return res.status(403).json({error: 'Not authorized'});
        }

        const {
            client_id,
            client_secret,
            issuer_url,
            authorization_url,
            token_url,
            identifier_path,
            name_path,
            scopes
        } = req.body;

        if (!isNonEmptyString(client_id) || !isNonEmptyString(client_secret) ||
            !isNonEmptyString(issuer_url) || !isNonEmptyString(authorization_url) ||
            !isNonEmptyString(token_url) || !isNonEmptyString(identifier_path) ||
            !isNonEmptyString(name_path)) {
            return res.status(400).json({error: 'All OIDC configuration fields are required'});
        }

        const config = {
            client_id,
            client_secret,
            issuer_url,
            authorization_url,
            token_url,
            identifier_path,
            name_path,
            scopes: scopes || 'openid email profile'
        };

        db.$client.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('oidc_config', ?)").run(JSON.stringify(config));

        res.json({message: 'OIDC configuration updated'});
    } catch (err) {
        logger.error('Failed to update OIDC config', err);
        res.status(500).json({error: 'Failed to update OIDC config'});
    }
});

// Route: Get OIDC configuration
// GET /users/oidc-config
router.get('/oidc-config', async (req, res) => {
    try {
        const row = db.$client.prepare("SELECT value FROM settings WHERE key = 'oidc_config'").get();
        if (!row) {
            return res.status(404).json({error: 'OIDC not configured'});
        }
        res.json(JSON.parse((row as any).value));
    } catch (err) {
        logger.error('Failed to get OIDC config', err);
        res.status(500).json({error: 'Failed to get OIDC config'});
    }
});

// Route: Get OIDC authorization URL
// GET /users/oidc/authorize
router.get('/oidc/authorize', async (req, res) => {
    try {
        const row = db.$client.prepare("SELECT value FROM settings WHERE key = 'oidc_config'").get();
        if (!row) {
            return res.status(404).json({error: 'OIDC not configured'});
        }

        const config = JSON.parse((row as any).value);
        const state = nanoid();
        const nonce = nanoid();

        let origin = req.get('Origin') || req.get('Referer')?.replace(/\/[^\/]*$/, '') || 'http://localhost:5173';

        if (origin.includes('localhost')) {
            origin = 'http://localhost:8081';
        }

        const redirectUri = `${origin}/users/oidc/callback`;

        db.$client.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(`oidc_state_${state}`, nonce);

        db.$client.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(`oidc_redirect_${state}`, redirectUri);

        const authUrl = new URL(config.authorization_url);
        authUrl.searchParams.set('client_id', config.client_id);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', config.scopes);
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('nonce', nonce);

        res.json({auth_url: authUrl.toString(), state, nonce});
    } catch (err) {
        logger.error('Failed to generate OIDC auth URL', err);
        res.status(500).json({error: 'Failed to generate authorization URL'});
    }
});

// Route: OIDC callback - exchange code for token and create/login user
// GET /users/oidc/callback
router.get('/oidc/callback', async (req, res) => {
    const {code, state} = req.query;

    if (!isNonEmptyString(code) || !isNonEmptyString(state)) {
        return res.status(400).json({error: 'Code and state are required'});
    }

    const storedRedirectRow = db.$client.prepare("SELECT value FROM settings WHERE key = ?").get(`oidc_redirect_${state}`);
    if (!storedRedirectRow) {
        return res.status(400).json({error: 'Invalid state parameter - redirect URI not found'});
    }
    const redirectUri = (storedRedirectRow as any).value;

    try {
        const storedNonce = db.$client.prepare("SELECT value FROM settings WHERE key = ?").get(`oidc_state_${state}`);
        if (!storedNonce) {
            return res.status(400).json({error: 'Invalid state parameter'});
        }

        db.$client.prepare("DELETE FROM settings WHERE key = ?").run(`oidc_state_${state}`);
        db.$client.prepare("DELETE FROM settings WHERE key = ?").run(`oidc_redirect_${state}`);

        const configRow = db.$client.prepare("SELECT value FROM settings WHERE key = 'oidc_config'").get();
        if (!configRow) {
            return res.status(500).json({error: 'OIDC not configured'});
        }

        const config = JSON.parse((configRow as any).value);

        const tokenResponse = await fetch(config.token_url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: config.client_id,
                client_secret: config.client_secret,
                code: code,
                redirect_uri: redirectUri,
            }),
        });

        if (!tokenResponse.ok) {
            logger.error('OIDC token exchange failed', await tokenResponse.text());
            return res.status(400).json({error: 'Failed to exchange authorization code'});
        }

        const tokenData = await tokenResponse.json() as any;

        let userInfo: any = null;
        const userInfoUrls = [];
        
        const normalizedIssuerUrl = config.issuer_url.endsWith('/') ? config.issuer_url.slice(0, -1) : config.issuer_url;
        const baseUrl = normalizedIssuerUrl.replace(/\/application\/o\/[^\/]+$/, '');
        
        userInfoUrls.push(`${baseUrl}/userinfo/`);
        userInfoUrls.push(`${normalizedIssuerUrl}/userinfo/`);
        userInfoUrls.push(`${normalizedIssuerUrl}/userinfo`);

        if (tokenData.id_token) {
            try {
                userInfo = await verifyOIDCToken(tokenData.id_token, config.issuer_url, config.client_id);
            } catch (error) {
                logger.error('OIDC token verification failed, trying userinfo endpoints', error);
            }
        }

        if (!userInfo && tokenData.access_token) {
            for (const userInfoUrl of userInfoUrls) {
                try {
                    const userInfoResponse = await fetch(userInfoUrl, {
                        headers: {
                            'Authorization': `Bearer ${tokenData.access_token}`,
                        }
                    });

                    if (userInfoResponse.ok) {
                        userInfo = await userInfoResponse.json();
                        break;
                    }
                } catch (error) {
                    continue;
                }
            }
        }

        if (!userInfo) {
            logger.error('Failed to get user information from all sources');
            return res.status(400).json({error: 'Failed to get user information'});
        }

        const getNestedValue = (obj: any, path: string): any => {
            if (!path || !obj) return null;
            return path.split('.').reduce((current, key) => current?.[key], obj);
        };

        const identifier = getNestedValue(userInfo, config.identifier_path) || 
                          userInfo[config.identifier_path] || 
                          userInfo.sub || 
                          userInfo.email || 
                          userInfo.preferred_username;
        
        const name = getNestedValue(userInfo, config.name_path) || 
                    userInfo[config.name_path] || 
                    userInfo.name || 
                    userInfo.given_name || 
                    identifier;

        if (!identifier) {
            logger.error(`Identifier not found at path: ${config.identifier_path}`);
            logger.error(`Available fields: ${Object.keys(userInfo).join(', ')}`);
            return res.status(400).json({error: `User identifier not found at path: ${config.identifier_path}. Available fields: ${Object.keys(userInfo).join(', ')}`});
        }

        let user = await db
            .select()
            .from(users)
            .where(and(eq(users.is_oidc, true), eq(users.oidc_identifier, identifier)));

        let isFirstUser = false;
        if (!user || user.length === 0) {
            try {
                const countResult = db.$client.prepare('SELECT COUNT(*) as count FROM users').get();
                isFirstUser = ((countResult as any)?.count || 0) === 0;
            } catch (e) {
                isFirstUser = true;
            }

            const id = nanoid();
            await db.insert(users).values({
                id,
                username: name,
                password_hash: '',
                is_admin: isFirstUser,
                is_oidc: true,
                oidc_identifier: identifier,
                client_id: config.client_id,
                client_secret: config.client_secret,
                issuer_url: config.issuer_url,
                authorization_url: config.authorization_url,
                token_url: config.token_url,
                identifier_path: config.identifier_path,
                name_path: config.name_path,
                scopes: config.scopes,
            });

            user = await db
                .select()
                .from(users)
                .where(eq(users.id, id));
        } else {
            await db.update(users)
                .set({username: name})
                .where(eq(users.id, user[0].id));

            user = await db
                .select()
                .from(users)
                .where(eq(users.id, user[0].id));
        }

        const userRecord = user[0];

        const jwtSecret = process.env.JWT_SECRET || 'secret';
        const token = jwt.sign({userId: userRecord.id}, jwtSecret, {
            expiresIn: '50d',
        });

        let frontendUrl = redirectUri.replace('/users/oidc/callback', '');

        if (frontendUrl.includes('localhost')) {
            frontendUrl = 'http://localhost:5173';
        }

        const redirectUrl = new URL(frontendUrl);
        redirectUrl.searchParams.set('success', 'true');
        redirectUrl.searchParams.set('token', token);

        res.redirect(redirectUrl.toString());

    } catch (err) {
        logger.error('OIDC callback failed', err);

        let frontendUrl = redirectUri.replace('/users/oidc/callback', '');

        if (frontendUrl.includes('localhost')) {
            frontendUrl = 'http://localhost:5173';
        }

        const redirectUrl = new URL(frontendUrl);
        redirectUrl.searchParams.set('error', 'OIDC authentication failed');

        res.redirect(redirectUrl.toString());
    }
});

// Route: Get user JWT by username and password (traditional login)
// POST /users/login
router.post('/login', async (req, res) => {
    const {username, password} = req.body;

    if (!isNonEmptyString(username) || !isNonEmptyString(password)) {
        logger.warn('Invalid traditional login attempt');
        return res.status(400).json({error: 'Invalid username or password'});
    }

    try {
        const user = await db
            .select()
            .from(users)
            .where(eq(users.username, username));

        if (!user || user.length === 0) {
            logger.warn(`User not found: ${username}`);
            return res.status(404).json({error: 'User not found'});
        }

        const userRecord = user[0];

        if (userRecord.is_oidc) {
            return res.status(403).json({error: 'This user uses external authentication'});
        }

        const isMatch = await bcrypt.compare(password, userRecord.password_hash);
        if (!isMatch) {
            logger.warn(`Incorrect password for user: ${username}`);
            return res.status(401).json({error: 'Incorrect password'});
        }

        const jwtSecret = process.env.JWT_SECRET || 'secret';
        const token = jwt.sign({userId: userRecord.id}, jwtSecret, {
            expiresIn: '50d',
        });

        if (userRecord.totp_enabled) {
            return res.json({
                requires_totp: true,
                temp_token: jwt.sign(
                    {userId: userRecord.id, pending_totp: true},
                    jwtSecret,
                    {expiresIn: '10m'}
                )
            });
        }

        return res.json({
            token,
            is_admin: !!userRecord.is_admin,
            username: userRecord.username
        });

    } catch (err) {
        logger.error('Failed to log in user', err);
        return res.status(500).json({error: 'Login failed'});
    }
});

// Route: Get current user's info using JWT
// GET /users/me
router.get('/me', authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    if (!isNonEmptyString(userId)) {
        logger.warn('Invalid userId in JWT for /users/me');
        return res.status(401).json({error: 'Invalid userId'});
    }
    try {
        const user = await db
            .select()
            .from(users)
            .where(eq(users.id, userId));
        if (!user || user.length === 0) {
            logger.warn(`User not found for /users/me: ${userId}`);
            return res.status(401).json({error: 'User not found'});
        }
        res.json({
            userId: user[0].id,
            username: user[0].username,
            is_admin: !!user[0].is_admin,
            is_oidc: !!user[0].is_oidc,
            totp_enabled: !!user[0].totp_enabled
        });
    } catch (err) {
        logger.error('Failed to get username', err);
        res.status(500).json({error: 'Failed to get username'});
    }
});

// Route: Count users
// GET /users/count
router.get('/count', async (req, res) => {
    try {
        const countResult = db.$client.prepare('SELECT COUNT(*) as count FROM users').get();
        const count = (countResult as any)?.count || 0;
        res.json({count});
    } catch (err) {
        logger.error('Failed to count users', err);
        res.status(500).json({error: 'Failed to count users'});
    }
});

// Route: DB health check (actually queries DB)
// GET /users/db-health
router.get('/db-health', async (req, res) => {
    try {
        db.$client.prepare('SELECT 1').get();
        res.json({status: 'ok'});
    } catch (err) {
        logger.error('DB health check failed', err);
        res.status(500).json({error: 'Database not accessible'});
    }
});

// Route: Get registration allowed status
// GET /users/registration-allowed
router.get('/registration-allowed', async (req, res) => {
    try {
        const row = db.$client.prepare("SELECT value FROM settings WHERE key = 'allow_registration'").get();
        res.json({allowed: row ? (row as any).value === 'true' : true});
    } catch (err) {
        logger.error('Failed to get registration allowed', err);
        res.status(500).json({error: 'Failed to get registration allowed'});
    }
});

// Route: Set registration allowed status (admin only)
// PATCH /users/registration-allowed
router.patch('/registration-allowed', authenticateJWT, async (req, res) => {
    const userId = (req as any).userId;
    try {
        const user = await db.select().from(users).where(eq(users.id, userId));
        if (!user || user.length === 0 || !user[0].is_admin) {
            return res.status(403).json({error: 'Not authorized'});
        }
        const {allowed} = req.body;
        if (typeof allowed !== 'boolean') {
            return res.status(400).json({error: 'Invalid value for allowed'});
        }
        db.$client.prepare("UPDATE settings SET value = ? WHERE key = 'allow_registration'").run(allowed ? 'true' : 'false');
        res.json({allowed});
    } catch (err) {
        logger.error('Failed to set registration allowed', err);
        res.status(500).json({error: 'Failed to set registration allowed'});
    }
});

// Route: Delete user account
// DELETE /users/delete-account
router.delete('/delete-account', authenticateJWT, async (req, res) => {
    const userId = (req as any).userId;
    const {password} = req.body;

    if (!isNonEmptyString(password)) {
        return res.status(400).json({error: 'Password is required to delete account'});
    }

    try {
        const user = await db.select().from(users).where(eq(users.id, userId));
        if (!user || user.length === 0) {
            return res.status(404).json({error: 'User not found'});
        }

        const userRecord = user[0];

        if (userRecord.is_oidc) {
            return res.status(403).json({error: 'Cannot delete external authentication accounts through this endpoint'});
        }

        const isMatch = await bcrypt.compare(password, userRecord.password_hash);
        if (!isMatch) {
            logger.warn(`Incorrect password provided for account deletion: ${userRecord.username}`);
            return res.status(401).json({error: 'Incorrect password'});
        }

        if (userRecord.is_admin) {
            const adminCount = db.$client.prepare('SELECT COUNT(*) as count FROM users WHERE is_admin = 1').get();
            if ((adminCount as any)?.count <= 1) {
                return res.status(403).json({error: 'Cannot delete the last admin user'});
            }
        }

        await db.delete(users).where(eq(users.id, userId));

        logger.success(`User account deleted: ${userRecord.username}`);
        res.json({message: 'Account deleted successfully'});

    } catch (err) {
        logger.error('Failed to delete user account', err);
        res.status(500).json({error: 'Failed to delete account'});
    }
});

// Route: Initiate password reset
// POST /users/initiate-reset
router.post('/initiate-reset', async (req, res) => {
    const {username} = req.body;

    if (!isNonEmptyString(username)) {
        return res.status(400).json({error: 'Username is required'});
    }

    try {
        const user = await db
            .select()
            .from(users)
            .where(eq(users.username, username));

        if (!user || user.length === 0) {
            logger.warn(`Password reset attempted for non-existent user: ${username}`);
            return res.status(404).json({error: 'User not found'});
        }

        if (user[0].is_oidc) {
            return res.status(403).json({error: 'Password reset not available for external authentication users'});
        }

        const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

        db.$client.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
            `reset_code_${username}`,
            JSON.stringify({code: resetCode, expiresAt: expiresAt.toISOString()})
        );

        logger.info(`Password reset code for user ${username}: ${resetCode} (expires at ${expiresAt.toLocaleString()})`);

        res.json({message: 'Password reset code has been generated and logged. Check docker logs for the code.'});

    } catch (err) {
        logger.error('Failed to initiate password reset', err);
        res.status(500).json({error: 'Failed to initiate password reset'});
    }
});

// Route: Verify reset code
// POST /users/verify-reset-code
router.post('/verify-reset-code', async (req, res) => {
    const {username, resetCode} = req.body;

    if (!isNonEmptyString(username) || !isNonEmptyString(resetCode)) {
        return res.status(400).json({error: 'Username and reset code are required'});
    }

    try {
        const resetDataRow = db.$client.prepare("SELECT value FROM settings WHERE key = ?").get(`reset_code_${username}`);
        if (!resetDataRow) {
            return res.status(400).json({error: 'No reset code found for this user'});
        }

        const resetData = JSON.parse((resetDataRow as any).value);
        const now = new Date();
        const expiresAt = new Date(resetData.expiresAt);

        if (now > expiresAt) {
            db.$client.prepare("DELETE FROM settings WHERE key = ?").run(`reset_code_${username}`);
            return res.status(400).json({error: 'Reset code has expired'});
        }

        if (resetData.code !== resetCode) {
            return res.status(400).json({error: 'Invalid reset code'});
        }

        const tempToken = nanoid();
        const tempTokenExpiry = new Date(Date.now() + 10 * 60 * 1000);

        db.$client.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
            `temp_reset_token_${username}`,
            JSON.stringify({token: tempToken, expiresAt: tempTokenExpiry.toISOString()})
        );

        res.json({message: 'Reset code verified', tempToken});

    } catch (err) {
        logger.error('Failed to verify reset code', err);
        res.status(500).json({error: 'Failed to verify reset code'});
    }
});

// Route: Complete password reset
// POST /users/complete-reset
router.post('/complete-reset', async (req, res) => {
    const {username, tempToken, newPassword} = req.body;

    if (!isNonEmptyString(username) || !isNonEmptyString(tempToken) || !isNonEmptyString(newPassword)) {
        return res.status(400).json({error: 'Username, temporary token, and new password are required'});
    }

    try {
        const tempTokenRow = db.$client.prepare("SELECT value FROM settings WHERE key = ?").get(`temp_reset_token_${username}`);
        if (!tempTokenRow) {
            return res.status(400).json({error: 'No temporary token found'});
        }

        const tempTokenData = JSON.parse((tempTokenRow as any).value);
        const now = new Date();
        const expiresAt = new Date(tempTokenData.expiresAt);

        if (now > expiresAt) {
            // Clean up expired token
            db.$client.prepare("DELETE FROM settings WHERE key = ?").run(`temp_reset_token_${username}`);
            return res.status(400).json({error: 'Temporary token has expired'});
        }

        if (tempTokenData.token !== tempToken) {
            return res.status(400).json({error: 'Invalid temporary token'});
        }

        const saltRounds = parseInt(process.env.SALT || '10', 10);
        const password_hash = await bcrypt.hash(newPassword, saltRounds);

        await db.update(users)
            .set({password_hash})
            .where(eq(users.username, username));

        db.$client.prepare("DELETE FROM settings WHERE key = ?").run(`reset_code_${username}`);
        db.$client.prepare("DELETE FROM settings WHERE key = ?").run(`temp_reset_token_${username}`);

        logger.success(`Password successfully reset for user: ${username}`);
        res.json({message: 'Password has been successfully reset'});

    } catch (err) {
        logger.error('Failed to complete password reset', err);
        res.status(500).json({error: 'Failed to complete password reset'});
    }
});

// Route: List all users (admin only)
// GET /users/list
router.get('/list', authenticateJWT, async (req, res) => {
    const userId = (req as any).userId;
    try {
        const user = await db.select().from(users).where(eq(users.id, userId));
        if (!user || user.length === 0 || !user[0].is_admin) {
            return res.status(403).json({error: 'Not authorized'});
        }

        const allUsers = await db.select({
            id: users.id,
            username: users.username,
            is_admin: users.is_admin,
            is_oidc: users.is_oidc
        }).from(users);

        res.json({users: allUsers});
    } catch (err) {
        logger.error('Failed to list users', err);
        res.status(500).json({error: 'Failed to list users'});
    }
});

// Route: Make user admin (admin only)
// POST /users/make-admin
router.post('/make-admin', authenticateJWT, async (req, res) => {
    const userId = (req as any).userId;
    const {username} = req.body;

    if (!isNonEmptyString(username)) {
        return res.status(400).json({error: 'Username is required'});
    }

    try {
        const adminUser = await db.select().from(users).where(eq(users.id, userId));
        if (!adminUser || adminUser.length === 0 || !adminUser[0].is_admin) {
            return res.status(403).json({error: 'Not authorized'});
        }

        const targetUser = await db.select().from(users).where(eq(users.username, username));
        if (!targetUser || targetUser.length === 0) {
            return res.status(404).json({error: 'User not found'});
        }

        if (targetUser[0].is_admin) {
            return res.status(400).json({error: 'User is already an admin'});
        }

        await db.update(users)
            .set({is_admin: true})
            .where(eq(users.username, username));

        logger.success(`User ${username} made admin by ${adminUser[0].username}`);
        res.json({message: `User ${username} is now an admin`});

    } catch (err) {
        logger.error('Failed to make user admin', err);
        res.status(500).json({error: 'Failed to make user admin'});
    }
});

// Route: Remove admin status (admin only)
// POST /users/remove-admin
router.post('/remove-admin', authenticateJWT, async (req, res) => {
    const userId = (req as any).userId;
    const {username} = req.body;

    if (!isNonEmptyString(username)) {
        return res.status(400).json({error: 'Username is required'});
    }

    try {
        const adminUser = await db.select().from(users).where(eq(users.id, userId));
        if (!adminUser || adminUser.length === 0 || !adminUser[0].is_admin) {
            return res.status(403).json({error: 'Not authorized'});
        }

        if (adminUser[0].username === username) {
            return res.status(400).json({error: 'Cannot remove your own admin status'});
        }

        const targetUser = await db.select().from(users).where(eq(users.username, username));
        if (!targetUser || targetUser.length === 0) {
            return res.status(404).json({error: 'User not found'});
        }

        if (!targetUser[0].is_admin) {
            return res.status(400).json({error: 'User is not an admin'});
        }

        await db.update(users)
            .set({is_admin: false})
            .where(eq(users.username, username));

        logger.success(`Admin status removed from ${username} by ${adminUser[0].username}`);
        res.json({message: `Admin status removed from ${username}`});

    } catch (err) {
        logger.error('Failed to remove admin status', err);
        res.status(500).json({error: 'Failed to remove admin status'});
    }
});

// Route: Verify TOTP during login
// POST /users/totp/verify-login
router.post('/totp/verify-login', async (req, res) => {
    const {temp_token, totp_code} = req.body;

    if (!temp_token || !totp_code) {
        return res.status(400).json({error: 'Token and TOTP code are required'});
    }

    const jwtSecret = process.env.JWT_SECRET || 'secret';
    
    try {
        const decoded = jwt.verify(temp_token, jwtSecret) as any;
        if (!decoded.pending_totp) {
            return res.status(401).json({error: 'Invalid temporary token'});
        }

        const user = await db.select().from(users).where(eq(users.id, decoded.userId));
        if (!user || user.length === 0) {
            return res.status(404).json({error: 'User not found'});
        }

        const userRecord = user[0];
        
        if (!userRecord.totp_enabled || !userRecord.totp_secret) {
            return res.status(400).json({error: 'TOTP not enabled for this user'});
        }

        const verified = speakeasy.totp.verify({
            secret: userRecord.totp_secret,
            encoding: 'base32',
            token: totp_code,
            window: 2
        });

        if (!verified) {
            const backupCodes = userRecord.totp_backup_codes ? JSON.parse(userRecord.totp_backup_codes) : [];
            const backupIndex = backupCodes.indexOf(totp_code);
            
            if (backupIndex === -1) {
                return res.status(401).json({error: 'Invalid TOTP code'});
            }
            
            backupCodes.splice(backupIndex, 1);
            await db.update(users)
                .set({totp_backup_codes: JSON.stringify(backupCodes)})
                .where(eq(users.id, userRecord.id));
        }

        const token = jwt.sign({userId: userRecord.id}, jwtSecret, {
            expiresIn: '50d',
        });

        return res.json({
            token,
            is_admin: !!userRecord.is_admin,
            username: userRecord.username
        });

    } catch (err) {
        logger.error('TOTP verification failed', err);
        return res.status(500).json({error: 'TOTP verification failed'});
    }
});

// Route: Setup TOTP
// POST /users/totp/setup
router.post('/totp/setup', authenticateJWT, async (req, res) => {
    const userId = (req as any).userId;
    
    try {
        const user = await db.select().from(users).where(eq(users.id, userId));
        if (!user || user.length === 0) {
            return res.status(404).json({error: 'User not found'});
        }

        const userRecord = user[0];
        
        if (userRecord.totp_enabled) {
            return res.status(400).json({error: 'TOTP is already enabled'});
        }

        const secret = speakeasy.generateSecret({
            name: `Termix (${userRecord.username})`,
            length: 32
        });

        await db.update(users)
            .set({totp_secret: secret.base32})
            .where(eq(users.id, userId));

        const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url || '');

        res.json({
            secret: secret.base32,
            qr_code: qrCodeUrl
        });

    } catch (err) {
        logger.error('Failed to setup TOTP', err);
        res.status(500).json({error: 'Failed to setup TOTP'});
    }
});

// Route: Enable TOTP
// POST /users/totp/enable
router.post('/totp/enable', authenticateJWT, async (req, res) => {
    const userId = (req as any).userId;
    const {totp_code} = req.body;

    if (!totp_code) {
        return res.status(400).json({error: 'TOTP code is required'});
    }

    try {
        const user = await db.select().from(users).where(eq(users.id, userId));
        if (!user || user.length === 0) {
            return res.status(404).json({error: 'User not found'});
        }

        const userRecord = user[0];
        
        if (userRecord.totp_enabled) {
            return res.status(400).json({error: 'TOTP is already enabled'});
        }

        if (!userRecord.totp_secret) {
            return res.status(400).json({error: 'TOTP setup not initiated'});
        }

        const verified = speakeasy.totp.verify({
            secret: userRecord.totp_secret,
            encoding: 'base32',
            token: totp_code,
            window: 2
        });

        if (!verified) {
            return res.status(401).json({error: 'Invalid TOTP code'});
        }

        const backupCodes = Array.from({length: 8}, () => 
            Math.random().toString(36).substring(2, 10).toUpperCase()
        );

        await db.update(users)
            .set({
                totp_enabled: true,
                totp_backup_codes: JSON.stringify(backupCodes)
            })
            .where(eq(users.id, userId));

        res.json({
            message: 'TOTP enabled successfully',
            backup_codes: backupCodes
        });

    } catch (err) {
        logger.error('Failed to enable TOTP', err);
        res.status(500).json({error: 'Failed to enable TOTP'});
    }
});

// Route: Disable TOTP
// POST /users/totp/disable
router.post('/totp/disable', authenticateJWT, async (req, res) => {
    const userId = (req as any).userId;
    const {password, totp_code} = req.body;

    if (!password && !totp_code) {
        return res.status(400).json({error: 'Password or TOTP code is required'});
    }

    try {
        const user = await db.select().from(users).where(eq(users.id, userId));
        if (!user || user.length === 0) {
            return res.status(404).json({error: 'User not found'});
        }

        const userRecord = user[0];
        
        if (!userRecord.totp_enabled) {
            return res.status(400).json({error: 'TOTP is not enabled'});
        }

        if (password && !userRecord.is_oidc) {
            const isMatch = await bcrypt.compare(password, userRecord.password_hash);
            if (!isMatch) {
                return res.status(401).json({error: 'Incorrect password'});
            }
        } else if (totp_code) {
            const verified = speakeasy.totp.verify({
                secret: userRecord.totp_secret!,
                encoding: 'base32',
                token: totp_code,
                window: 2
            });

            if (!verified) {
                return res.status(401).json({error: 'Invalid TOTP code'});
            }
        } else {
            return res.status(400).json({error: 'Authentication required'});
        }

        await db.update(users)
            .set({
                totp_enabled: false,
                totp_secret: null,
                totp_backup_codes: null
            })
            .where(eq(users.id, userId));

        res.json({message: 'TOTP disabled successfully'});

    } catch (err) {
        logger.error('Failed to disable TOTP', err);
        res.status(500).json({error: 'Failed to disable TOTP'});
    }
});

// Route: Generate new backup codes
// POST /users/totp/backup-codes
router.post('/totp/backup-codes', authenticateJWT, async (req, res) => {
    const userId = (req as any).userId;
    const {password, totp_code} = req.body;

    if (!password && !totp_code) {
        return res.status(400).json({error: 'Password or TOTP code is required'});
    }

    try {
        const user = await db.select().from(users).where(eq(users.id, userId));
        if (!user || user.length === 0) {
            return res.status(404).json({error: 'User not found'});
        }

        const userRecord = user[0];
        
        if (!userRecord.totp_enabled) {
            return res.status(400).json({error: 'TOTP is not enabled'});
        }

        if (password && !userRecord.is_oidc) {
            const isMatch = await bcrypt.compare(password, userRecord.password_hash);
            if (!isMatch) {
                return res.status(401).json({error: 'Incorrect password'});
            }
        } else if (totp_code) {
            const verified = speakeasy.totp.verify({
                secret: userRecord.totp_secret!,
                encoding: 'base32',
                token: totp_code,
                window: 2
            });

            if (!verified) {
                return res.status(401).json({error: 'Invalid TOTP code'});
            }
        } else {
            return res.status(400).json({error: 'Authentication required'});
        }

        const backupCodes = Array.from({length: 8}, () => 
            Math.random().toString(36).substring(2, 10).toUpperCase()
        );

        await db.update(users)
            .set({totp_backup_codes: JSON.stringify(backupCodes)})
            .where(eq(users.id, userId));

        res.json({backup_codes: backupCodes});

    } catch (err) {
        logger.error('Failed to generate backup codes', err);
        res.status(500).json({error: 'Failed to generate backup codes'});
    }
});

// Route: Delete user (admin only)
// DELETE /users/delete-user
router.delete('/delete-user', authenticateJWT, async (req, res) => {
    const userId = (req as any).userId;
    const {username} = req.body;

    if (!isNonEmptyString(username)) {
        return res.status(400).json({error: 'Username is required'});
    }

    try {
        const adminUser = await db.select().from(users).where(eq(users.id, userId));
        if (!adminUser || adminUser.length === 0 || !adminUser[0].is_admin) {
            return res.status(403).json({error: 'Not authorized'});
        }

        if (adminUser[0].username === username) {
            return res.status(400).json({error: 'Cannot delete your own account'});
        }

        const targetUser = await db.select().from(users).where(eq(users.username, username));
        if (!targetUser || targetUser.length === 0) {
            return res.status(404).json({error: 'User not found'});
        }

        if (targetUser[0].is_admin) {
            const adminCount = db.$client.prepare('SELECT COUNT(*) as count FROM users WHERE is_admin = 1').get();
            if ((adminCount as any)?.count <= 1) {
                return res.status(403).json({error: 'Cannot delete the last admin user'});
            }
        }

        const targetUserId = targetUser[0].id;

        try {
            db.$client.prepare('DELETE FROM file_manager_recent WHERE user_id = ?').run(targetUserId);
            db.$client.prepare('DELETE FROM file_manager_pinned WHERE user_id = ?').run(targetUserId);
            db.$client.prepare('DELETE FROM file_manager_shortcuts WHERE user_id = ?').run(targetUserId);
            db.$client.prepare('DELETE FROM ssh_data WHERE user_id = ?').run(targetUserId);
        } catch (cleanupError) {
            logger.error(`Cleanup failed for user ${username}:`, cleanupError);
        }

        await db.delete(users).where(eq(users.id, targetUserId));

        logger.success(`User ${username} deleted by admin ${adminUser[0].username}`);
        res.json({message: `User ${username} deleted successfully`});

    } catch (err) {
        logger.error('Failed to delete user', err);

        if (err && typeof err === 'object' && 'code' in err) {
            if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
                res.status(400).json({error: 'Cannot delete user: User has associated data that cannot be removed'});
            } else {
                res.status(500).json({error: `Database error: ${err.code}`});
            }
        } else {
            res.status(500).json({error: 'Failed to delete account'});
        }
    }
});

export default router;