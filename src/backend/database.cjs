const http = require('http');
const socketIo = require('socket.io');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const logger = {
    info: (...args) => console.log(`🔧 [${new Date().toISOString()}] INFO:`, ...args),
    error: (...args) => console.error(`❌ [${new Date().toISOString()}] ERROR:`, ...args),
    warn: (...args) => console.warn(`⚠️ [${new Date().toISOString()}] WARN:`, ...args),
    debug: (...args) => console.debug(`🔍 [${new Date().toISOString()}] DEBUG:`, ...args)
};

// Ensure the data directory exists
const dataDir = process.env.DATA_DIR || path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    logger.info(`Created data directory: ${dataDir}`);
}

const dbPath = path.join(dataDir, 'termix.db');
const db = new Database(dbPath);
logger.info(`Connected to SQLite database at: ${dbPath}`);

// Initialize server
const server = http.createServer();
const io = socketIo(server, {
    path: '/database.io/socket.io',
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Initialize database tables
function initializeDatabase() {
    // Create users table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            sessionToken TEXT NOT NULL
        )
    `).run();
    
    // Create hosts table
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
    
    // Create host_users (many-to-many relationship for sharing)
    db.prepare(`
        CREATE TABLE IF NOT EXISTS host_users (
            hostId TEXT NOT NULL,
            userId TEXT NOT NULL,
            PRIMARY KEY (hostId, userId),
            FOREIGN KEY (hostId) REFERENCES hosts(id),
            FOREIGN KEY (userId) REFERENCES users(id)
        )
    `).run();
    
    // Create host_tags
    db.prepare(`
        CREATE TABLE IF NOT EXISTS host_tags (
            hostId TEXT NOT NULL,
            tag TEXT NOT NULL,
            PRIMARY KEY (hostId, tag),
            FOREIGN KEY (hostId) REFERENCES hosts(id)
        )
    `).run();
    
    // Create snippets table
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
    
    // Create snippet_users (many-to-many relationship for sharing)
    db.prepare(`
        CREATE TABLE IF NOT EXISTS snippet_users (
            snippetId TEXT NOT NULL,
            userId TEXT NOT NULL,
            PRIMARY KEY (snippetId, userId),
            FOREIGN KEY (snippetId) REFERENCES snippets(id),
            FOREIGN KEY (userId) REFERENCES users(id)
        )
    `).run();
    
    // Create snippet_tags
    db.prepare(`
        CREATE TABLE IF NOT EXISTS snippet_tags (
            snippetId TEXT NOT NULL,
            tag TEXT NOT NULL,
            PRIMARY KEY (snippetId, tag),
            FOREIGN KEY (snippetId) REFERENCES snippets(id)
        )
    `).run();
    
    logger.info('Database tables initialized');
}

// Run database initialization
initializeDatabase();

// Utility functions
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

// Prepare statements for common database operations
const statements = {
    // User statements
    findUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
    findUserBySessionToken: db.prepare('SELECT * FROM users WHERE sessionToken = ?'),
    findUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
    findUserByIdAndSessionToken: db.prepare('SELECT * FROM users WHERE id = ? AND sessionToken = ?'),
    createUser: db.prepare('INSERT INTO users (id, username, password, sessionToken) VALUES (?, ?, ?, ?)'),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
    
    // Host statements
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
    
    // Snippet statements
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
    updateSnippetPinStatus: db.prepare('UPDATE snippets SET isPinned = ? WHERE id = ?')
};

// Helper functions for database operations
function generateId() {
    return crypto.randomBytes(16).toString('hex');
}

function getUserById(userId) {
    return statements.findUserById.get(userId);
}

function getHostWithDetails(host, userId, sessionToken) {
    if (!host) return null;
    
    // Get users associated with this host
    const userIds = statements.findHostUsers.all(host.id).map(row => row.userId);
    
    // Get tags for this host
    const tags = statements.findHostTags.all(host.id).map(row => row.tag);
    
    // Get owner user
    const createdBy = statements.findUserById.get(host.createdBy);
    if (!createdBy) return null;
    
    // Decrypt the host config
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
    
    // Get users associated with this snippet
    const userIds = statements.findSnippetUsers.all(snippet.id).map(row => row.userId);
    
    // Get tags for this snippet
    const tags = statements.findSnippetTags.all(snippet.id).map(row => row.tag);
    
    // Get owner user
    const createdBy = statements.findUserById.get(snippet.createdBy);
    if (!createdBy) return null;
    
    // Try to decrypt the snippet content
    let content = null;
    try {
        if (snippet.content) {
            // Check if content looks like it's encrypted (contains colons for IV:Content:AuthTag)
            if (snippet.content.includes(':')) {
                const decryptedContent = decryptData(snippet.content, createdBy.id, createdBy.sessionToken);
                if (decryptedContent) {
                    content = decryptedContent;
                } else {
                    logger.warn(`Failed to decrypt content for snippet: ${snippet.id}`);
                    // If we can't decrypt, use the raw content as fallback (might be plain text)
                    content = snippet.content;
                }
            } else {
                // Content is not encrypted, use as is
                content = snippet.content;
            }
        }
    } catch (error) {
        logger.warn(`Error handling snippet content for ${snippet.id}: ${error.message}`);
        // If there was an error, fall back to the raw content
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

// Replace mongoose.connect with our initialization
logger.info('Database is ready');

io.of('/database.io').on('connection', (socket) => {
    socket.on('createUser', async ({ username, password }, callback) => {
        try {
            logger.debug(`Creating user: ${username}`);

            // Check if username already exists
            const existingUser = statements.findUserByUsername.get(username);
            if (existingUser) {
                logger.warn(`Username already exists: ${username}`);
                return callback({ error: 'Username already exists' });
            }

            const sessionToken = crypto.randomBytes(64).toString('hex');
            const userId = generateId();
            const hashedPassword = await bcrypt.hash(password, 10);
            
            // Create the user
            statements.createUser.run(userId, username, hashedPassword, sessionToken);

            logger.info(`User created: ${username}`);
            callback({ success: true, user: {
                id: userId,
                username,
                sessionToken
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
                logger.warn('Login failed - user not found');
                return callback({ error: 'Invalid credentials' });
            }

            logger.info(`User logged in: ${user.username}`);
            callback({ success: true, user: {
                id: user.id,
                username: user.username,
                sessionToken: user.sessionToken
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
            
            // Create the guest user
            statements.createUser.run(userId, username, hashedPassword, sessionToken);

            logger.info(`Guest user created: ${username}`);
            callback({ success: true, user: {
                id: userId,
                username,
                sessionToken
            }});
        } catch (error) {
            logger.error('Guest login error:', error);
            callback({error: 'Guest login failed'});
        }
    });

    socket.on('saveHostConfig', async ({ userId, sessionToken, hostConfig }, callback) => {
        try {
            if (!userId || !sessionToken) {
                logger.warn('Missing authentication parameters');
                return callback({ error: 'Authentication required' });
            }

            if (!hostConfig || typeof hostConfig !== 'object') {
                logger.warn('Invalid host config format');
                return callback({ error: 'Invalid host configuration' });
            }

            if (!hostConfig.ip || !hostConfig.user) {
                logger.warn('Missing required fields:', hostConfig);
                return callback({ error: 'IP and User are required' });
            }

            // Validate user session
            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }

            const cleanConfig = {
                name: hostConfig.name?.trim(),
                folder: hostConfig.folder?.trim() || null,
                ip: hostConfig.ip.trim(),
                user: hostConfig.user.trim(),
                port: hostConfig.port || 22,
                password: hostConfig.password?.trim() || undefined,
                sshKey: hostConfig.sshKey?.trim() || undefined,
                tags: hostConfig.tags || [],
            };

            const finalName = cleanConfig.name || cleanConfig.ip;

            // Check for hosts with the same name (case insensitive) - use a transaction for consistency
            const db_transaction = db.transaction(() => {
                // Check for hosts with the same name
                const existingHostByName = statements.findHostsByName.get(userId, finalName);
                if (existingHostByName) {
                    logger.warn(`Host with name ${finalName} already exists for user: ${userId}`);
                    throw new Error(`Host with name "${finalName}" already exists. Please choose a different name.`);
                }

                // Prevent duplicate IPs if using IP as name
                if (!cleanConfig.name) {
                    const hostsWithSameIp = statements.findHostsByCreator.all(userId);
                    for (const host of hostsWithSameIp) {
                        const decryptedConfig = decryptData(host.config, userId, sessionToken);
                        if (decryptedConfig && decryptedConfig.ip.toLowerCase() === cleanConfig.ip.toLowerCase()) {
                            logger.warn(`Host with IP ${cleanConfig.ip} already exists for user: ${userId}`);
                            throw new Error(`Host with IP "${cleanConfig.ip}" already exists. Please provide a unique name.`);
                        }
                    }
                }

                const encryptedConfig = encryptData(cleanConfig, userId, sessionToken);
                if (!encryptedConfig) {
                    logger.error('Encryption failed for host config');
                    throw new Error('Configuration encryption failed');
                }

                // Create a new host
                const hostId = generateId();
                statements.createHost.run(
                    hostId,
                    finalName,
                    encryptedConfig,
                    userId,
                    cleanConfig.folder,
                    hostConfig.isPinned ? 1 : 0
                );

                // Add the creator as a user of the host
                statements.addHostUser.run(hostId, userId);

                // Add tags
                if (Array.isArray(cleanConfig.tags)) {
                    cleanConfig.tags.forEach(tag => {
                        statements.addHostTag.run(hostId, tag);
                    });
                }

                return hostId;
            });

            try {
                const hostId = db_transaction();
                logger.info(`Host created successfully: ${finalName}`);
                callback({ success: true });
            } catch (error) {
                return callback({ error: error.message });
            }
            
        } catch (error) {
            logger.error('Host save error:', error);
            callback({ error: `Host save failed: ${error.message}` });
        }
    });

    socket.on('getHosts', async ({ userId, sessionToken }, callback) => {
        try {
            // Validate user session
            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }

            // Get hosts created by this user
            const createdHosts = statements.findHostsByCreator.all(userId);
            
            // Get hosts shared with this user (but not created by them)
            const sharedHosts = statements.findSharedHostsWithUser.all(userId, userId);
            
            // Combine both sets of hosts
            const hosts = [...createdHosts, ...sharedHosts];
            
            // Process each host to include detailed information
            const detailedHosts = [];
            for (const host of hosts) {
                try {
                    // Find the creator user
                    const createdBy = statements.findUserById.get(host.createdBy);
                    if (!createdBy) {
                        logger.warn(`Owner not found for host: ${host.id}`);
                        continue;
                    }

                    // Get users with access to this host
                    const userIds = statements.findHostUsers.all(host.id).map(row => row.userId);
                    
                    // Get tags for this host
                    const tags = statements.findHostTags.all(host.id).map(row => row.tag);
                    
                    // Decrypt the host configuration
                    let decryptedConfig;
                    if (host.createdBy === userId) {
                        // If the user is the creator, use their session token
                        decryptedConfig = decryptData(host.config, userId, sessionToken);
                    } else {
                        // For shared hosts, use the creator's session token
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
            // Use _id if provided (from frontend), fall back to hostId
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

            // Validate user session
            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }

            // Use a transaction to ensure atomicity
            const db_transaction = db.transaction(() => {
                // First check if the host exists
                const host = statements.findHostById.get(targetHostId);
                if (!host) {
                    logger.warn(`Host not found: ${targetHostId}`);
                    throw new Error('Host not found');
                }

                // Check if user is the creator
                if (host.createdBy === userId) {
                    // User is the creator, delete the host completely
                    logger.info(`Deleting host ${targetHostId} as owner`);
                    
                    // Delete host tags
                    statements.deleteHostTags.run(targetHostId);
                    
                    // Delete host users relationship
                    statements.deleteHostUsers.run(targetHostId);
                    
                    // Delete the host itself
                    statements.deleteHost.run(targetHostId, userId);
                } else {
                    // User is not the creator, just remove their access
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
            // Use _id if provided (from frontend), fall back to hostId
            const targetHostId = _id || hostId;
            
            logger.debug(`Sharing host ${targetHostId} with ${targetUsername}`);

            // Validate the user session
            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }

            // Find the target user by username
            const targetUser = statements.findUserByUsername.get(targetUsername);
            if (!targetUser) {
                logger.warn(`Target user not found: ${targetUsername}`);
                return callback({ error: 'User not found' });
            }

            // Find the host and ensure the requesting user is the creator
            const host = statements.findHostByIdAndCreator.get(targetHostId, userId);
            if (!host) {
                logger.warn(`Host not found or unauthorized: ${targetHostId}`);
                return callback({ error: 'Host not found' });
            }

            // Check if host is already shared with target user
            const hostUsers = statements.findHostUsers.all(targetHostId).map(row => row.userId);
            if (hostUsers.includes(targetUser.id)) {
                logger.warn(`Host already shared with user: ${targetUsername}`);
                return callback({ error: 'Already shared' });
            }

            // Add the target user to the host_users table
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
            // Use _id if provided (from frontend), fall back to hostId
            const targetHostId = _id || hostId;
            
            logger.debug(`Removing share for host ${targetHostId} from user ${userId}`);

            // Validate the user session
            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }

            // Check if the host exists
            const host = statements.findHostById.get(targetHostId);
            if (!host) {
                logger.warn(`Host not found: ${targetHostId}`);
                return callback({ error: 'Host not found' });
            }

            // Remove user from the host_users table
            statements.removeHostUser.run(targetHostId, userId);

            logger.info(`Share removed successfully: ${targetHostId} -> ${userId}`);
            callback({ success: true });
        } catch (error) {
            logger.error('Share removal error:', error);
            callback({ error: 'Failed to remove share' });
        }
    });

    socket.on('deleteUser', async ({ userId, sessionToken }, callback) => {
        try {
            logger.debug(`Deleting user: ${userId}`);

            // Validate the user session
            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }

            // Use a transaction to delete all related data
            const db_transaction = db.transaction(() => {
                // Get hosts created by this user
                const hosts = statements.findHostsByCreator.all(userId);
                
                // Delete each host and its relationships
                for (const host of hosts) {
                    statements.deleteHostTags.run(host.id);
                    statements.deleteHostUsers.run(host.id);
                    statements.deleteHost.run(host.id, userId);
                }
                
                // Get snippets created by this user
                const snippets = statements.findSnippetsByUser.all(userId);
                
                // Delete each snippet and its relationships
                for (const snippet of snippets) {
                    statements.deleteSnippetTags.run(snippet.id);
                    statements.deleteSnippetUsers.run(snippet.id);
                    statements.deleteSnippet.run(snippet.id, userId);
                }
                
                // Delete the user
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
            logger.debug(`Editing host for user: ${userId}`);

            if (!oldHostConfig || !newHostConfig) {
                logger.warn('Missing host configurations');
                return callback({ error: 'Missing host configurations' });
            }

            // Validate the user session
            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }

            let hostId = null;
            let hostToEdit = null;
            
            // First check if we already have a host ID from the frontend
            if (oldHostConfig._id) {
                hostId = oldHostConfig._id;
                hostToEdit = statements.findHostById.get(hostId);
                
                // Verify this host exists and belongs to the user
                if (!hostToEdit || hostToEdit.createdBy !== userId) {
                    logger.warn(`Host not found or unauthorized by ID: ${hostId}`);
                    return callback({ error: 'Host not found' });
                }
            } else {
                // Fall back to searching by IP if no ID was provided
                const hosts = statements.findHostsByCreator.all(userId);
                
                for (const host of hosts) {
                    const decryptedConfig = decryptData(host.config, userId, sessionToken);
                    if (decryptedConfig && decryptedConfig.ip === oldHostConfig.ip) {
                        hostToEdit = host;
                        hostId = host.id;
                        break;
                    }
                }

                if (!hostToEdit) {
                    logger.warn(`Host not found or unauthorized`);
                    return callback({ error: 'Host not found' });
                }
            }
            
            // Verify we found a valid host
            if (!hostId) {
                logger.warn('Could not identify host to edit');
                return callback({ error: 'Host not found' });
            }

            const finalName = newHostConfig.name?.trim() || newHostConfig.ip.trim();

            // Use a transaction for all checks and updates
            const db_transaction = db.transaction(() => {
                // If the name is being changed, check for duplicates using case-insensitive comparison
                if (finalName.toLowerCase() !== hostToEdit.name.toLowerCase()) {
                    const existingHostByName = statements.findHostsByName.get(userId, finalName);
                    if (existingHostByName && existingHostByName.id !== hostId) {
                        logger.warn(`Host with name ${finalName} already exists for user: ${userId}`);
                        throw new Error(`Host with name "${finalName}" already exists. Please choose a different name.`);
                    }
                }

                // Get all hosts for IP comparison
                const hosts = statements.findHostsByCreator.all(userId);
                
                // If IP is changed and no custom name provided, check for duplicate IP
                if (newHostConfig.ip !== oldHostConfig.ip && !newHostConfig.name) {
                    for (const host of hosts) {
                        if (host.id === hostId) continue;
                        
                        const decryptedConfig = decryptData(host.config, userId, sessionToken);
                        if (decryptedConfig && decryptedConfig.ip.toLowerCase() === newHostConfig.ip.toLowerCase()) {
                            logger.warn(`Host with IP ${newHostConfig.ip} already exists for user: ${userId}`);
                            throw new Error(`Host with IP "${newHostConfig.ip}" already exists. Please provide a unique name.`);
                        }
                    }
                }

                const cleanConfig = {
                    name: newHostConfig.name?.trim(),
                    folder: newHostConfig.folder?.trim() || null,
                    ip: newHostConfig.ip.trim(),
                    user: newHostConfig.user.trim(),
                    port: newHostConfig.port || 22,
                    password: newHostConfig.password?.trim() || undefined,
                    sshKey: newHostConfig.sshKey?.trim() || undefined,
                    tags: Array.isArray(newHostConfig.tags) ? newHostConfig.tags : [],
                    isPinned: newHostConfig.isPinned || false
                };

                const encryptedConfig = encryptData(cleanConfig, userId, sessionToken);
                if (!encryptedConfig) {
                    logger.error('Encryption failed for host config');
                    throw new Error('Configuration encryption failed');
                }

                // Update the host record
                statements.updateHost.run(
                    finalName,
                    encryptedConfig,
                    cleanConfig.folder,
                    cleanConfig.isPinned ? 1 : 0,
                    hostId
                );

                // Update tags: remove old ones and add new ones
                statements.deleteHostTags.run(hostId);
                if (Array.isArray(cleanConfig.tags)) {
                    cleanConfig.tags.forEach(tag => {
                        statements.addHostTag.run(hostId, tag);
                    });
                }

                return hostId;
            });

            try {
                const updatedHostId = db_transaction();
                
                // Add a small delay to ensure database writes complete
                await new Promise(resolve => setTimeout(resolve, 200));
                
                logger.info(`Host edited successfully: ${updatedHostId}`);
                callback({ success: true, hostId: updatedHostId });
            } catch (error) {
                return callback({ error: error.message });
            }
        } catch (error) {
            logger.error('Host edit error:', error);
            callback({ error: `Failed to edit host: ${error.message}` });
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
                username: user.username
            }});
        } catch (error) {
            logger.error('Session verification error:', error);
            callback({ error: 'Session verification failed' });
        }
    });

    // Snippet handlers
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
                logger.warn('Missing required fields for snippet');
                return callback({ error: 'Name and content are required' });
            }

            // Validate the user session
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

            // Use a transaction to save snippet and tags
            const db_transaction = db.transaction(() => {
                // Generate a unique ID for the snippet
                const snippetId = generateId();
                
                // Encrypt the content before storing
                const encryptedContent = encryptData(cleanSnippet.content, userId, sessionToken);
                if (!encryptedContent) {
                    logger.error('Encryption failed for snippet content');
                    throw new Error('Snippet encryption failed');
                }
                
                // Insert the snippet first
                statements.createSnippet.run(
                    snippetId,
                    cleanSnippet.name,
                    encryptedContent,  // Store encrypted content
                    userId,
                    cleanSnippet.folder,
                    cleanSnippet.isPinned ? 1 : 0
                );
                
                // Add creator as a user of the snippet (for sharing)
                statements.addSnippetUser.run(snippetId, userId);
                
                // Add tags separately
                if (Array.isArray(cleanSnippet.tags)) {
                    cleanSnippet.tags.forEach(tag => {
                        statements.addSnippetTag.run(snippetId, tag);
                    });
                }
                
                return snippetId;
            });
            
            try {
                // Execute the transaction
                const snippetId = db_transaction();
                
                // Get the newly created snippet with all its details
                const newSnippet = statements.findSnippetById.get(snippetId);
                const tags = statements.findSnippetTags.all(snippetId).map(row => row.tag);
                
                return callback({
                    success: true,
                    snippet: {
                        _id: snippetId,
                        name: newSnippet.name,
                        content: cleanSnippet.content, // Return unencrypted content to client
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

    // New handler for toggling snippet pin status
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

            // Validate the user session
            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }

            // Get the snippet
            const snippet = statements.findSnippetById.get(snippetId);
            if (!snippet) {
                logger.warn(`Snippet not found: ${snippetId}`);
                return callback({ error: 'Snippet not found' });
            }

            // Check if the user owns this snippet or it's shared with them
            const isOwner = snippet.createdBy === user.id;
            if (!isOwner) {
                const hasAccess = statements.findSnippetUsers.all(snippetId)
                    .some(row => row.userId === user.id);
                if (!hasAccess) {
                    logger.warn(`User does not have access to snippet: ${snippetId}`);
                    return callback({ error: 'Access denied' });
                }
            }

            // Update the snippet's pin status
            const result = statements.updateSnippet.run(
                snippet.name,
                snippet.content,
                snippet.folder,
                isPinned ? 1 : 0,
                snippetId
            );

            if (result && result.changes > 0) {
                logger.info(`Pin status updated for snippet: ${snippetId}`);
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
            // Validate the user session
            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }

            // Get all snippets accessible by this user
            const snippets = statements.findSnippetsByUser.all(userId);
            
            // Process each snippet to include detailed information
            const detailedSnippets = [];
            for (const snippet of snippets) {
                try {
                    // Find the creator user
                    const createdBy = statements.findUserById.get(snippet.createdBy);
                    if (!createdBy) {
                        logger.warn(`Owner not found for snippet: ${snippet.id}`);
                        continue;
                    }

                    // Get users with access to this snippet
                    const userIds = statements.findSnippetUsers.all(snippet.id).map(row => row.userId);
                    
                    // Get tags for this snippet
                    const tags = statements.findSnippetTags.all(snippet.id).map(row => row.tag);
                    
                    // Decrypt the snippet content
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
            logger.debug(`Editing snippet for user: ${userId}`);

            if (!oldSnippet || !newSnippet) {
                logger.warn('Missing snippet configurations');
                return callback({ error: 'Missing snippet configurations' });
            }

            // Validate the user session
            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }

            let snippetId = null;
            let snippetToEdit = null;
            
            // First check if we already have a snippet ID from the frontend
            if (oldSnippet._id || oldSnippet.id) {
                snippetId = oldSnippet._id || oldSnippet.id;
                snippetToEdit = statements.findSnippetById.get(snippetId);
                
                // Verify this snippet exists and belongs to the user
                if (!snippetToEdit || snippetToEdit.createdBy !== userId) {
                    logger.warn(`Snippet not found or unauthorized by ID: ${snippetId}`);
                    return callback({ error: 'Snippet not found or you do not have permission to edit it' });
                }
            } else {
                logger.warn('No snippet ID provided for editing');
                return callback({ error: 'Snippet ID is required' });
            }
            
            // Verify we found a valid snippet
            if (!snippetId) {
                logger.warn('Could not identify snippet to edit');
                return callback({ error: 'Snippet not found' });
            }

            const finalName = newSnippet.name?.trim() || snippetToEdit.name;

            // Use a transaction for all checks and updates
            const db_transaction = db.transaction(() => {
                // If the name is being changed, check for duplicates using case-insensitive comparison
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

                // Update the snippet record
                statements.updateSnippet.run(
                    cleanSnippet.name,
                    encryptedContent,
                    cleanSnippet.folder,
                    cleanSnippet.isPinned ? 1 : 0,
                    snippetId
                );

                // Update tags: remove old ones and add new ones
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
                
                // Add a small delay to ensure database writes complete
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

            // Validate user session
            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }

            // Use a transaction to ensure atomicity
            const db_transaction = db.transaction(() => {
                // First check if the snippet exists
                const snippet = statements.findSnippetById.get(snippetId);
                if (!snippet) {
                    logger.warn(`Snippet not found: ${snippetId}`);
                    throw new Error('Snippet not found');
                }

                // Check if user is the creator
                if (snippet.createdBy === userId) {
                    // User is the creator, delete the snippet completely
                    logger.info(`Deleting snippet ${snippetId} as owner`);
                    
                    // Delete snippet tags
                    statements.deleteSnippetTags.run(snippetId);
                    
                    // Delete snippet users relationship
                    statements.deleteSnippetUsers.run(snippetId);
                    
                    // Delete the snippet itself
                    statements.deleteSnippet.run(snippetId, userId);
                } else {
                    // User is not the creator, just remove their access
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

            // Validate the user session
            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }

            // Find the target user by username
            const targetUser = statements.findUserByUsername.get(targetUsername);
            if (!targetUser) {
                logger.warn(`Target user not found: ${targetUsername}`);
                return callback({ error: 'User not found' });
            }

            // Find the snippet and ensure the requesting user is the creator
            const snippet = statements.findSnippetByIdAndCreator.get(snippetId, userId);
            if (!snippet) {
                logger.warn(`Snippet not found or unauthorized: ${snippetId}`);
                return callback({ error: 'Snippet not found or you do not have permission to share it' });
            }

            // Check if snippet is already shared with target user
            const snippetUsers = statements.findSnippetUsers.all(snippetId).map(row => row.userId);
            if (snippetUsers.includes(targetUser.id)) {
                logger.warn(`Snippet already shared with user: ${targetUsername}`);
                return callback({ error: 'Already shared' });
            }

            // Add the target user to the snippet_users table
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

            // Validate the user session
            const user = statements.findUserByIdAndSessionToken.get(userId, sessionToken);
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }

            // Check if the snippet exists
            const snippet = statements.findSnippetById.get(snippetId);
            if (!snippet) {
                logger.warn(`Snippet not found: ${snippetId}`);
                return callback({ error: 'Snippet not found' });
            }

            // Remove user from the snippet_users table
            statements.removeSnippetUser.run(snippetId, userId);

            logger.info(`Share removed successfully: ${snippetId} -> ${userId}`);
            callback({ success: true });
        } catch (error) {
            logger.error('Share removal error:', error);
            callback({ error: 'Failed to remove snippet share' });
        }
    });
});

server.listen(8082, () => {
    logger.info('Server running on port 8082');
});