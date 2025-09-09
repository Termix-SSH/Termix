//  npx tsc -p tsconfig.node.json
//  node ./dist/backend/starter.js

import './database/database.js'
import './ssh/terminal.js';
import './ssh/tunnel.js';
import './ssh/file-manager.js';
import './ssh/server-stats.js';
import { systemLogger } from './utils/logger.js';

(async () => {
    try {
        systemLogger.info("Initializing backend services...", { operation: 'startup' });
        
        systemLogger.success("All backend services initialized successfully", { 
            operation: 'startup_complete',
            services: ['database', 'terminal', 'tunnel', 'file_manager', 'stats']
        });

        process.on('SIGINT', () => {
            systemLogger.info("Received SIGINT signal, initiating graceful shutdown...", { operation: 'shutdown' });
            process.exit(0);
        });

        process.on('SIGTERM', () => {
            systemLogger.info("Received SIGTERM signal, initiating graceful shutdown...", { operation: 'shutdown' });
            process.exit(0);
        });

        process.on('uncaughtException', (error) => {
            systemLogger.error("Uncaught exception occurred", error, { operation: 'error_handling' });
            process.exit(1);
        });

        process.on('unhandledRejection', (reason, promise) => {
            systemLogger.error("Unhandled promise rejection", reason, { operation: 'error_handling' });
            process.exit(1);
        });

    } catch (error) {
        systemLogger.error("Failed to initialize backend services", error, { operation: 'startup_failed' });
        process.exit(1);
    }
})();