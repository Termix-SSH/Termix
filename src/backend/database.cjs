const http = require("http");
const socketIo = require("socket.io");
const mongoose = require("mongoose");
const crypto = require('crypto');
require('dotenv').config();

const server = http.createServer();
const io = socketIo(server, {
    path: "/database.io/socket.io",
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    allowEIO3: true
});

const dbNamespace = io.of("/database.io");

async function connectToMongoDB() {
    try {
        const mongoUrl = process.env.MONGO_URL || 'mongodb://mongodb:27017/termix';
        await mongoose.connect(mongoUrl, {});
        console.log('Connected to MongoDB');

        const db = mongoose.connection.db;

        // Create the 'users' collection if it doesn't exist
        const collections = await db.listCollections().toArray();
        if (!collections.find(col => col.name === 'users')) {
            await db.createCollection('users');
            console.log('Successfully created collection: users');
        }
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
    }
}

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    sessionToken: { type: String, required: true },
    sshConnections: { type: [Object], default: [] },
});

const User = mongoose.model('User', userSchema);

async function createUser(username, password) {
    try {
        const userExists = await User.findOne({ username });
        if (userExists) {
            return { error: "User already exists for username" };
        }

        const sessionToken = crypto.randomBytes(64).toString('hex');
        const newUser = new User({ username, password, sessionToken });
        await newUser.save();
        return { success: true, user: { _id: newUser._id, username: newUser.username, sessionToken: newUser.sessionToken } };
    } catch (err) {
        return { error: 'Error creating user: ' + err.message };
    }
}

async function loginUser(username, password) {
    try {
        const user = await User.findOne({ username, password });
        if (user) {
            if (!user.sessionToken) {
                user.sessionToken = crypto.randomBytes(64).toString('hex');
                await user.save();
            }
            return {
                _id: user._id,
                username: user.username,
                sessionToken: user.sessionToken,
            };
        } else {
            return { error: 'User not found or incorrect credentials for username' };
        }
    } catch (err) {
        return { error: 'Error checking user: ' + err.message };
    }
}

async function loginWithToken(sessionToken) {
    try {
        const user = await User.findOne({ sessionToken });
        if (user) {
            return {
                _id: user._id,
                username: user.username,
                sessionToken: user.sessionToken,
            };
        } else {
            return { error: 'Invalid session token' };
        }
    } catch (err) {
        return { error: 'Error checking session token: ' + err.message };
    }
}

async function deleteUser(userId) {
    try {
        const user = await User.findById(userId);
        if (user) {
            await User.deleteOne({ _id: userId });
            return { success: true };
        } else {
            return { error: 'User not found' };
        }
    } catch (err) {
        return { error: 'Error removing user: ' + err.message };
    }
}

async function saveHostConfig(userId, hostConfig) {
    try {
        const user = await User.findById(userId);
        if (user) {
            user.sshConnections.push(hostConfig);
            await user.save();
            return { success: true };
        } else {
            return { error: 'User not found' };
        }
    } catch (err) {
        return { error: 'Error saving host config: ' + err.message };
    }
}

async function getHosts(userId) {
    try {
        const user = await User.findById(userId);
        if (user) {
            return user.sshConnections;
        } else {
            return { error: 'User not found' };
        }
    } catch (err) {
        return { error: 'Error getting hosts: ' + err.message };
    }
}

async function deleteHost(userId, hostConfig) {
    try {
        const user = await User.findById(userId);
        if (user) {
            user.sshConnections = user.sshConnections.filter(connection => {
                const matches =
                    connection.name === hostConfig.name &&
                    connection.ip === hostConfig.ip &&
                    connection.port === hostConfig.port &&
                    connection.user === hostConfig.user;

                return !matches;
            });

            await user.save();
            return { success: true };
        } else {
            return { error: 'User not found' };
        }
    } catch (err) {
        return { error: 'Error deleting host: ' + err.message };
    }
}

async function editHost(userId, oldHostConfig, newHostConfig) {
    try {
        const user = await User.findById(userId);
        if (user) {
            user.sshConnections = user.sshConnections.map(connection => {
                const matches =
                    connection.hostConfig.name === oldHostConfig.name &&
                    connection.hostConfig.ip === oldHostConfig.ip &&
                    connection.hostConfig.port === oldHostConfig.port &&
                    connection.hostConfig.user === oldHostConfig.user;

                if (matches) {
                    return { hostConfig: newHostConfig };
                } else {
                    return connection;
                }
            });

            await user.save();
            return { success: true };
        } else {
            return { error: 'User not found' };
        }
    } catch (err) {
        return { error: 'Error editing host: ' + err.message };
    }
}

