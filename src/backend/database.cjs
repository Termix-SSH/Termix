const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
require('dotenv').config();

const logger = {
    info: (...args) => console.log(`🔧 [${new Date().toISOString()}] INFO:`, ...args),
    error: (...args) => console.error(`❌ [${new Date().toISOString()}] ERROR:`, ...args),
    warn: (...args) => console.warn(`⚠️ [${new Date().toISOString()}] WARN:`, ...args),
    debug: (...args) => console.debug(`🔍 [${new Date().toISOString()}] DEBUG:`, ...args)
};

const server = http.createServer();
const io = socketIo(server, {
    path: '/database.io/socket.io',
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    sessionToken: { type: String, required: true }
});

const hostSchema = new mongoose.Schema({
    name: { type: String, required: true },
    config: { type: String, required: true },
    users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    folder: { type: String, default: null }
});

const User = mongoose.model('User', userSchema);
const Host = mongoose.model('Host', hostSchema);

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

mongoose.connect(process.env.MONGO_URL || 'mongodb://mongodb:27017/termix')
    .then(() => logger.info('Connected to MongoDB'))
    .catch(err => logger.error('MongoDB connection error:', err));

io.of('/database.io').on('connection', (socket) => {
    socket.on('createUser', async ({ username, password }, callback) => {
        try {
            logger.debug(`Creating user: ${username}`);

            if (await User.exists({ username })) {
                logger.warn(`Username already exists: ${username}`);
                return callback({ error: 'Username already exists' });
            }

            const sessionToken = crypto.randomBytes(64).toString('hex');
            const user = await User.create({
                username,
                password: await bcrypt.hash(password, 10),
                sessionToken
            });

            logger.info(`User created: ${username}`);
            callback({ success: true, user: {
                    id: user._id,
                    username: user.username,
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
                user = await User.findOne({ sessionToken });
            } else {
                user = await User.findOne({ username });
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
                    id: user._id,
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

            const user = await User.create({
                username,
                password: await bcrypt.hash(username, 10),
                sessionToken
            });

            logger.info(`Guest user created: ${username}`);
            callback({ success: true, user: {
                    id: user._id,
                    username: user.username,
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

            const user = await User.findOne({ _id: userId, sessionToken });
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
                rsaKey: hostConfig.rsaKey?.trim() || undefined
            };

            const finalName = cleanConfig.name || cleanConfig.ip;

            const existingHost = await Host.findOne({
                name: finalName,
                createdBy: userId
            });

            if (existingHost) {
                logger.warn(`Host with name ${finalName} already exists for user: ${userId}`);
                return callback({ error: 'Host with this name already exists' });
            }

            const encryptedConfig = encryptData(cleanConfig, userId, sessionToken);
            if (!encryptedConfig) {
                logger.error('Encryption failed for host config');
                return callback({ error: 'Configuration encryption failed' });
            }

            await Host.create({
                name: finalName,
                config: encryptedConfig,
                users: [userId],
                createdBy: userId,
                folder: cleanConfig.folder
            });

            logger.info(`Host created successfully: ${finalName}`);
            callback({ success: true });
        } catch (error) {
            logger.error('Host save error:', error);
            callback({ error: `Host save failed: ${error.message}` });
        }
    });

    socket.on('getHosts', async ({ userId, sessionToken }, callback) => {
        try {
            const user = await User.findOne({ _id: userId, sessionToken });
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }

            const hosts = await Host.find({ users: userId });
            const decryptedHosts = hosts.map(host => ({
                ...host.toObject(),
                config: decryptData(host.config, userId, sessionToken)
            })).filter(host => host.config);

            callback({ success: true, hosts: decryptedHosts });
        } catch (error) {
            logger.error('Get hosts error:', error);
            callback({ error: 'Failed to fetch hosts' });
        }
    });

    socket.on('deleteHost', async ({ userId, sessionToken, hostId }, callback) => {
        try {
            logger.debug(`Deleting host: ${hostId} for user: ${userId}`);

            if (!userId || !sessionToken) {
                logger.warn('Missing authentication parameters');
                return callback({ error: 'Authentication required' });
            }

            if (!hostId || typeof hostId !== 'string') {
                logger.warn('Invalid host ID format');
                return callback({ error: 'Invalid host ID' });
            }

            const user = await User.findOne({ _id: userId, sessionToken });
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }

            const result = await Host.deleteOne({ _id: hostId, createdBy: userId });
            if (result.deletedCount === 0) {
                logger.warn(`Host not found or not authorized: ${hostId}`);
                return callback({ error: 'Host not found or not authorized' });
            }

            logger.info(`Host deleted: ${hostId}`);
            callback({ success: true });
        } catch (error) {
            logger.error('Host deletion error:', error);
            callback({ error: `Host deletion failed: ${error.message}` });
        }
    });

    socket.on('shareHost', async ({ userId, sessionToken, hostId, targetUsername }, callback) => {
        try {
            logger.debug(`Sharing host ${hostId} with ${targetUsername}`);

            const user = await User.findOne({ _id: userId, sessionToken });
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }

            const targetUser = await User.findOne({ username: targetUsername });
            if (!targetUser) {
                logger.warn(`Target user not found: ${targetUsername}`);
                return callback({ error: 'User not found' });
            }

            const host = await Host.findOne({ _id: hostId, createdBy: userId });
            if (!host) {
                logger.warn(`Host not found or unauthorized: ${hostId}`);
                return callback({ error: 'Host not found' });
            }

            if (host.users.includes(targetUser._id)) {
                logger.warn(`Host already shared with user: ${targetUsername}`);
                return callback({ error: 'Already shared' });
            }

            host.users.push(targetUser._id);
            await host.save();

            logger.info(`Host shared successfully: ${hostId} -> ${targetUsername}`);
            callback({ success: true });
        } catch (error) {
            logger.error('Host sharing error:', error);
            callback({ error: 'Failed to share host' });
        }
    });

    socket.on('deleteUser', async ({ userId, sessionToken }, callback) => {
        try {
            logger.debug(`Deleting user: ${userId}`);

            const user = await User.findOne({ _id: userId, sessionToken });
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }

            await Host.deleteMany({ createdBy: userId });
            await User.deleteOne({ _id: userId });

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

            const user = await User.findOne({ _id: userId, sessionToken });
            if (!user) {
                logger.warn(`Invalid session for user: ${userId}`);
                return callback({ error: 'Invalid session' });
            }

            const hosts = await Host.find({ createdBy: userId });
            const host = hosts.find(h => {
                const decryptedConfig = decryptData(h.config, userId, sessionToken);
                return decryptedConfig && decryptedConfig.ip === oldHostConfig.ip;
            });

            if (!host) {
                logger.warn(`Host not found or unauthorized`);
                return callback({ error: 'Host not found' });
            }

            const cleanConfig = {
                name: newHostConfig.name?.trim(),
                folder: newHostConfig.folder?.trim() || null,
                ip: newHostConfig.ip.trim(),
                user: newHostConfig.user.trim(),
                port: newHostConfig.port || 22,
                password: newHostConfig.password?.trim() || undefined,
                rsaKey: newHostConfig.rsaKey?.trim() || undefined
            };

            const encryptedConfig = encryptData(cleanConfig, userId, sessionToken);
            if (!encryptedConfig) {
                logger.error('Encryption failed for host config');
                return callback({ error: 'Configuration encryption failed' });
            }

            host.config = encryptedConfig;
            host.folder = cleanConfig.folder;
            await host.save();

            logger.info(`Host edited successfully`);
            callback({ success: true });
        } catch (error) {
            logger.error('Host edit error:', error);
            callback({ error: 'Failed to edit host' });
        }
    });

    socket.on('verifySession', async ({ sessionToken }, callback) => {
        try {
            const user = await User.findOne({ sessionToken });
            if (!user) {
                logger.warn(`Invalid session token: ${sessionToken}`);
                return callback({ error: 'Invalid session' });
            }

            callback({ success: true, user: {
                    id: user._id,
                    username: user.username
                }});
        } catch (error) {
            logger.error('Session verification error:', error);
            callback({ error: 'Session verification failed' });
        }
    });
});

server.listen(8082, () => {
    logger.info('Server running on port 8082');
});