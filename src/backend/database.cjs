const http = require('http');
const socketIo = require('socket.io');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const logger = {
    info: (...args) => console.log(`📦 | 🔧 [${new Date().toISOString()}] INFO:`, ...args),
    error: (...args) => console.error(`📦 | ❌  [${new Date().toISOString()}] ERROR:`, ...args),
    warn: (...args) => console.warn(`📦 | ⚠️ [${new Date().toISOString()}] WARN:`, ...args),
    debug: (...args) => console.debug(`📦 | 🔍 [${new Date().toISOString()}] DEBUG:`, ...args)
};


const dataDir = process.env.DATA_DIR || path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const settingsFilePath = path.join(dataDir, 'settings.json');
let appSettings = {
    accountCreationEnabled: true
};

if (fs.existsSync(settingsFilePath)) {
    try {
        appSettings = JSON.parse(fs.readFileSync(settingsFilePath, 'utf8'));
    } catch (error) {
        logger.error('Failed to parse settings file, using defaults', error);
    }
} else {
    fs.writeFileSync(settingsFilePath, JSON.stringify(appSettings, null, 2));
}


const saveSettings = () => {
    try {
        fs.writeFileSync(settingsFilePath, JSON.stringify(appSettings, null, 2))
    } catch (error) {
        logger.error('Failed to save settings file', error);
    }
};

const dbPath = path.join(dataDir, 'termix.db');
const db = new Database(dbPath);
logger.info(`Connected to SQLite database`);


const server = http.createServer();
const io = socketIo(server, {
    path: '/database.io/socket.io',
    cors: { origin: '*', methods: ['GET', 'POST'] }
});


