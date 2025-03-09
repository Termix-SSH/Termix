const http = require("http");
const socketIo = require("socket.io");
const SSHClient = require("ssh2").Client;

const server = http.createServer();
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    allowEIO3: true
});

io.on("connection", (socket) => {
    console.log("New socket connection established");

    let stream = null;

    socket.on("connectToHost", (cols, rows, hostConfig) => {
        if (!hostConfig || !hostConfig.ip || !hostConfig.user || (!hostConfig.password && !hostConfig.rsaKey) || !hostConfig.port) {
            console.error("Invalid hostConfig received:", hostConfig);
            return;
        }

        // Redact only sensitive info for logging
        const safeHostConfig = {
            ip: hostConfig.ip,
            port: hostConfig.port,
            user: hostConfig.user,
            password: hostConfig.password ? '***REDACTED***' : undefined,
            rsaKey: hostConfig.rsaKey ? '***REDACTED***' : undefined,
        };

        console.log("Received hostConfig:", safeHostConfig);
        const { ip, port, user, password, rsaKey } = hostConfig;

        const conn = new SSHClient();
        conn
            .on("ready", function () {
                console.log("SSH connection established");

                conn.shell({ term: "xterm-256color" }, function (err, newStream) {
                    if (err) {
                        console.error("Error:", err.message);
                        socket.emit("error", err.message);
                        return;
                    }
                    stream = newStream;

                    // Set initial terminal size
                    stream.setWindow(rows, cols, rows * 100, cols * 100);

                    // Pipe SSH output to client
                    stream.on("data", function (data) {
                        socket.emit("data", data);
                    });

                    stream.on("close", function () {
                        console.log("SSH stream closed");
                        conn.end();
                    });

                    // Send keystrokes from terminal to SSH
                    socket.on("data", function (data) {
                        stream.write(data);
                    });

                    // Resize SSH terminal when client resizes
                    socket.on("resize", ({ cols, rows }) => {
                        if (stream && stream.setWindow) {
                            stream.setWindow(rows, cols, rows * 100, cols * 100);
                        }
                    });

                    // Auto-send initial terminal size to backend
                    socket.emit("resize", { cols, rows });
                });
            })
            .on("close", function () {
                console.log("SSH connection closed");
                socket.emit("error", "SSH connection closed");
            })
            .on("error", function (err) {
                console.error("Error:", err.message);
                socket.emit("error", err.message);
            })
            .connect({
                host: ip,
                port: port,
                username: user,
                password: password,
                privateKey: rsaKey ? Buffer.from(rsaKey) : undefined,
            });
    });

    socket.on("disconnect", () => {
        console.log("Client disconnected");
    });
});

server.listen(8081, '0.0.0.0', () => {
    console.log("Server is running on port 8081");
});