async function createFolder(userId, folderName) {
    try {
        const user = await User.findById(userId);
        if (user) {
            user.sshConnections.push({ folderName, connections: [] });
            await user.save();
            return { success: true };
        } else {
            return { error: 'User not found' };
        }
    } catch (err) {
        return { error: 'Error creating folder: ' + err.message };
    }
}

async function moveHostToFolder(userId, hostConfig, folderName) {
    try {
        const user = await User.findById(userId);
        if (user) {
            const folder = user.sshConnections.find(folder => folder.folderName === folderName);
            if (folder) {
                folder.connections.push(hostConfig);
                await user.save();
                return { success: true };
            } else {
                return { error: 'Folder not found' };
            }
        } else {
            return { error: 'User not found' };
        }
    } catch (err) {
        return { error: 'Error moving host to folder: ' + err.message };
    }
}

dbNamespace.on("connection", (socket) => {
    console.log("New socket connection established on");

    socket.on("createUser", async (data) => {
        const { username, password } = data;
        if (!username || !password) {
            socket.emit("error", "Please provide both username and password");
            return;
        }
        const result = await createUser(username, password);
        socket.emit(result.error ? "error" : "userCreated", result);
        console.log(result.error || `User created`);
    });

    socket.on("loginUser", async (data) => {
        const { username, password, sessionToken } = data;
        let result;
        if (sessionToken) {
            result = await loginWithToken(sessionToken);
        } else if (username && password) {
            result = await loginUser(username, password);
        } else {
            socket.emit("error", "Please provide both username and password or a session token");
            return;
        }
        socket.emit(result.error ? "error" : "userFound", result);
        console.log(result.error || `User logged in`);
    });

    socket.on("deleteUser", async (data) => {
        const { userId } = data;
        if (!userId) {
            socket.emit("error", "User ID is required");
            return;
        }
        const result = await deleteUser(userId);
        socket.emit(result.error ? "error" : "userDeleted", result);
        console.log(result.error || `User deleted`);
    });

    socket.on("saveHostConfig", async (data) => {
        const { userId, hostConfig } = data;
        if (!userId || !hostConfig) {
            socket.emit("error", "User ID and host config are required");
            return;
        }
        const result = await saveHostConfig(userId, hostConfig);
        socket.emit(result.error ? "error" : "hostConfigSaved", result);
        console.log(result.error || `Host config saved`);
    });

    socket.on("getHosts", async (data) => {
        const { userId } = data;
        if (!userId) {
            socket.emit("error", "User ID is required");
            return;
        }
        const result = await getHosts(userId);
        socket.emit(result.error ? "error" : "hostsFound", result);
        console.log(result.error || `Hosts found`);
    });

    socket.on("deleteHost", async (data) => {
        const { userId, hostConfig } = data;
        if (!userId || !hostConfig) {
            socket.emit("error", "User ID and host config are required");
            return;
        }
        const result = await deleteHost(userId, hostConfig);
        socket.emit(result.error ? "error" : "hostDeleted", result);
        console.log(result.error || `Host deleted`);
    });

    socket.on("editHost", async (data) => {
        const { userId, oldHostConfig, newHostConfig } = data;
        if (!userId || !oldHostConfig || !newHostConfig) {
            socket.emit("error", "User ID, old host config, and new host config are required");
            return;
        }
        const result = await editHost(userId, oldHostConfig, newHostConfig);
        socket.emit(result.error ? "error" : "hostEdited", result);
        console.log(result.error || `Host edited`);
    });

    socket.on("createFolder", async (data) => {
        const { userId, folderName } = data;
        if (!userId || !folderName) {
            socket.emit("error", "User ID and folder name are required");
            return;
        }
        const result = await createFolder(userId, folderName);
        socket.emit(result.error ? "error" : "folderCreated", result);
        console.log(result.error || `Folder created`);
    });

    socket.on("moveHostToFolder", async (data) => {
        const { userId, hostConfig, folderName } = data;
        if (!userId || !hostConfig || !folderName) {
            socket.emit("error", "User ID, host config, and folder name are required");
            return;
        }
        const result = await moveHostToFolder(userId, hostConfig, folderName);
        socket.emit(result.error ? "error" : "hostMoved", result);
        console.log(result.error || `Host moved to folder`);
    });
});

server.listen(8082, '0.0.0.0', async () => {
    console.log("Server is running on port 8082");
    await connectToMongoDB();
});