import chalk from "chalk";

export type LogLevel = "debug" | "info" | "warn" | "error" | "success";

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

const SENSITIVE_FIELDS = [
  "password",
  "passphrase",
  "key",
  "privateKey",
  "publicKey",
  "token",
  "secret",
  "clientSecret",
  "keyPassword",
  "autostartPassword",
  "autostartKey",
  "autostartKeyPassword",
  "credentialId",
  "authToken",
  "jwt",
  "session",
  "cookie",
];

const TRUNCATE_FIELDS = ["data", "content", "body", "response", "request"];

class Logger {
  private serviceName: string;
  private serviceIcon: string;
  private serviceColor: string;
  private logCounts = new Map<string, { count: number; lastLog: number }>();
  private readonly RATE_LIMIT_WINDOW = 60000;
  private readonly RATE_LIMIT_MAX = 10;

  constructor(serviceName: string, serviceIcon: string, serviceColor: string) {
    this.serviceName = serviceName;
    this.serviceIcon = serviceIcon;
    this.serviceColor = serviceColor;
  }

  private getTimeStamp(): string {
    return chalk.gray(`[${new Date().toLocaleTimeString()}]`);
  }

  private sanitizeContext(context: LogContext): LogContext {
    const sanitized = { ...context };

    for (const field of SENSITIVE_FIELDS) {
      if (sanitized[field] !== undefined) {
        if (
          typeof sanitized[field] === "string" &&
          sanitized[field].length > 0
        ) {
          sanitized[field] = "[MASKED]";
        } else if (typeof sanitized[field] === "boolean") {
          sanitized[field] = sanitized[field] ? "[PRESENT]" : "[ABSENT]";
        } else {
          sanitized[field] = "[MASKED]";
        }
      }
    }

    for (const field of TRUNCATE_FIELDS) {
      if (
        sanitized[field] &&
        typeof sanitized[field] === "string" &&
        sanitized[field].length > 100
      ) {
        sanitized[field] = sanitized[field].substring(0, 100) + "...";
      }
    }

    return sanitized;
  }

  private formatMessage(
    level: LogLevel,
    message: string,
    context?: LogContext,
  ): string {
    const timestamp = this.getTimeStamp();
    const levelColor = this.getLevelColor(level);
    const serviceTag = chalk.hex(this.serviceColor)(`[${this.serviceIcon}]`);
    const levelTag = levelColor(`[${level.toUpperCase()}]`);

    let contextStr = "";
    if (context) {
      const sanitizedContext = this.sanitizeContext(context);
      const contextParts = [];
      if (sanitizedContext.operation)
        contextParts.push(`op:${sanitizedContext.operation}`);
      if (sanitizedContext.userId)
        contextParts.push(`user:${sanitizedContext.userId}`);
      if (sanitizedContext.hostId)
        contextParts.push(`host:${sanitizedContext.hostId}`);
      if (sanitizedContext.tunnelName)
        contextParts.push(`tunnel:${sanitizedContext.tunnelName}`);
      if (sanitizedContext.sessionId)
        contextParts.push(`session:${sanitizedContext.sessionId}`);
      if (sanitizedContext.requestId)
        contextParts.push(`req:${sanitizedContext.requestId}`);
      if (sanitizedContext.duration)
        contextParts.push(`duration:${sanitizedContext.duration}ms`);

      if (contextParts.length > 0) {
        contextStr = chalk.gray(` [${contextParts.join(",")}]`);
      }
    }

    return `${timestamp} ${levelTag} ${serviceTag} ${message}${contextStr}`;
  }

  private getLevelColor(level: LogLevel): chalk.Chalk {
    switch (level) {
      case "debug":
        return chalk.magenta;
      case "info":
        return chalk.cyan;
      case "warn":
        return chalk.yellow;
      case "error":
        return chalk.redBright;
      case "success":
        return chalk.greenBright;
      default:
        return chalk.white;
    }
  }

  private shouldLog(level: LogLevel, message: string): boolean {
    if (level === "debug" && process.env.NODE_ENV === "production") {
      return false;
    }

    const now = Date.now();
    const logKey = `${level}:${message}`;
    const logInfo = this.logCounts.get(logKey);

    if (logInfo) {
      if (now - logInfo.lastLog < this.RATE_LIMIT_WINDOW) {
        logInfo.count++;
        if (logInfo.count > this.RATE_LIMIT_MAX) {
          return false;
        }
      } else {
        logInfo.count = 1;
        logInfo.lastLog = now;
      }
    } else {
      this.logCounts.set(logKey, { count: 1, lastLog: now });
    }

    return true;
  }

  debug(message: string, context?: LogContext): void {
    if (!this.shouldLog("debug", message)) return;
    console.debug(this.formatMessage("debug", message, context));
  }

  info(message: string, context?: LogContext): void {
    if (!this.shouldLog("info", message)) return;
    console.log(this.formatMessage("info", message, context));
  }

  warn(message: string, context?: LogContext): void {
    if (!this.shouldLog("warn", message)) return;
    console.warn(this.formatMessage("warn", message, context));
  }

  error(message: string, error?: unknown, context?: LogContext): void {
    if (!this.shouldLog("error", message)) return;
    console.error(this.formatMessage("error", message, context));
    if (error) {
      console.error(error);
    }
  }

  success(message: string, context?: LogContext): void {
    if (!this.shouldLog("success", message)) return;
    console.log(this.formatMessage("success", message, context));
  }

  auth(message: string, context?: LogContext): void {
    this.info(`AUTH: ${message}`, { ...context, operation: "auth" });
  }

  db(message: string, context?: LogContext): void {
    this.info(`DB: ${message}`, { ...context, operation: "database" });
  }

  ssh(message: string, context?: LogContext): void {
    this.info(`SSH: ${message}`, { ...context, operation: "ssh" });
  }

  tunnel(message: string, context?: LogContext): void {
    this.info(`TUNNEL: ${message}`, { ...context, operation: "tunnel" });
  }

  file(message: string, context?: LogContext): void {
    this.info(`FILE: ${message}`, { ...context, operation: "file" });
  }

  api(message: string, context?: LogContext): void {
    this.info(`API: ${message}`, { ...context, operation: "api" });
  }

  request(message: string, context?: LogContext): void {
    this.info(`REQUEST: ${message}`, { ...context, operation: "request" });
  }

  response(message: string, context?: LogContext): void {
    this.info(`RESPONSE: ${message}`, { ...context, operation: "response" });
  }

  connection(message: string, context?: LogContext): void {
    this.info(`CONNECTION: ${message}`, {
      ...context,
      operation: "connection",
    });
  }

  disconnect(message: string, context?: LogContext): void {
    this.info(`DISCONNECT: ${message}`, {
      ...context,
      operation: "disconnect",
    });
  }

  retry(message: string, context?: LogContext): void {
    this.warn(`RETRY: ${message}`, { ...context, operation: "retry" });
  }
}

export const databaseLogger = new Logger("DATABASE", "🗄️", "#6366f1");
export const sshLogger = new Logger("SSH", "🖥️", "#0ea5e9");
export const tunnelLogger = new Logger("TUNNEL", "📡", "#a855f7");
export const fileLogger = new Logger("FILE", "📁", "#f59e0b");
export const statsLogger = new Logger("STATS", "📊", "#22c55e");
export const apiLogger = new Logger("API", "🌐", "#3b82f6");
export const authLogger = new Logger("AUTH", "🔐", "#ef4444");
export const systemLogger = new Logger("SYSTEM", "🚀", "#14b8a6");
export const versionLogger = new Logger("VERSION", "📦", "#8b5cf6");

export const logger = systemLogger;