function initializeDatabase() {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            sessionToken TEXT NOT NULL,
            isAdmin INTEGER DEFAULT 0
        )
    `).run();
    

    db.prepare(`
        CREATE TABLE IF NOT EXISTS hosts (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            config TEXT NOT NULL,
            createdBy TEXT NOT NULL,
            folder TEXT,
            isPinned INTEGER DEFAULT 0,
            FOREIGN KEY (createdBy) REFERENCES users(id)
        )
    `).run();
    

    db.prepare(`
        CREATE TABLE IF NOT EXISTS host_users (
            hostId TEXT NOT NULL,
            userId TEXT NOT NULL,
            PRIMARY KEY (hostId, userId),
            FOREIGN KEY (hostId) REFERENCES hosts(id),
            FOREIGN KEY (userId) REFERENCES users(id)
        )
    `).run();
    

    db.prepare(`
        CREATE TABLE IF NOT EXISTS host_tags (
            hostId TEXT NOT NULL,
            tag TEXT NOT NULL,
            PRIMARY KEY (hostId, tag),
            FOREIGN KEY (hostId) REFERENCES hosts(id)
        )
    `).run();
    

    db.prepare(`
        CREATE TABLE IF NOT EXISTS snippets (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            content TEXT NOT NULL,
            createdBy TEXT NOT NULL,
            folder TEXT,
            isPinned INTEGER DEFAULT 0,
            FOREIGN KEY (createdBy) REFERENCES users(id)
        )
    `).run();
    

    db.prepare(`
        CREATE TABLE IF NOT EXISTS snippet_users (
            snippetId TEXT NOT NULL,
            userId TEXT NOT NULL,
            PRIMARY KEY (snippetId, userId),
            FOREIGN KEY (snippetId) REFERENCES snippets(id),
            FOREIGN KEY (userId) REFERENCES users(id)
        )
    `).run();
    

    db.prepare(`
        CREATE TABLE IF NOT EXISTS snippet_tags (
            snippetId TEXT NOT NULL,
            tag TEXT NOT NULL,
            PRIMARY KEY (snippetId, tag),
            FOREIGN KEY (snippetId) REFERENCES snippets(id)
        )
    `).run();

    const userTableInfo = db.prepare(`PRAGMA table_info(users)`).all();
    const hasIsAdminColumn = userTableInfo.some(column => column.name === 'isAdmin');
    
    if (!hasIsAdminColumn) {
        db.prepare(`ALTER TABLE users ADD COLUMN isAdmin INTEGER DEFAULT 0`).run();
    }
    
    logger.info('Database tables initialized');
}


initializeDatabase();


const getEncryptionKey = (userId, sessionToken) => {
    const salt = process.env.SALT || 'default_salt';
    return crypto.scryptSync(`${userId}-${sessionToken}`, salt, 32);
};

const encryptData = (data, userId, sessionToken) => {
    try {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(userId, sessionToken), iv);
        const encrypted = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
        return `${iv.toString('hex')}:${encrypted.toString('hex')}:${cipher.getAuthTag().toString('hex')}`;
    } catch (error) {
        logger.error('Encryption failed:', error);
        return null;
    }
};

const decryptData = (encryptedData, userId, sessionToken) => {
    try {
        const [ivHex, contentHex, authTagHex] = encryptedData.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const content = Buffer.from(contentHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');

        const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(userId, sessionToken), iv);
        decipher.setAuthTag(authTag);

        return JSON.parse(Buffer.concat([decipher.update(content), decipher.final()]).toString());
    } catch (error) {
        logger.error('Decryption failed:', error);
        return null;
    }
};

db.function('decrypt', (encryptedData, userId, sessionToken) => {
    try {
        return JSON.stringify(decryptData(encryptedData, userId, sessionToken));
    } catch (error) {
        logger.error('SQLite decrypt function failed:', error);
        return null;
    }
});

const statements = {
    findUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
    findUserBySessionToken: db.prepare('SELECT * FROM users WHERE sessionToken = ?'),
    findUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
    findUserByIdAndSessionToken: db.prepare('SELECT * FROM users WHERE id = ? AND sessionToken = ?'),
    createUser: db.prepare('INSERT INTO users (id, username, password, sessionToken, isAdmin) VALUES (?, ?, ?, ?, ?)'),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
    countAdminUsers: db.prepare('SELECT COUNT(*) as count FROM users WHERE isAdmin = 1'),
    countAllUsers: db.prepare('SELECT COUNT(*) as count FROM users'),
    findAllAdmins: db.prepare('SELECT id, username FROM users WHERE isAdmin = 1'),
    updateUserAdmin: db.prepare('UPDATE users SET isAdmin = ? WHERE username = ?'),
    

    createHost: db.prepare('INSERT INTO hosts (id, name, config, createdBy, folder, isPinned) VALUES (?, ?, ?, ?, ?, ?)'),
    addHostUser: db.prepare('INSERT INTO host_users (hostId, userId) VALUES (?, ?)'),
    addHostTag: db.prepare('INSERT INTO host_tags (hostId, tag) VALUES (?, ?)'),
    findHostById: db.prepare('SELECT * FROM hosts WHERE id = ?'),
    findHostByIdAndCreator: db.prepare('SELECT * FROM hosts WHERE id = ? AND createdBy = ?'),
    findHostsByUser: db.prepare('SELECT h.* FROM hosts h JOIN host_users hu ON h.id = hu.hostId WHERE hu.userId = ?'),
    findHostsByCreator: db.prepare('SELECT * FROM hosts WHERE createdBy = ?'),
    findSharedHostsWithUser: db.prepare('SELECT h.* FROM hosts h JOIN host_users hu ON h.id = hu.hostId WHERE hu.userId = ? AND h.createdBy != ?'),
    findHostsByName: db.prepare('SELECT * FROM hosts WHERE createdBy = ? AND LOWER(name) = LOWER(?)'),
    findHostUsers: db.prepare('SELECT userId FROM host_users WHERE hostId = ?'),
    findHostTags: db.prepare('SELECT tag FROM host_tags WHERE hostId = ?'),
    updateHost: db.prepare('UPDATE hosts SET name = ?, config = ?, folder = ?, isPinned = ? WHERE id = ?'),
    deleteHost: db.prepare('DELETE FROM hosts WHERE id = ? AND createdBy = ?'),
    deleteHostUsers: db.prepare('DELETE FROM host_users WHERE hostId = ?'),
    deleteHostTags: db.prepare('DELETE FROM host_tags WHERE hostId = ?'),
    removeHostUser: db.prepare('DELETE FROM host_users WHERE hostId = ? AND userId = ?'),
    

    createSnippet: db.prepare('INSERT INTO snippets (id, name, content, createdBy, folder, isPinned) VALUES (?, ?, ?, ?, ?, ?)'),
    addSnippetUser: db.prepare('INSERT INTO snippet_users (snippetId, userId) VALUES (?, ?)'),
    addSnippetTag: db.prepare('INSERT INTO snippet_tags (snippetId, tag) VALUES (?, ?)'),
    findSnippetById: db.prepare('SELECT * FROM snippets WHERE id = ?'),
    findSnippetByIdAndCreator: db.prepare('SELECT * FROM snippets WHERE id = ? AND createdBy = ?'),
    findSnippetsByUser: db.prepare('SELECT s.* FROM snippets s JOIN snippet_users su ON s.id = su.snippetId WHERE su.userId = ?'),
    findSnippetsByName: db.prepare('SELECT * FROM snippets WHERE createdBy = ? AND LOWER(name) = LOWER(?)'),
    findSnippetUsers: db.prepare('SELECT userId FROM snippet_users WHERE snippetId = ?'),
    findSnippetTags: db.prepare('SELECT tag FROM snippet_tags WHERE snippetId = ?'),
    updateSnippet: db.prepare('UPDATE snippets SET name = ?, content = ?, folder = ?, isPinned = ? WHERE id = ?'),
    deleteSnippet: db.prepare('DELETE FROM snippets WHERE id = ? AND createdBy = ?'),
    deleteSnippetUsers: db.prepare('DELETE FROM snippet_users WHERE snippetId = ?'),
    deleteSnippetTags: db.prepare('DELETE FROM snippet_tags WHERE snippetId = ?'),
    removeSnippetUser: db.prepare('DELETE FROM snippet_users WHERE snippetId = ? AND userId = ?'),
    insertSnippet: db.prepare('INSERT INTO snippets (name, content, createdBy, folder, isPinned) VALUES (?, ?, ?, ?, ?)'),
    checkSnippetShare: db.prepare('SELECT * FROM snippet_users WHERE snippetId = ? AND userId = ?'),
    updateSnippetPinStatus: db.prepare('UPDATE snippets SET isPinned = ? WHERE id = ?'),
    checkHostSharing: db.prepare('SELECT * FROM host_users WHERE hostId = ? AND userId = ?'),
    findHostByIpAndUser: db.prepare('SELECT h.* FROM hosts h JOIN users u ON h.createdBy = u.id WHERE h.createdBy = ? AND json_extract(decrypt(h.config, u.id, ?), \'$.ip\') = ? AND json_extract(decrypt(h.config, u.id, ?), \'$.user\') = ?')
};


function generateId() {
    return crypto.randomBytes(16).toString('hex');
}

function getUserById(userId) {
    return statements.findUserById.get(userId);
}

function getHostWithDetails(host, userId, sessionToken) {
    if (!host) return null;
    

    const userIds = statements.findHostUsers.all(host.id).map(row => row.userId);
    

    const tags = statements.findHostTags.all(host.id).map(row => row.tag);
    

    const createdBy = statements.findUserById.get(host.createdBy);
    if (!createdBy) return null;
    

    const decryptedConfig = decryptData(host.config, createdBy.id, createdBy.sessionToken);
    if (!decryptedConfig) return null;
    
    return {
        ...host,
        users: userIds,
        tags,
        createdBy,
        config: decryptedConfig,
        isPinned: !!host.isPinned
    };
}

function getSnippetWithDetails(snippet, userId, sessionToken) {
    if (!snippet) return null;
    

    const userIds = statements.findSnippetUsers.all(snippet.id).map(row => row.userId);
    

    const tags = statements.findSnippetTags.all(snippet.id).map(row => row.tag);
    

    const createdBy = statements.findUserById.get(snippet.createdBy);
    if (!createdBy) return null;
    

    let content = null;
    try {
        if (snippet.content) {

            if (snippet.content.includes(':')) {
                const decryptedContent = decryptData(snippet.content, createdBy.id, createdBy.sessionToken);
                if (decryptedContent) {
                    content = decryptedContent;
                } else {
                    logger.warn(`Failed to decrypt content for snippet`);

                    content = snippet.content;
                }
            } else {

                content = snippet.content;
            }
        }
    } catch (error) {
        logger.warn(`Error handling snippet content: ${error.message}`);

        content = snippet.content;
    }
    
    return {
        ...snippet,
        users: userIds,
        tags,
        createdBy,
        content: content,
        isPinned: !!snippet.isPinned
    };
}

logger.info('Database is ready');

io.of('/database.io').on('connection', (socket) => {
    socket.on('createUser', async ({ username, password, isAdmin }, callback) => {
        try {
            logger.debug(`Creating user: ${username}`);

            if (!appSettings.accountCreationEnabled) {
                const userCount = statements.countAllUsers.get().count;
                if (userCount > 0) {
                    logger.warn(`Account creation attempted while disabled`);
                    return callback({ error: 'Account creation has been disabled by an administrator' });
                }
            }

            const existingUser = statements.findUserByUsername.get(username);
            if (existingUser) {
                logger.warn(`Username already exists: ${username}`);
                return callback({ error: 'Username already exists' });
            }

            const sessionToken = crypto.randomBytes(64).toString('hex');
            const userId = generateId();
            const hashedPassword = await bcrypt.hash(password, 10);

            const adminCount = statements.countAdminUsers.get().count;
            const makeAdmin = adminCount === 0 || isAdmin === true ? 1 : 0;

            statements.createUser.run(userId, username, hashedPassword, sessionToken, makeAdmin);

            logger.info(`User created: ${username}`);
            callback({ success: true, user: {
                id: userId,
                username,
                sessionToken,
                isAdmin: makeAdmin === 1
            }});
        } catch (error) {
            logger.error('User creation error:', error);
            callback({ error: 'User creation failed' });
        }
    });

    socket.on('loginUser', async ({ username, password, sessionToken }, callback) => {
        try {
            let user;
            if (sessionToken) {
                user = statements.findUserBySessionToken.get(sessionToken);
            } else {
                user = statements.findUserByUsername.get(username);
                if (!user || !(await bcrypt.compare(password, user.password))) {
                    logger.warn(`Invalid credentials for: ${username}`);
                    return callback({ error: 'Invalid credentials' });
                }
            }

            if (!user) {
                logger.warn('Login failed: user not found');
                return callback({ error: 'Invalid credentials' });
            }

            callback({ success: true, user: {
                id: user.id,
                username: user.username,
                sessionToken: user.sessionToken,
                isAdmin: !!user.isAdmin
            }});
        } catch (error) {
            logger.error('Login error:', error);
            callback({ error: 'Login failed' });
        }
    });

    socket.on('loginAsGuest', async (callback) => {
        try {
            const username = `guest-${crypto.randomBytes(4).toString('hex')}`;
            const sessionToken = crypto.randomBytes(64).toString('hex');
            const userId = generateId();
            const hashedPassword = await bcrypt.hash(username, 10);

            const isAdmin = 0;

            statements.createUser.run(userId, username, hashedPassword, sessionToken, isAdmin);

            logger.info(`Guest user created: ${username}`);
            callback({ success: true, user: {
                id: userId,
                username,
                sessionToken,
                isAdmin: false
            }});
        } catch (error) {
            logger.error('Guest login error:', error);
            callback({error: 'Guest login failed'});
        }
    });

    socket.on('verifySession', async ({ sessionToken }, callback) => {
        try {
            const user = statements.findUserBySessionToken.get(sessionToken);
            if (!user) {
                logger.warn(`Invalid session token: ${sessionToken}`);
                return callback({ error: 'Invalid session' });
            }

            callback({ success: true, user: {
                id: user.id,
                username: user.username,
                isAdmin: !!user.isAdmin
            }});
        } catch (error) {
            logger.error('Session verification error:', error);
            callback({ error: 'Session verification failed' });
        }
    });

    socket.on('checkAccountCreationStatus', async (callback) => {
        try {
            const userCount = statements.countAllUsers.get().count;
            const isFirstUser = userCount === 0;
            
            callback({ 
                allowed: isFirstUser || appSettings.accountCreationEnabled, 
                isFirstUser: isFirstUser 
            });
        } catch (error) {
            logger.error('Error checking account creation status:', error);
            callback({ allowed: true, isFirstUser: false });
        }
    });

    socket.on('toggleAccountCreation', async ({ userId, sessionToken, enabled }, callback) => {
        try {
            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user || !user.isAdmin) {
                logger.warn(`Unauthorized attempt to toggle account creation: ${userId}`);
                return callback({ error: 'Not authorized' });
            }

            appSettings.accountCreationEnabled = !!enabled;
            saveSettings();
            
            logger.info(`Account creation ${enabled ? 'enabled' : 'disabled'} by admin: ${user.username}`);
            callback({ success: true, enabled: appSettings.accountCreationEnabled });
        } catch (error) {
            logger.error('Error toggling account creation:', error);
            callback({ error: 'Failed to update account creation settings' });
        }
    });

    socket.on('addAdminUser', async ({ userId, sessionToken, targetUsername }, callback) => {
        try {
            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user || !user.isAdmin) {
                logger.warn(`Unauthorized attempt to add admin: ${userId}`);
                return callback({ error: 'Not authorized. You must be an admin to perform this action.' });
            }

            const targetUser = statements.findUserByUsername.get(targetUsername);
            if (!targetUser) {
                logger.warn(`Target user not found: ${targetUsername}`);
                return callback({ error: `User "${targetUsername}" does not exist.` });
            }
            
            if (targetUser.isAdmin) {
                logger.warn(`User ${targetUsername} is already an admin`);
                return callback({ error: `User "${targetUsername}" is already an admin.` });
            }

            statements.updateUserAdmin.run(1, targetUsername);
            
            logger.info(`User ${targetUsername} promoted to admin by ${user.username}`);
            callback({ success: true });
        } catch (error) {
            logger.error('Error adding admin user:', error);
            callback({ error: 'Failed to add admin user due to a server error. Please try again.' });
        }
    });

    socket.on('getAllAdmins', async ({ userId, sessionToken }, callback) => {
        try {
            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user || !user.isAdmin) {
                logger.warn(`Unauthorized attempt to get admins: ${userId}`);
                return callback({ error: 'Not authorized' });
            }

            const admins = statements.findAllAdmins.all();
            
            logger.info(`Admin list retrieved by ${user.username}`);
            callback({ success: true, admins: admins });
        } catch (error) {
            logger.error('Error getting admin list:', error);
            callback({ error: 'Failed to get admin list' });
        }
    });

    socket.on('saveHostConfig', async ({ userId, sessionToken, hostConfig }, callback) => {
        try {
            logger.debug(`Saving host config for user: ${userId}`);

            if (!hostConfig) {
                logger.warn('Missing host configuration');
                return callback({ error: 'Missing host configuration' });
            }

            const configData = hostConfig.hostConfig || hostConfig;

            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }

            const cleanConfig = {
                name: (configData?.name?.trim()) || '',
                folder: (configData?.folder?.trim()) || null,
                ip: (configData?.ip?.trim()) || '',
                user: (configData?.user?.trim()) || '',
                port: configData?.port || 22,
                password: (configData?.password?.trim()) || undefined,
                sshKey: (configData?.sshKey?.trim()) || undefined,
                keyType: configData?.keyType || '',
                tags: Array.isArray(configData?.tags) ? configData.tags : [],
                isPinned: !!configData?.isPinned,
                terminalConfig: configData?.terminalConfig || {
                    theme: 'dark',
                    cursorStyle: 'block',
                    fontFamily: 'ubuntuMono',
                    fontSize: 14,
                    fontWeight: 'normal',
                    lineHeight: 1,
                    letterSpacing: 0,
                    cursorBlink: true,
                    sshAlgorithm: 'default'
                }
            };

            if (!cleanConfig.ip || !cleanConfig.user) {
                logger.warn('Missing required host properties (IP or username)');
                return callback({ error: 'IP address and username are required' });
            }

            const finalName = cleanConfig.name || cleanConfig.ip;

            const db_transaction = db.transaction(() => {
                if (cleanConfig.name && cleanConfig.name.trim() !== '') {
                    try {
                        const existingHostByName = statements.findHostsByName.get(userId, finalName);
                        if (existingHostByName) {
                            logger.warn(`Host with name ${finalName} already exists for user: ${userId}`);
                            throw new Error(`Host with name "${finalName}" already exists. Please choose a different name.`);
                        }
                    } catch (error) {
                        if (error.message.includes('already exists')) {
                            throw error;
                        }
                        logger.error(`Error checking duplicate names: ${error.message}`);
                    }
                }

                const encryptedConfig = encryptData(cleanConfig, userId, sessionToken);
                if (!encryptedConfig) {
                    logger.error('Encryption failed for host config');
                    throw new Error('Configuration encryption failed');
                }

                const hostId = generateId();
                statements.createHost.run(
                    hostId,
                    finalName,
                    encryptedConfig,
                    userId,
                    cleanConfig.folder,
                    cleanConfig.isPinned ? 1 : 0
                );

                statements.addHostUser.run(hostId, userId);

                if (Array.isArray(cleanConfig.tags)) {
                    cleanConfig.tags.forEach(tag => {
                        statements.addHostTag.run(hostId, tag);
                    });
                }
            });

            db_transaction();
            callback({ success: true });
        } catch (err) {
            logger.error('Error saving host config:', err);
            callback({ error: err.message || 'Failed to save host' });
        }
    });

    socket.on('getHosts', async ({ userId, sessionToken }, callback) => {
        try {

            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }


            const createdHosts = statements.findHostsByCreator.all(userId);
            

            const sharedHosts = statements.findSharedHostsWithUser.all(userId, userId);
            

            const hosts = [...createdHosts, ...sharedHosts];
            

            const detailedHosts = [];
            for (const host of hosts) {
                try {

                    const createdBy = statements.findUserById.get(host.createdBy);
                    if (!createdBy) {
                        logger.warn(`Owner not found for host: ${host.id}`);
                        continue;
                    }


                    const userIds = statements.findHostUsers.all(host.id).map(row => row.userId);
                    

                    const tags = statements.findHostTags.all(host.id).map(row => row.tag);
                    

                    let decryptedConfig;
                    if (host.createdBy === userId) {

                        decryptedConfig = decryptData(host.config, userId, sessionToken);
                    } else {

                        decryptedConfig = decryptData(host.config, createdBy.id, createdBy.sessionToken);
                    }
                    
                    if (!decryptedConfig) {
                        logger.warn(`Failed to decrypt host config for host: ${host.id}`);
                        continue;
                    }

                    detailedHosts.push({
                        _id: host.id,
                        id: host.id,
                        name: host.name,
                        folder: host.folder,
                        isPinned: !!host.isPinned,
                        tags,
                        users: userIds,
                        createdBy: {
                            id: createdBy.id,
                            _id: createdBy.id,
                            username: createdBy.username
                        },
                        config: decryptedConfig,
                        isOwner: host.createdBy === userId
                    });
                } catch (error) {
                    logger.error(`Failed to process host ${host.id}:`, error);
                }
            }

            callback({ success: true, hosts: detailedHosts });
        } catch (error) {
            logger.error('Get hosts error:', error);
            callback({ error: 'Failed to fetch hosts' });
        }
    });

    socket.on('deleteHost', async ({ userId, sessionToken, hostId, _id }, callback) => {
        try {

            const targetHostId = _id || hostId;
            
            logger.debug(`Deleting host: ${targetHostId} for user: ${userId}`);

            if (!userId || !sessionToken) {
                logger.warn('Missing authentication parameters');
                return callback({ error: 'Authentication required' });
            }

            if (!targetHostId || typeof targetHostId !== 'string') {
                logger.warn('Invalid host ID format');
                return callback({ error: 'Invalid host ID' });
            }


            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }


            const db_transaction = db.transaction(() => {

                const host = statements.findHostById.get(targetHostId);
                if (!host) {
                    logger.warn(`Host not found: ${targetHostId}`);
                    throw new Error('Host not found');
                }


                if (host.createdBy === userId) {

                    logger.info(`Deleting host ${targetHostId} as owner`);
                    

                    statements.deleteHostTags.run(targetHostId);
                    

                    statements.deleteHostUsers.run(targetHostId);
                    

                    statements.deleteHost.run(targetHostId, userId);
                } else {

                    logger.info(`Removing user ${userId} from host ${targetHostId}`);
                    statements.removeHostUser.run(targetHostId, userId);
                }
                
                return true;
            });
            
            try {
                db_transaction();
                logger.info(`Host ${targetHostId} processed successfully for user ${userId}`);
                callback({ success: true });
            } catch (error) {
                return callback({ error: error.message });
            }
        } catch (error) {
            logger.error('Host deletion error:', error);
            callback({ error: `Host deletion failed: ${error.message}` });
        }
    });

    socket.on('shareHost', async ({ userId, sessionToken, hostId, _id, targetUsername }, callback) => {
        try {

            const targetHostId = _id || hostId;
            
            logger.debug(`Sharing host ${targetHostId} with ${targetUsername}`);


            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }


            const targetUser = statements.findUserByUsername.get(targetUsername);
            if (!targetUser) {
                logger.warn(`Target user not found: ${targetUsername}`);
                return callback({ error: 'User not found' });
            }


            const host = statements.findHostByIdAndCreator.get(targetHostId, userId);
            if (!host) {
                logger.warn(`Host not found or unauthorized: ${targetHostId}`);
                return callback({ error: 'Host not found' });
            }


            const hostUsers = statements.findHostUsers.all(targetHostId).map(row => row.userId);
            if (hostUsers.includes(targetUser.id)) {
                logger.warn(`Host already shared with user: ${targetUsername}`);
                return callback({ error: 'Already shared' });
            }


            statements.addHostUser.run(targetHostId, targetUser.id);

            logger.info(`Host shared successfully: ${targetHostId} -> ${targetUsername}`);
            callback({ success: true });
        } catch (error) {
            logger.error('Host sharing error:', error);
            callback({ error: 'Failed to share host' });
        }
    });

    socket.on('removeShare', async ({ userId, sessionToken, hostId, _id }, callback) => {
        try {

            const targetHostId = _id || hostId;
            
            logger.debug(`Removing share for host ${targetHostId} from user ${userId}`);


            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }


            const host = statements.findHostById.get(targetHostId);
            if (!host) {
                logger.warn(`Host not found: ${targetHostId}`);
                return callback({ error: 'Host not found' });
            }


            statements.removeHostUser.run(targetHostId, userId);

            callback({ success: true });
        } catch (error) {
            logger.error('Share removal error:', error);
            callback({ error: 'Failed to remove share' });
        }
    });

    socket.on('deleteUser', async ({ userId, sessionToken }, callback) => {
        try {
            logger.debug(`Deleting user: ${userId}`);


            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }


            const db_transaction = db.transaction(() => {

                const hosts = statements.findHostsByCreator.all(userId);
                

                for (const host of hosts) {
                    statements.deleteHostTags.run(host.id);
                    statements.deleteHostUsers.run(host.id);
                    statements.deleteHost.run(host.id, userId);
                }
                

                const snippets = statements.findSnippetsByUser.all(userId);
                

                for (const snippet of snippets) {
                    statements.deleteSnippetTags.run(snippet.id);
                    statements.deleteSnippetUsers.run(snippet.id);
                    statements.deleteSnippet.run(snippet.id, userId);
                }
                

                statements.deleteUser.run(userId);
                
                return true;
            });
            
            db_transaction();
            logger.info(`User deleted: ${userId}`);
            callback({ success: true });
        } catch (error) {
            logger.error('User deletion error:', error);
            callback({ error: 'Failed to delete user' });
        }
    });

    socket.on("editHost", async ({ userId, sessionToken, oldHostConfig, newHostConfig }, callback) => {
        try {
            if (!oldHostConfig || !newHostConfig) {
                logger.warn('Missing host configurations');
                return callback({ error: 'Missing host configurations' });
            }

            const oldConfigData = oldHostConfig.hostConfig || oldHostConfig;
            const newConfigData = newHostConfig.hostConfig || newHostConfig;

            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }

            let hostId = null;
            let hostToEdit = null;

            if (oldConfigData._id || oldConfigData.id) {
                hostId = oldConfigData._id || oldConfigData.id;
                hostToEdit = statements.findHostById.get(hostId);
                
                if (hostToEdit) {
                    if (hostToEdit.createdBy !== userId) {
                        const isSharedWithUser = statements.checkHostSharing.get(hostId, userId);
                        if (!isSharedWithUser) {
                            logger.warn(`User ${userId} attempted to edit host ${hostId} without permissions`);
                            return callback({ error: 'You do not have permission to edit this host' });
                        }
                    }
                }
            } 

            if (!hostToEdit && oldConfigData.name) {
                hostToEdit = statements.findHostsByName.get(userId, oldConfigData.name);
                if (hostToEdit) {
                    hostId = hostToEdit.id;
                }
            }

            if (!hostToEdit && oldConfigData.ip) {
                const userHosts = statements.findHostsByCreator.all(userId);
                for (const host of userHosts) {
                    try {
                        const config = decryptData(host.config, userId, sessionToken);
                        if (config && config.ip === oldConfigData.ip) {
                            hostToEdit = host;
                            hostId = host.id;
                            break;
                        }
                    } catch (err) {
                        continue;
                    }
                }
            }

            if (!hostToEdit) {
                logger.warn(`Host not found for editing by user: ${userId}`);
                return callback({ error: 'Host not found' });
            }

            hostId = hostToEdit.id;

            const cleanConfig = {
                name: newConfigData.name || oldConfigData.name || oldConfigData.ip || '',
                folder: newConfigData.folder !== undefined ? newConfigData.folder : (oldConfigData.folder || ''),
                ip: newConfigData.ip || oldConfigData.ip || '',
                user: newConfigData.user || oldConfigData.user || '',
                port: newConfigData.port || oldConfigData.port || '22',

                password: newConfigData.password !== undefined ? newConfigData.password : oldConfigData.password || '',
                sshKey: newConfigData.sshKey !== undefined ? newConfigData.sshKey : oldConfigData.sshKey || '',
                keyType: newConfigData.keyType !== undefined ? newConfigData.keyType : oldConfigData.keyType || '',
                
                isPinned: newConfigData.isPinned !== undefined ? newConfigData.isPinned : (oldConfigData.isPinned || false),
                tags: newConfigData.tags || oldConfigData.tags || [],
                terminalConfig: newConfigData.terminalConfig || oldConfigData.terminalConfig || {
                    theme: 'dark',
                    cursorStyle: 'block',
                    fontFamily: 'ubuntuMono',
                    fontSize: 14,
                    fontWeight: 'normal',
                    lineHeight: 1,
                    letterSpacing: 0,
                    cursorBlink: true,
                    sshAlgorithm: 'default'
                }
            };

            const finalName = cleanConfig.name;

            try {
                const updateTransaction = db.transaction(() => {
                    if (finalName && finalName.trim() !== '' && 
                        finalName.toLowerCase() !== hostToEdit.name?.toLowerCase()) {
                        try {
                            const existingHostByName = statements.findHostsByName.get(userId, finalName);

                            if (existingHostByName && existingHostByName.id !== hostId) {
                                logger.warn(`Host with name ${finalName} already exists for user: ${userId}`);
                                throw new Error(`Host with name "${finalName}" already exists. Please choose a different name.`);
                            }
                        } catch (error) {
                            if (error.message.includes('already exists')) {
                                throw error;
                            }
                            logger.error(`Error checking duplicate names: ${error.message}`);
                        }
                    }

                    const encryptedConfig = encryptData(cleanConfig, userId, sessionToken);
                    if (!encryptedConfig) {
                        logger.error('Encryption failed for host config');
                        throw new Error('Configuration encryption failed');
                    }

                    const updateResult = db.prepare('UPDATE hosts SET name = ?, config = ?, folder = ?, isPinned = ? WHERE id = ?').run(
                        cleanConfig.name,
                        encryptedConfig,
                        cleanConfig.folder || '',
                        cleanConfig.isPinned ? 1 : 0,
                        hostId
                    );
                    
                    if (!updateResult || updateResult.changes === 0) {
                        throw new Error(`Failed to update host: ${hostId}`);
                    }

                    statements.deleteHostTags.run(hostId);
                    if (Array.isArray(cleanConfig.tags)) {
                        cleanConfig.tags.forEach(tag => {
                            statements.addHostTag.run(hostId, tag);
                        });
                    }

                    return hostId;
                });

                const updatedHostId = updateTransaction();

                const updatedHost = statements.findHostById.get(updatedHostId);
                if (!updatedHost) {
                    throw new Error('Host not found after update');
                }
                
                logger.info(`Host ${hostId} updated successfully`);
                callback({ success: true, hostId: updatedHostId });
            } catch (error) {
                logger.error(`Error updating host: ${error.message}`);
                callback({ error: error.message || 'Failed to update host' });
            }
        } catch (error) {
            logger.error(`Error in editHost: ${error.message}`);
            callback({ error: error.message || 'Host editing failed due to an unexpected error' });
        }
    });

    socket.on('saveSnippet', async ({ userId, sessionToken, snippet }, callback) => {
        try {
            if (!userId || !sessionToken) {
                logger.warn('Missing authentication parameters');
                return callback({ error: 'Authentication required' });
            }

            if (!snippet || typeof snippet !== 'object') {
                logger.warn('Invalid snippet format');
                return callback({ error: 'Invalid snippet' });
            }

            if (!snippet.name || !snippet.content) {
                logger.warn('Invalid host config format');
                return callback({ error: 'Name and content are required' });
            }


            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }

            const cleanSnippet = {
                name: snippet.name.trim(),
                content: snippet.content,
                folder: snippet.folder?.trim() || null,
                tags: snippet.tags || [],
                isPinned: snippet.isPinned || false
            };


            const db_transaction = db.transaction(() => {

                const snippetId = generateId();
                

                const encryptedContent = encryptData(cleanSnippet.content, userId, sessionToken);
                if (!encryptedContent) {
                    logger.error('Encryption failed for snippet content');
                    throw new Error('Snippet encryption failed');
                }
                

                statements.createSnippet.run(
                    snippetId,
                    cleanSnippet.name,
                    encryptedContent,
                    userId,
                    cleanSnippet.folder,
                    cleanSnippet.isPinned ? 1 : 0
                );
                

                statements.addSnippetUser.run(snippetId, userId);
                

                if (Array.isArray(cleanSnippet.tags)) {
                    cleanSnippet.tags.forEach(tag => {
                        statements.addSnippetTag.run(snippetId, tag);
                    });
                }
                
                return snippetId;
            });
            
            try {

                const snippetId = db_transaction();
                

                const newSnippet = statements.findSnippetById.get(snippetId);
                const tags = statements.findSnippetTags.all(snippetId).map(row => row.tag);
                
                return callback({
                    success: true,
                    snippet: {
                        _id: snippetId,
                        name: newSnippet.name,
                        content: cleanSnippet.content,
                        folder: newSnippet.folder,
                        isPinned: !!newSnippet.isPinned,
                        tags: tags,
                        createdBy: {
                            _id: user.id,
                            username: user.username
                        }
                    }
                });
                
            } catch (error) {
                logger.error(`Error in snippet save transaction: ${error.message}`);
                return callback({ error: error.message });
            }
        } catch (error) {
            logger.error(`Error saving snippet: ${error.message}`);
            return callback({ error: 'Server error' });
        }
    });


    socket.on('toggleSnippetPin', async ({ userId, sessionToken, snippetId, isPinned }, callback) => {
        try {
            if (!userId || !sessionToken) {
                logger.warn('Missing authentication parameters');
                return callback({ error: 'Authentication required' });
            }

            if (!snippetId) {
                logger.warn('Missing snippetId parameter');
                return callback({ error: 'Snippet ID is required' });
            }


            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }


            const snippet = statements.findSnippetById.get(snippetId);
            if (!snippet) {
                logger.warn(`Snippet not found: ${snippetId}`);
                return callback({ error: 'Snippet not found' });
            }


            const isOwner = snippet.createdBy === user.id;
            if (!isOwner) {
                const hasAccess = statements.findSnippetUsers.all(snippetId)
                    .some(row => row.userId === user.id);
                if (!hasAccess) {
                    logger.warn(`User does not have access to snippet: ${snippetId}`);
                    return callback({ error: 'Access denied' });
                }
            }


            const result = statements.updateSnippet.run(
                snippet.name,
                snippet.content,
                snippet.folder,
                isPinned ? 1 : 0,
                snippetId
            );

            if (result && result.changes > 0) {
                return callback({ success: true });
            } else {
                logger.error(`Failed to update pin status for snippet: ${snippetId}`);
                return callback({ error: 'Failed to update pin status' });
            }
        } catch (error) {
            logger.error(`Error toggling snippet pin: ${error.message}`);
            return callback({ error: 'Server error' });
        }
    });

    socket.on('getSnippets', async ({ userId, sessionToken }, callback) => {
        try {

            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }


            const snippets = statements.findSnippetsByUser.all(userId);
            

            const detailedSnippets = [];
            for (const snippet of snippets) {
                try {

                    const createdBy = statements.findUserById.get(snippet.createdBy);
                    if (!createdBy) {
                        logger.warn(`Owner not found for snippet: ${snippet.id}`);
                        continue;
                    }


                    const userIds = statements.findSnippetUsers.all(snippet.id).map(row => row.userId);
                    

                    const tags = statements.findSnippetTags.all(snippet.id).map(row => row.tag);
                    

                    const decryptedContent = decryptData(snippet.content, createdBy.id, createdBy.sessionToken);
                    if (!decryptedContent) {
                        logger.warn(`Failed to decrypt content for snippet: ${snippet.id}`);
                        continue;
                    }

                    detailedSnippets.push({
                        id: snippet.id,
                        name: snippet.name,
                        folder: snippet.folder,
                        isPinned: !!snippet.isPinned,
                        tags,
                        users: userIds,
                        createdBy: {
                            id: createdBy.id,
                            username: createdBy.username
                        },
                        content: decryptedContent
                    });
                } catch (error) {
                    logger.error(`Failed to process snippet ${snippet.id}:`, error);
                }
            }

            callback({ success: true, snippets: detailedSnippets });
        } catch (error) {
            logger.error('Get snippets error:', error);
            callback({ error: 'Failed to fetch snippets' });
        }
    });

    socket.on('editSnippet', async ({ userId, sessionToken, oldSnippet, newSnippet }, callback) => {
        try {
            if (!oldSnippet || !newSnippet) {
                logger.warn('Missing snippet configurations');
                return callback({ error: 'Missing snippet configurations' });
            }


            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }

            let snippetId = null;
            let snippetToEdit = null;
            

            if (oldSnippet._id || oldSnippet.id) {
                snippetId = oldSnippet._id || oldSnippet.id;
                snippetToEdit = statements.findSnippetById.get(snippetId);
                

                if (!snippetToEdit || snippetToEdit.createdBy !== userId) {
                    logger.warn(`Snippet not found or unauthorized by ID: ${snippetId}`);
                    return callback({ error: 'Snippet not found or you do not have permission to edit it' });
                }
            } else {
                logger.warn('No snippet ID provided for editing');
                return callback({ error: 'Snippet ID is required' });
            }
            

            if (!snippetId) {
                logger.warn('Could not identify snippet to edit');
                return callback({ error: 'Snippet not found' });
            }

            const finalName = newSnippet.name?.trim() || snippetToEdit.name;


            const db_transaction = db.transaction(() => {

                if (finalName.toLowerCase() !== snippetToEdit.name.toLowerCase()) {
                    const existingSnippetByName = statements.findSnippetsByName.get(userId, finalName);
                    if (existingSnippetByName && existingSnippetByName.id !== snippetId) {
                        logger.warn(`Snippet with name ${finalName} already exists for user: ${userId}`);
                        throw new Error(`Snippet with name "${finalName}" already exists. Please choose a different name.`);
                    }
                }

                const cleanSnippet = {
                    name: finalName,
                    content: newSnippet.content,
                    folder: newSnippet.folder?.trim() || null,
                    tags: Array.isArray(newSnippet.tags) ? newSnippet.tags : [],
                    isPinned: newSnippet.isPinned || false
                };

                const encryptedContent = encryptData(cleanSnippet.content, userId, sessionToken);
                if (!encryptedContent) {
                    logger.error('Encryption failed for snippet content');
                    throw new Error('Snippet encryption failed');
                }


                statements.updateSnippet.run(
                    cleanSnippet.name,
                    encryptedContent,
                    cleanSnippet.folder,
                    cleanSnippet.isPinned ? 1 : 0,
                    snippetId
                );


                statements.deleteSnippetTags.run(snippetId);
                if (Array.isArray(cleanSnippet.tags)) {
                    cleanSnippet.tags.forEach(tag => {
                        statements.addSnippetTag.run(snippetId, tag);
                    });
                }

                return snippetId;
            });

            try {
                const updatedSnippetId = db_transaction();
                

                await new Promise(resolve => setTimeout(resolve, 200));
                
                logger.info(`Snippet edited successfully: ${updatedSnippetId}`);
                callback({ success: true, snippetId: updatedSnippetId });
            } catch (error) {
                return callback({ error: error.message });
            }
        } catch (error) {
            logger.error('Snippet edit error:', error);
            callback({ error: `Failed to edit snippet: ${error.message}` });
        }
    });

    socket.on('deleteSnippet', async ({ userId, sessionToken, snippetId }, callback) => {
        try {
            logger.debug(`Deleting snippet: ${snippetId} for user: ${userId}`);

            if (!userId || !sessionToken) {
                logger.warn('Missing authentication parameters');
                return callback({ error: 'Authentication required' });
            }

            if (!snippetId || typeof snippetId !== 'string') {
                logger.warn('Invalid snippet ID format');
                return callback({ error: 'Invalid snippet ID' });
            }


            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }


            const db_transaction = db.transaction(() => {

                const snippet = statements.findSnippetById.get(snippetId);
                if (!snippet) {
                    logger.warn(`Snippet not found: ${snippetId}`);
                    throw new Error('Snippet not found');
                }


                if (snippet.createdBy === userId) {

                    logger.info(`Deleting snippet ${snippetId} as owner`);
                    

                    statements.deleteSnippetTags.run(snippetId);
                    

                    statements.deleteSnippetUsers.run(snippetId);
                    

                    statements.deleteSnippet.run(snippetId, userId);
                } else {

                    logger.info(`Removing user ${userId} from snippet ${snippetId}`);
                    statements.removeSnippetUser.run(snippetId, userId);
                }
                
                return true;
            });
            
            try {
                db_transaction();
                logger.info(`Snippet ${snippetId} processed successfully for user ${userId}`);
                callback({ success: true });
            } catch (error) {
                return callback({ error: error.message });
            }
        } catch (error) {
            logger.error('Snippet deletion error:', error);
            callback({ error: `Snippet deletion failed: ${error.message}` });
        }
    });

    socket.on('shareSnippet', async ({ userId, sessionToken, snippetId, targetUsername }, callback) => {
        try {
            logger.debug(`Sharing snippet ${snippetId} with ${targetUsername}`);


            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }


            const targetUser = statements.findUserByUsername.get(targetUsername);
            if (!targetUser) {
                logger.warn(`Target user not found: ${targetUsername}`);
                return callback({ error: 'User not found' });
            }


            const snippet = statements.findSnippetByIdAndCreator.get(snippetId, userId);
            if (!snippet) {
                logger.warn(`Snippet not found or unauthorized: ${snippetId}`);
                return callback({ error: 'Snippet not found or you do not have permission to share it' });
            }


            const snippetUsers = statements.findSnippetUsers.all(snippetId).map(row => row.userId);
            if (snippetUsers.includes(targetUser.id)) {
                logger.warn(`Snippet already shared with user: ${targetUsername}`);
                return callback({ error: 'Already shared' });
            }


            statements.addSnippetUser.run(snippetId, targetUser.id);

            logger.info(`Snippet shared successfully: ${snippetId} -> ${targetUsername}`);
            callback({ success: true });
        } catch (error) {
            logger.error('Snippet sharing error:', error);
            callback({ error: 'Failed to share snippet' });
        }
    });

    socket.on('removeSnippetShare', async ({ userId, sessionToken, snippetId }, callback) => {
        try {
            logger.debug(`Removing share for snippet ${snippetId} from user ${userId}`);


            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }


            const snippet = statements.findSnippetById.get(snippetId);
            if (!snippet) {
                logger.warn(`Snippet not found: ${snippetId}`);
                return callback({ error: 'Snippet not found' });
            }


            statements.removeSnippetUser.run(snippetId, userId);

            callback({ success: true });
        } catch (error) {
            logger.error('Share removal error:', error);
            callback({ error: 'Failed to remove snippet share' });
        }
    });
});

server.listen(8081, () => {
    logger.info('Server running on port 8081');
});