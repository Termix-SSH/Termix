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
    allowEIO3: true
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

        logger.info("Connecting with config:", safeHostConfig);
        const { ip, port, user, password, sshKey, } = hostConfig;

        const conn = new SSHClient();
        conn
            .on("ready", function () {
                logger.info("SSH connection established");

                conn.shell({ term: "xterm-256color" }, function (err, newStream) {
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
                        logger.info("SSH stream closed");
                        conn.end();
                    });

                    socket.on("data", function (data) {
                        stream.write(data);
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
                logger.info("SSH connection closed");
                socket.emit("error", "SSH connection closed");
            })
            .on("error", function (err) {
                logger.error("Error:", err.message);
                socket.emit("error", err.message);
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
                }
            });
    });

    socket.on("disconnect", () => {
        logger.info("Client disconnected");
    });
});

server.listen(8081, '0.0.0.0', () => {
    logger.info("Server is running on port 8081");
});