const http = require("http");
const socketIo = require("socket.io");

const server = http.createServer();
const io = socketIo(server, {
    path: "/sftp.io/socket.io",
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
    info: (...args) => console.log(`📁 | 🔧 [${new Date().toISOString()}] INFO:`, ...args),
    error: (...args) => console.error(`📁 | ❌ [${new Date().toISOString()}] ERROR:`, ...args),
    warn: (...args) => console.warn(`📁 | ⚠️ [${new Date().toISOString()}] WARN:`, ...args),
    debug: (...args) => console.debug(`📁 | 🔍 [${new Date().toISOString()}] DEBUG:`, ...args)
};

server.listen(8085, '0.0.0.0', () => {
    logger.info("Server is running on port 8085");
});