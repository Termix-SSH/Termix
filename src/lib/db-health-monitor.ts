/**
 * DatabaseHealthMonitor
 *
 * Non-blocking health tracker for backend/database connectivity. The
 * monitor no longer gates the whole UI: there is no full-screen overlay.
 * When a transient failure is observed we emit a "degraded" event so the
 * UI can surface a persistent but non-intrusive toast. A success from any
 * API request clears the state. Session-expired events are also relayed
 * to the UI.
 *
 * The previous "database-connection-lost" / "database-connection-restored"
 * events have been retired along with the overlay. Listeners should use
 * "database-connection-degraded" / "database-connection-degraded-cleared"
 * to reflect the current UX contract: users can keep working regardless
 * of backend hiccups and are simply informed via a toast.
 */
type EventListener = (...args: unknown[]) => void;

interface HttpLikeError {
  message?: string;
  code?: string;
  response?: {
    data?: {
      error?: string;
      code?: string;
    };
  };
}

class DatabaseHealthMonitor {
  private static instance: DatabaseHealthMonitor;
  private listeners: Map<string, EventListener[]> = new Map();
  private degradedActive: boolean = false;

  private constructor() {}

  static getInstance(): DatabaseHealthMonitor {
    if (!DatabaseHealthMonitor.instance) {
      DatabaseHealthMonitor.instance = new DatabaseHealthMonitor();
    }
    return DatabaseHealthMonitor.instance;
  }

  on(event: string, listener: EventListener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(listener);
  }

  off(event: string, listener: EventListener): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      const index = eventListeners.indexOf(listener);
      if (index !== -1) {
        eventListeners.splice(index, 1);
      }
    }
  }

  private emit(event: string, ...args: unknown[]): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.forEach((listener) => listener(...args));
    }
  }

  reportSessionExpired() {
    this.emit("session-expired", { timestamp: Date.now() });
  }

  reportDatabaseError(error: unknown) {
    const errorLike = error as HttpLikeError;
    const errorMessage =
      errorLike.response?.data?.error || errorLike.message || "";
    const errorCode = errorLike.response?.data?.code || errorLike.code;
    const lowerMessage = errorMessage.toLowerCase();

    const isDatabaseError =
      lowerMessage.includes("database") ||
      lowerMessage.includes("sqlite") ||
      lowerMessage.includes("drizzle") ||
      errorCode === "DATABASE_ERROR" ||
      errorCode === "DB_CONNECTION_FAILED";

    const isBackendUnreachable =
      errorCode === "ERR_NETWORK" ||
      errorCode === "ECONNREFUSED" ||
      errorCode === "ECONNABORTED" ||
      errorCode === "ECONNRESET" ||
      errorCode === "ETIMEDOUT" ||
      errorCode === "ERR_CANCELED" ||
      (lowerMessage.includes("network error") &&
        errorLike.response === undefined) ||
      lowerMessage.includes("request aborted") ||
      lowerMessage.includes("timeout");

    if (!(isDatabaseError || isBackendUnreachable)) {
      return;
    }

    if (!this.degradedActive) {
      this.degradedActive = true;
      this.emit("database-connection-degraded", {
        error: errorMessage || "Background request failed",
        code: errorCode,
        timestamp: Date.now(),
      });
    }
  }

  reportDatabaseSuccess() {
    if (this.degradedActive) {
      this.degradedActive = false;
      this.emit("database-connection-degraded-cleared", {
        timestamp: Date.now(),
      });
    }
  }

  isDegraded(): boolean {
    return this.degradedActive;
  }

  reset() {
    this.degradedActive = false;
  }
}

export const dbHealthMonitor = DatabaseHealthMonitor.getInstance();
