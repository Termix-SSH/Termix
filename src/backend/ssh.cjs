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
    pingInterval: 2000,         // Reduced ping interval
    pingTimeout: 10000,         // Increased ping timeout
    maxHttpBufferSize: 1e7,
    connectTimeout: 15000,      // Increased connection timeout
    transports: ['websocket', 'polling'],
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
    let pingTimer = null;

    // Setup a more frequent ping interval to keep the socket alive
    function setupPingInterval() {
        // Clear any existing ping timer
        if (pingTimer) {
            clearInterval(pingTimer);
        }
        
        // Set up a new ping interval that will keep both the socket and SSH connection alive
        pingTimer = setInterval(() => {
            if (socket && socket.connected) {
                socket.emit("ping");
                // If we have an SSH connection, send a keepalive
                if (conn && conn.ping) {
                    try {
                        conn.ping();
                    } catch (err) {
                        // Silent error handling
                    }
                }
            } else {
                clearInterval(pingTimer);
            }
        }, 3000); // Send ping every 3 seconds
    }

    // Start ping immediately after connection
    setupPingInterval();

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
            sshAlgorithm: hostConfig.terminalConfig?.sshAlgorithm || 'default'
        };

        // Only log this for monitoring purposes
        logger.info("SSH connection request:", safeHostConfig);
        const { ip, port, user, password, sshKey } = hostConfig;
        const sshAlgorithm = hostConfig.terminalConfig?.sshAlgorithm || 'default';

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
                algorithms: getAlgorithms(sshAlgorithm),
                keepaliveInterval: 5000,      // Send keepalive every 5 seconds
                keepaliveCountMax: 10,        // Allow up to 10 missed keepalives
                readyTimeout: 10000,          // Longer timeout for connection
                tcpKeepAlive: true,           // Enable TCP keepalive on socket
            });
    });

    // Helper function to select SSH algorithms based on preference
    function getAlgorithms(algorithmPreference) {
        switch (algorithmPreference) {
            case 'legacy':
                return {
                    kex: ['diffie-hellman-group1-sha1', 'diffie-hellman-group14-sha1'],
                    serverHostKey: ['ssh-rsa', 'ssh-dss']
                };
            case 'secure':
                return {
                    kex: ['curve25519-sha256', 'curve25519-sha256@libssh.org', 'diffie-hellman-group-exchange-sha256'],
                    serverHostKey: ['ssh-ed25519', 'rsa-sha2-512', 'rsa-sha2-256']
                };
            case 'default':
            default:
                return {
                    kex: ['curve25519-sha256', 'curve25519-sha256@libssh.org', 'ecdh-sha2-nistp256'],
                    serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256']
                };
        }
    }

    socket.on("disconnect", () => {
        // Clean up any existing SSH connection when the client disconnects
        // Store references to avoid null reference issues
        const currentStream = stream;
        const currentConn = conn;
        
        // Clean up ping timer
        if (pingTimer) {
            clearInterval(pingTimer);
            pingTimer = null;
        }
        
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