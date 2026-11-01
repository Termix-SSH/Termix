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
  private probe: (() => Promise<boolean>) | null = null;
  private probing: Promise<void> | null = null;

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

    // A cancel is on purpose and says nothing about the backend.
    if (errorCode === "ERR_CANCELED" || lowerMessage === "canceled") return;

    const isBackendUnreachable =
      errorCode === "ERR_NETWORK" ||
      errorCode === "ECONNREFUSED" ||
      errorCode === "ECONNRESET" ||
      (lowerMessage.includes("network error") &&
        errorLike.response === undefined);

    // One slow request (like a plugin waiting on an SSH host) is not a lost
    // backend, so a timeout only counts when a quick check fails too.
    const isTimeout =
      errorCode === "ECONNABORTED" ||
      errorCode === "ETIMEDOUT" ||
      lowerMessage.includes("request aborted") ||
      lowerMessage.includes("timeout");

    if (isDatabaseError || isBackendUnreachable) {
      this.markDegraded(errorMessage, errorCode);
    } else if (isTimeout) {
      if (!this.probe) {
        this.markDegraded(errorMessage, errorCode);
        return;
      }
      this.probing ??= this.probe()
        .catch(() => false)
        .then((reachable) => {
          if (!reachable) this.markDegraded(errorMessage, errorCode);
        })
        .finally(() => {
          this.probing = null;
        });
    }
  }

  /** Sets the quick check used after a request times out. */
  setReachabilityProbe(probe: (() => Promise<boolean>) | null) {
    this.probe = probe;
  }

  private markDegraded(errorMessage: string, errorCode: string | undefined) {
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
