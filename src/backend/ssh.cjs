const http = require("http");
const socketIo = require("socket.io");
const SSHClient = require("ssh2").Client;

const server = http.createServer();
const io = socketIo(server, {
    path: "/ssh.io/socket.io",
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    allowEIO3: true,
    pingInterval: 2500,
    pingTimeout: 5000,
    maxHttpBufferSize: 1e7,
});

const logger = {
    info: (...args) => console.log(`🔧 [${new Date().toISOString()}] INFO:`, ...args),
    error: (...args) => console.error(`❌ [${new Date().toISOString()}] ERROR:`, ...args),
    warn: (...args) => console.warn(`⚠️ [${new Date().toISOString()}] WARN:`, ...args),
    debug: (...args) => console.debug(`🔍 [${new Date().toISOString()}] DEBUG:`, ...args)
};

io.on("connection", (socket) => {
    logger.info("New socket connection established");

    let stream = null;
    let conn = null;

    socket.on("connectToHost", (cols, rows, hostConfig) => {
        if (!hostConfig || !hostConfig.ip || !hostConfig.user || !hostConfig.port) {
            logger.error("Invalid hostConfig received - missing required fields:", hostConfig);
            socket.emit("error", "Missing required connection details (IP, user, or port)");
            return;
        }

        if (!hostConfig.password && !hostConfig.sshKey) {
            logger.error("No authentication provided");
            socket.emit("error", "Authentication required");
            return;
        }

        const safeHostConfig = {
            ip: hostConfig.ip,
            port: hostConfig.port,
            user: hostConfig.user,
            authType: hostConfig.password ? 'password' : 'key',
        };

        // Only log this for monitoring purposes
        logger.info("SSH connection request:", safeHostConfig);
        const { ip, port, user, password, sshKey, } = hostConfig;

        // First close any existing connection
        if (conn) {
            try {
                // Store reference and clear first
                const currentConn = conn;
                conn = null;
                stream = null;
                currentConn.end();
            } catch (err) {
                // Silent error handling
            }
        }

        conn = new SSHClient();
        conn
            .on("ready", function () {
                conn.shell({ term: "xterm-256color", keepaliveInterval: 30000 }, function (err, newStream) {
                    if (err) {
                        logger.error("Shell error:", err.message);
                        socket.emit("error", err.message);
                        return;
                    }
                    stream = newStream;

                    stream.setWindow(rows, cols, rows * 100, cols * 100);

                    stream.on("data", function (data) {
                        socket.emit("data", data);
                    });

                    stream.on("close", function () {
                        const currentConn = conn;
                        stream = null;
                        
                        if (currentConn) {
                            try {
                                currentConn.end();
                            } catch (err) {
                                // Silent error handling
                            }
                        }
                    });

                    socket.on("data", function (data) {
                        if (stream) {
                            stream.write(data);
                        }
                    });

                    socket.on("resize", ({ cols, rows }) => {
                        if (stream && stream.setWindow) {
                            stream.setWindow(rows, cols, rows * 100, cols * 100);
                        }
                    });

                    socket.emit("resize", { cols, rows });
                });
            })
            .on("close", function () {
                socket.emit("error", "SSH connection closed");
                conn = null;
                stream = null;
            })
            .on("error", function (err) {
                // Only log actual error message, nothing else
                logger.error("SSH error:", err.message);
                socket.emit("error", err.message);
                
                // Save references before nullifying
                const currentConn = conn;
                conn = null;
                stream = null;
                
                // Attempt to close the connection on error
                if (currentConn) {
                    try {
                        currentConn.end();
                    } catch (closeErr) {
                        // Silent error handling
                    }
                }
            })
            .on("ping", function () {
                socket.emit("ping");
            })
            .connect({
                host: ip,
                port: port,
                username: user,
                password: password || undefined,
                privateKey: sshKey ? Buffer.from(sshKey) : undefined,
                algorithms: {
                    kex: ['curve25519-sha256', 'curve25519-sha256@libssh.org', 'ecdh-sha2-nistp256'],
                    serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256']
                },
                keepaliveInterval: 10000,
                keepaliveCountMax: 5,
                readyTimeout: 5000,
            });
    });

    socket.on("disconnect", () => {
        // Clean up any existing SSH connection when the client disconnects
        // Store references to avoid null reference issues
        const currentStream = stream;
        const currentConn = conn;
        
        // Immediately null the references to prevent double cleanup
        stream = null;
        conn = null;
        
        // Check if we have a valid stream
        if (currentStream) {
            try {
                // Just write exit without logging
                currentStream.write("exit\r");
            } catch (err) {
                // Silent error handling - no logging
            }
        }
        
        // Check if we have a valid connection
        if (currentConn) {
            try {
                currentConn.end();
            } catch (err) {
                // Silent error handling - no logging
            }
        }
    });
});

server.listen(8081, '0.0.0.0', () => {
    logger.info("Server is running on port 8081");
});