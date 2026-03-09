type EventListener = (...args: any[]) => void;

class DatabaseHealthMonitor {
  private static instance: DatabaseHealthMonitor;
  private dbHealthy: boolean = true;
  private lastCheckTime: number = 0;
  private checkInProgress: boolean = false;
  private listeners: Map<string, EventListener[]> = new Map();
  private consecutiveErrorTimer: ReturnType<typeof setTimeout> | null = null;
  private confirmedUnhealthy: boolean = false;

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

  private emit(event: string, ...args: any[]): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.forEach((listener) => listener(...args));
    }
  }

  reportSessionExpired() {
    this.emit("session-expired", { timestamp: Date.now() });
  }

  reportDatabaseError(error: any, _wasAuthenticated: boolean = false) {
    const errorMessage = error?.response?.data?.error || error?.message || "";
    const errorCode = error?.response?.data?.code || error?.code;

    const isDatabaseError =
      errorMessage.toLowerCase().includes("database") ||
      errorMessage.toLowerCase().includes("sqlite") ||
      errorMessage.toLowerCase().includes("drizzle") ||
      errorCode === "DATABASE_ERROR" ||
      errorCode === "DB_CONNECTION_FAILED";

    const isBackendUnreachable =
      errorCode === "ERR_NETWORK" ||
      errorCode === "ECONNREFUSED" ||
      (errorMessage.toLowerCase().includes("network error") &&
        error?.response === undefined);

    if (!(isDatabaseError || isBackendUnreachable)) {
      return;
    }

    if (this.dbHealthy && !this.consecutiveErrorTimer) {
      this.consecutiveErrorTimer = setTimeout(() => {
        this.consecutiveErrorTimer = null;
        if (this.dbHealthy) {
          this.dbHealthy = false;
          this.confirmedUnhealthy = true;
          this.emit("database-connection-lost", {
            error: errorMessage || "Backend server unreachable",
            code: errorCode,
            timestamp: Date.now(),
          });
        }
      }, 10000);
    }
  }

  reportDatabaseSuccess() {
    this.clearErrorTimer();

    if (this.confirmedUnhealthy) {
      this.dbHealthy = true;
      this.confirmedUnhealthy = false;
      this.emit("database-connection-restored", {
        timestamp: Date.now(),
      });
    } else if (!this.dbHealthy) {
      this.dbHealthy = true;
    }
  }

  private clearErrorTimer(): void {
    if (this.consecutiveErrorTimer !== null) {
      clearTimeout(this.consecutiveErrorTimer);
      this.consecutiveErrorTimer = null;
    }
  }

  isDatabaseHealthy(): boolean {
    return this.dbHealthy;
  }

  reset() {
    this.dbHealthy = true;
    this.confirmedUnhealthy = false;
    this.lastCheckTime = 0;
    this.checkInProgress = false;
    this.clearErrorTimer();
  }
}

export const dbHealthMonitor = DatabaseHealthMonitor.getInstance();
