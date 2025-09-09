/**
 * Frontend Logger - A comprehensive logging utility for the frontend
 * Based on the backend logger patterns but adapted for browser environment
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success';

export interface LogContext {
    operation?: string;
    userId?: string;
    hostId?: number;
    tunnelName?: string;
    sessionId?: string;
    requestId?: string;
    duration?: number;
    method?: string;
    url?: string;
    status?: number;
    statusText?: string;
    responseTime?: number;
    retryCount?: number;
    errorCode?: string;
    errorMessage?: string;
    [key: string]: any;
}

class FrontendLogger {
    private serviceName: string;
    private serviceIcon: string;
    private serviceColor: string;
    private isDevelopment: boolean;

    constructor(serviceName: string, serviceIcon: string, serviceColor: string) {
        this.serviceName = serviceName;
        this.serviceIcon = serviceIcon;
        this.serviceColor = serviceColor;
        this.isDevelopment = process.env.NODE_ENV === 'development';
    }

    private getTimeStamp(): string {
        const now = new Date();
        return `[${now.toLocaleTimeString()}.${now.getMilliseconds().toString().padStart(3, '0')}]`;
    }

    private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
        const timestamp = this.getTimeStamp();
        const levelTag = this.getLevelTag(level);
        const serviceTag = this.serviceIcon;
        
        let contextStr = '';
        if (context && this.isDevelopment) {
            const contextParts = [];
            if (context.operation) contextParts.push(context.operation);
            if (context.userId) contextParts.push(`user:${context.userId}`);
            if (context.hostId) contextParts.push(`host:${context.hostId}`);
            if (context.tunnelName) contextParts.push(`tunnel:${context.tunnelName}`);
            if (context.sessionId) contextParts.push(`session:${context.sessionId}`);
            if (context.responseTime) contextParts.push(`${context.responseTime}ms`);
            if (context.status) contextParts.push(`status:${context.status}`);
            if (context.errorCode) contextParts.push(`code:${context.errorCode}`);
            
            if (contextParts.length > 0) {
                contextStr = ` (${contextParts.join(', ')})`;
            }
        }

        return `${timestamp} ${levelTag} ${serviceTag} ${message}${contextStr}`;
    }

    private getLevelTag(level: LogLevel): string {
        const symbols = {
            debug: '🔍',
            info: 'ℹ️',
            warn: '⚠️',
            error: '❌',
            success: '✅'
        };
        return `${symbols[level]} [${level.toUpperCase()}]`;
    }

    private shouldLog(level: LogLevel): boolean {
        if (level === 'debug' && !this.isDevelopment) {
            return false;
        }
        return true;
    }

    private log(level: LogLevel, message: string, context?: LogContext, error?: unknown): void {
        if (!this.shouldLog(level)) return;
        
        const formattedMessage = this.formatMessage(level, message, context);
        
        switch (level) {
            case 'debug':
                console.debug(formattedMessage);
                break;
            case 'info':
                console.log(formattedMessage);
                break;
            case 'warn':
                console.warn(formattedMessage);
                break;
            case 'error':
                console.error(formattedMessage);
                if (error) {
                    console.error('Error details:', error);
                }
                break;
            case 'success':
                console.log(formattedMessage);
                break;
        }
    }

    debug(message: string, context?: LogContext): void {
        this.log('debug', message, context);
    }

    info(message: string, context?: LogContext): void {
        this.log('info', message, context);
    }

    warn(message: string, context?: LogContext): void {
        this.log('warn', message, context);
    }

    error(message: string, error?: unknown, context?: LogContext): void {
        this.log('error', message, context, error);
    }

    success(message: string, context?: LogContext): void {
        this.log('success', message, context);
    }

    // Convenience methods for common operations
    api(message: string, context?: LogContext): void {
        this.info(`API: ${message}`, { ...context, operation: 'api' });
    }

    request(message: string, context?: LogContext): void {
        this.info(`REQUEST: ${message}`, { ...context, operation: 'request' });
    }

    response(message: string, context?: LogContext): void {
        this.info(`RESPONSE: ${message}`, { ...context, operation: 'response' });
    }

    auth(message: string, context?: LogContext): void {
        this.info(`AUTH: ${message}`, { ...context, operation: 'auth' });
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

    connection(message: string, context?: LogContext): void {
        this.info(`CONNECTION: ${message}`, { ...context, operation: 'connection' });
    }

    disconnect(message: string, context?: LogContext): void {
        this.info(`DISCONNECT: ${message}`, { ...context, operation: 'disconnect' });
    }

    retry(message: string, context?: LogContext): void {
        this.warn(`RETRY: ${message}`, { ...context, operation: 'retry' });
    }

    performance(message: string, context?: LogContext): void {
        this.info(`PERFORMANCE: ${message}`, { ...context, operation: 'performance' });
    }

    security(message: string, context?: LogContext): void {
        this.warn(`SECURITY: ${message}`, { ...context, operation: 'security' });
    }

    // Specialized logging methods for different scenarios
    requestStart(method: string, url: string, context?: LogContext): void {
        this.request(`Starting ${method.toUpperCase()} request`, {
            ...context,
            method: method.toUpperCase(),
            url: this.sanitizeUrl(url)
        });
    }

    requestSuccess(method: string, url: string, status: number, responseTime: number, context?: LogContext): void {
        this.response(`Request completed successfully`, {
            ...context,
            method: method.toUpperCase(),
            url: this.sanitizeUrl(url),
            status,
            responseTime
        });
    }

    requestError(method: string, url: string, status: number, errorMessage: string, responseTime?: number, context?: LogContext): void {
        this.error(`Request failed`, undefined, {
            ...context,
            method: method.toUpperCase(),
            url: this.sanitizeUrl(url),
            status,
            errorMessage,
            responseTime
        });
    }

    networkError(method: string, url: string, errorMessage: string, context?: LogContext): void {
        this.error(`Network error occurred`, undefined, {
            ...context,
            method: method.toUpperCase(),
            url: this.sanitizeUrl(url),
            errorMessage,
            errorCode: 'NETWORK_ERROR'
        });
    }

    authError(method: string, url: string, context?: LogContext): void {
        this.security(`Authentication failed`, {
            ...context,
            method: method.toUpperCase(),
            url: this.sanitizeUrl(url),
            errorCode: 'AUTH_REQUIRED'
        });
    }

    retryAttempt(method: string, url: string, attempt: number, maxAttempts: number, context?: LogContext): void {
        this.retry(`Retry attempt ${attempt}/${maxAttempts}`, {
            ...context,
            method: method.toUpperCase(),
            url: this.sanitizeUrl(url),
            retryCount: attempt
        });
    }

    private sanitizeUrl(url: string): string {
        // Remove sensitive information from URLs for logging
        try {
            const urlObj = new URL(url);
            // Remove query parameters that might contain sensitive data
            if (urlObj.searchParams.has('password') || urlObj.searchParams.has('token')) {
                urlObj.search = '';
            }
            return urlObj.toString();
        } catch {
            return url;
        }
    }
}

// Service-specific loggers
export const apiLogger = new FrontendLogger('API', '🌐', '#3b82f6');
export const authLogger = new FrontendLogger('AUTH', '🔐', '#dc2626');
export const sshLogger = new FrontendLogger('SSH', '🖥️', '#1e3a8a');
export const tunnelLogger = new FrontendLogger('TUNNEL', '📡', '#1e3a8a');
export const fileLogger = new FrontendLogger('FILE', '📁', '#1e3a8a');
export const statsLogger = new FrontendLogger('STATS', '📊', '#22c55e');
export const systemLogger = new FrontendLogger('SYSTEM', '🚀', '#1e3a8a');

// Default logger for general use
export const logger = systemLogger;
