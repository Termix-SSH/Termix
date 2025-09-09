import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success';

export interface LogContext {
    service?: string;
    operation?: string;
    userId?: string;
    hostId?: number;
    tunnelName?: string;
    sessionId?: string;
    requestId?: string;
    duration?: number;
    [key: string]: any;
}

class Logger {
    private serviceName: string;
    private serviceIcon: string;
    private serviceColor: string;

    constructor(serviceName: string, serviceIcon: string, serviceColor: string) {
        this.serviceName = serviceName;
        this.serviceIcon = serviceIcon;
        this.serviceColor = serviceColor;
    }

    private getTimeStamp(): string {
        return chalk.gray(`[${new Date().toLocaleTimeString()}]`);
    }

    private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
        const timestamp = this.getTimeStamp();
        const levelColor = this.getLevelColor(level);
        const serviceTag = chalk.hex(this.serviceColor)(`[${this.serviceIcon}]`);
        const levelTag = levelColor(`[${level.toUpperCase()}]`);
        
        let contextStr = '';
        if (context) {
            const contextParts = [];
            if (context.operation) contextParts.push(`op:${context.operation}`);
            if (context.userId) contextParts.push(`user:${context.userId}`);
            if (context.hostId) contextParts.push(`host:${context.hostId}`);
            if (context.tunnelName) contextParts.push(`tunnel:${context.tunnelName}`);
            if (context.sessionId) contextParts.push(`session:${context.sessionId}`);
            if (context.requestId) contextParts.push(`req:${context.requestId}`);
            if (context.duration) contextParts.push(`duration:${context.duration}ms`);
            
            if (contextParts.length > 0) {
                contextStr = chalk.gray(` [${contextParts.join(',')}]`);
            }
        }

        return `${timestamp} ${levelTag} ${serviceTag} ${message}${contextStr}`;
    }

    private getLevelColor(level: LogLevel): chalk.Chalk {
        switch (level) {
            case 'debug': return chalk.magenta;
            case 'info': return chalk.cyan;
            case 'warn': return chalk.yellow;
            case 'error': return chalk.redBright;
            case 'success': return chalk.greenBright;
            default: return chalk.white;
        }
    }

    private shouldLog(level: LogLevel): boolean {
        if (level === 'debug' && process.env.NODE_ENV === 'production') {
            return false;
        }
        return true;
    }

    debug(message: string, context?: LogContext): void {
        if (!this.shouldLog('debug')) return;
        console.debug(this.formatMessage('debug', message, context));
    }

    info(message: string, context?: LogContext): void {
        if (!this.shouldLog('info')) return;
        console.log(this.formatMessage('info', message, context));
    }

    warn(message: string, context?: LogContext): void {
        if (!this.shouldLog('warn')) return;
        console.warn(this.formatMessage('warn', message, context));
    }

    error(message: string, error?: unknown, context?: LogContext): void {
        if (!this.shouldLog('error')) return;
        console.error(this.formatMessage('error', message, context));
        if (error) {
            console.error(error);
        }
    }

    success(message: string, context?: LogContext): void {
        if (!this.shouldLog('success')) return;
        console.log(this.formatMessage('success', message, context));
    }

    // Convenience methods for common operations
    auth(message: string, context?: LogContext): void {
        this.info(`AUTH: ${message}`, { ...context, operation: 'auth' });
    }

    db(message: string, context?: LogContext): void {
        this.info(`DB: ${message}`, { ...context, operation: 'database' });
    }

    ssh(message: string, context?: LogContext): void {
        this.info(`SSH: ${message}`, { ...context, operation: 'ssh' });
    }

    tunnel(message: string, context?: LogContext): void {
        this.info(`TUNNEL: ${message}`, { ...context, operation: 'tunnel' });
    }

    file(message: string, context?: LogContext): void {
        this.info(`FILE: ${message}`, { ...context, operation: 'file' });
    }

    api(message: string, context?: LogContext): void {
        this.info(`API: ${message}`, { ...context, operation: 'api' });
    }

    request(message: string, context?: LogContext): void {
        this.info(`REQUEST: ${message}`, { ...context, operation: 'request' });
    }

    response(message: string, context?: LogContext): void {
        this.info(`RESPONSE: ${message}`, { ...context, operation: 'response' });
    }

    connection(message: string, context?: LogContext): void {
        this.info(`CONNECTION: ${message}`, { ...context, operation: 'connection' });
    }

    disconnect(message: string, context?: LogContext): void {
        this.info(`DISCONNECT: ${message}`, { ...context, operation: 'disconnect' });
    }

    retry(message: string, context?: LogContext): void {
        this.warn(`RETRY: ${message}`, { ...context, operation: 'retry' });
    }

    cleanup(message: string, context?: LogContext): void {
        this.info(`CLEANUP: ${message}`, { ...context, operation: 'cleanup' });
    }

    metrics(message: string, context?: LogContext): void {
        this.info(`METRICS: ${message}`, { ...context, operation: 'metrics' });
    }

    security(message: string, context?: LogContext): void {
        this.warn(`SECURITY: ${message}`, { ...context, operation: 'security' });
    }
}

// Service-specific loggers
export const databaseLogger = new Logger('DATABASE', '🗄️', '#1e3a8a');
export const sshLogger = new Logger('SSH', '🖥️', '#1e3a8a');
export const tunnelLogger = new Logger('TUNNEL', '📡', '#1e3a8a');
export const fileLogger = new Logger('FILE', '📁', '#1e3a8a');
export const statsLogger = new Logger('STATS', '📊', '#22c55e');
export const apiLogger = new Logger('API', '🌐', '#3b82f6');
export const authLogger = new Logger('AUTH', '🔐', '#dc2626');
export const systemLogger = new Logger('SYSTEM', '🚀', '#1e3a8a');

// Default logger for general use
export const logger = systemLogger;
