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
    pingInterval: 2000,
    pingTimeout: 10000,
    maxHttpBufferSize: 1e7,
    connectTimeout: 15000,
    transports: ['websocket', 'polling'],
});

const logger = {
    info: (...args) => console.log(`⌨️ | 🔧 [${new Date().toISOString()}] INFO:`, ...args),
    error: (...args) => console.error(`⌨️ | ❌ [${new Date().toISOString()}] ERROR:`, ...args),
    warn: (...args) => console.warn(`⌨️ | ⚠️ [${new Date().toISOString()}] WARN:`, ...args),
    debug: (...args) => console.debug(`⌨️ | 🔍 [${new Date().toISOString()}] DEBUG:`, ...args)
};

io.on("connection", (socket) => {
    let stream = null;
    let conn = null;
    let pingTimer = null;

    function setupPingInterval() {
        if (pingTimer) {
            clearInterval(pingTimer);
        }
        
        pingTimer = setInterval(() => {
            if (socket && socket.connected) {
                socket.emit("ping");

                if (conn && conn.ping) {
                    try {
                        conn.ping();
                    } catch (err) {
                    }
                }
            } else {
                clearInterval(pingTimer);
            }
        }, 3000);
    }

    setupPingInterval();

    socket.on("connectToHost", (cols, rows, hostConfig) => {
        if (!hostConfig || !hostConfig.ip || !hostConfig.user || !hostConfig.port) {
            logger.error("Invalid hostConfig received");
            socket.emit("error", "Missing required connection details (IP, user, or port)");
            return;
        }

        if (!hostConfig.password && !hostConfig.sshKey) {
            logger.error("No authentication provided");
            socket.emit("error", "Authentication required");
            return;
        }

        const { ip, port, user, password, sshKey } = hostConfig;
        const sshAlgorithm = hostConfig.sshAlgorithm || 'default';

        if (conn) {
            try {
                const currentConn = conn;
                conn = null;
                stream = null;
                currentConn.end();
            } catch (err) {
            }
        }

        conn = new SSHClient();
        conn
            .on("ready", function () {
                conn.shell({ 
                    term: "xterm-256color", 
                    modes: {
                        ECHO: 1,
                        ECHOCTL: 0,
                        ICANON: 1
                    },
                    keepaliveInterval: 30000 
                }, function (err, newStream) {
                    if (err) {
                        logger.error("Shell error:", err.message);
                        socket.emit("error", err.message);
                        return;
                    }
                    stream = newStream;

                    const currentCols = cols;
                    const currentRows = rows;

                    stream.setWindow(currentRows, currentCols - 1, currentRows * 100, (currentCols - 1) * 100);

                    stream.on("data", function (data) {
                        socket.emit("data", data);
                    });

                    stream.on("close", function () {
                        if (stream) {
                            try {
                                stream.end();
                            } catch (err) {
                                logger.error("Error ending stream:", err.message);
                            }
                        }
                        
                        if (conn) {
                            try {
                                conn.end();
                            } catch (err) {
                                logger.error("Error ending connection:", err.message);
                            }
                            conn = null;
                        }
                        
                        stream = null;
                    });

                    socket.on("data", function (data) {
                        stream.write(data);
                    });

                    socket.on("resize", function (data) {
                        if (stream && stream.setWindow) {
                            stream.setWindow(data.rows, data.cols - 1, data.rows * 100, (data.cols - 1) * 100);
                            socket.emit("resize", { cols: data.cols, rows: data.rows });
                        }
                    });

                    socket.emit("resize", { cols, rows });
                });
            })
            .on("close", function () {
                if (stream) {
                    try {
                        stream.end();
                    } catch (err) {
                    }
                }
                
                conn = null;
                stream = null;
            })
            .on("error", function (err) {
                logger.error("SSH error:", err.message);
                socket.emit("error", err.message);

                const currentConn = conn;
                const currentStream = stream;

                conn = null;
                stream = null;

                if (currentStream) {
                    try {
                        currentStream.end();
                    } catch (closeErr) {
                    }
                }
                
                if (currentConn) {
                    try {
                        currentConn.end();
                    } catch (closeErr) {
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
                keepaliveInterval: 5000,
                keepaliveCountMax: 10,
                readyTimeout: 10000,
                tcpKeepAlive: true,
            });
    });

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
        const currentStream = stream;
        const currentConn = conn;
        
        if (pingTimer) {
            clearInterval(pingTimer);
            pingTimer = null;
        }
        
        stream = null;
        conn = null;
        
        if (currentStream) {
            try {
                currentStream.write("exit\r");
            } catch (err) {
            }
        }
        
        if (currentConn) {
            try {
                currentConn.end();
            } catch (err) {
            }
        }
    });
});

server.listen(8082, '0.0.0.0', () => {
    logger.info("Server is running on port 8082");
});