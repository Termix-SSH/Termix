import axios, { AxiosError, type AxiosInstance } from "axios";
import { toast } from "sonner";
import { getBasePath } from "@/lib/base-path";
import { isElectron } from "@/lib/electron";
import { clearTermixSessionStorage } from "@/shell/TabContext";
import type { SSHHost } from "@/types/index";

// ============================================================================
// RBAC TYPE DEFINITIONS
// ============================================================================

export interface Role {
  id: number;
  name: string;
  displayName: string;
  description: string | null;
  isSystem: boolean;
  permissions: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserRole {
  userId: string;
  roleId: number;
  roleName: string;
  roleDisplayName: string;
  grantedBy: string;
  grantedByUsername: string;
  grantedAt: string;
}

export interface AccessRecord {
  id: number;
  targetType: "user" | "role";
  userId: string | null;
  roleId: number | null;
  username: string | null;
  roleName: string | null;
  roleDisplayName: string | null;
  grantedBy: string;
  grantedByUsername: string;
  permissionLevel: "view";
  expiresAt: string | null;
  createdAt: string;
}
import {
  apiLogger,
  authLogger,
  sshLogger,
  tunnelLogger,
  fileLogger,
  statsLogger,
  systemLogger,
  dashboardLogger,
  type LogContext,
} from "@/lib/frontend-logger";
import { dbHealthMonitor } from "@/lib/db-health-monitor";

export type ServerStatus = {
  status: "online" | "offline";
  lastChecked: string;
};

export type SSHHostWithStatus = SSHHost & {
  status: "online" | "offline" | "unknown";
};

interface CpuMetrics {
  percent: number | null;
  cores: number | null;
  load: [number, number, number] | null;
}

interface MemoryMetrics {
  percent: number | null;
  usedGiB: number | null;
  totalGiB: number | null;
}

interface DiskMetrics {
  percent: number | null;
  usedHuman: string | null;
  totalHuman: string | null;
  availableHuman?: string | null;
}

export interface NetworkInterface {
  name: string;
  ip: string;
  state: string;
  rx?: string | null;
  tx?: string | null;
  rxBytes?: string | null;
  txBytes?: string | null;
}

export interface ProcessInfo {
  pid: string;
  user: string;
  cpu: string;
  mem: string;
  command: string;
}

export interface LoginRecord {
  user: string;
  ip: string;
  time: string;
  status: "success" | "failed";
}

export interface ListeningPort {
  protocol: "tcp" | "udp";
  localAddress: string;
  localPort: number;
  state?: string;
  pid?: number;
  process?: string;
}

export interface FirewallRule {
  chain: string;
  target: string;
  protocol: string;
  source: string;
  destination: string;
  dport?: string;
  sport?: string;
  state?: string;
  interface?: string;
  extra?: string;
}

export interface FirewallChain {
  name: string;
  policy: string;
  rules: FirewallRule[];
}

export type ServerMetrics = {
  cpu: CpuMetrics;
  memory: MemoryMetrics;
  disk: DiskMetrics;
  network?: { interfaces?: NetworkInterface[] };
  uptime?: { seconds?: number | null; formatted?: string | null };
  system?: {
    hostname?: string | null;
    os?: string | null;
    kernel?: string | null;
    arch?: string | null;
  };
  processes?: {
    total?: number | null;
    running?: number | null;
    top?: ProcessInfo[];
  };
  login_stats?: {
    recentLogins?: LoginRecord[];
    failedLogins?: LoginRecord[];
    totalLogins?: number;
    uniqueIPs?: number;
  };
  ports?: {
    source?: "ss" | "netstat" | "none";
    ports?: ListeningPort[];
  };
  firewall?: {
    type?: "iptables" | "nftables" | "none";
    status?: "active" | "inactive" | "unknown";
    chains?: FirewallChain[];
  };
  lastChecked: string;
};

export interface AuthResponse {
  success?: boolean;
  is_admin?: boolean;
  username?: string;
  userId?: string;
  is_oidc?: boolean;
  totp_enabled?: boolean;
  data_unlocked?: boolean;
  requires_totp?: boolean;
  temp_token?: string;
  rememberMe?: boolean;
  token?: string;
}

export interface UserInfo {
  totp_enabled: boolean;
  userId: string;
  username: string;
  is_admin: boolean;
  is_oidc: boolean;
  data_unlocked: boolean;
  password_hash?: string;
}

interface UserCount {
  count: number;
}

interface OIDCAuthorize {
  auth_url: string;
}

type ElectronApi = {
  isElectron?: boolean;
  getSetting?: (key: string) => Promise<string | null | undefined>;
  setSetting?: (key: string, value: string) => Promise<void>;
};

type ElectronWindow = Window &
  typeof globalThis & {
    IS_ELECTRON?: boolean;
    electronAPI?: ElectronApi;
    ReactNativeWebView?: unknown;
  };

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export { isElectron };

function getLoggerForService(serviceName: string) {
  if (serviceName.includes("SSH") || serviceName.includes("ssh")) {
    return sshLogger;
  } else if (serviceName.includes("TUNNEL") || serviceName.includes("tunnel")) {
    return tunnelLogger;
  } else if (serviceName.includes("FILE") || serviceName.includes("file")) {
    return fileLogger;
  } else if (serviceName.includes("STATS") || serviceName.includes("stats")) {
    return statsLogger;
  } else if (serviceName.includes("AUTH") || serviceName.includes("auth")) {
    return authLogger;
  } else if (
    serviceName.includes("DASHBOARD") ||
    serviceName.includes("dashboard")
  ) {
    return dashboardLogger;
  } else {
    return apiLogger;
  }
}

const electronSettingsCache = new Map<string, string>();

if (isElectron()) {
  (async () => {
    try {
      const electronAPI = (window as ElectronWindow).electronAPI;

      if (electronAPI?.getSetting) {
        const settingsToLoad = ["rightClickCopyPaste"];
        for (const key of settingsToLoad) {
          const value = await electronAPI.getSetting(key);
          if (value !== null && value !== undefined) {
            // Only populate if not already set to prevent overwriting new values during login
            if (!localStorage.getItem(key)) {
              electronSettingsCache.set(key, value);
              localStorage.setItem(key, value);
              console.log(`[Electron] Loaded setting ${key} from main process`);
            } else {
              // Even if we don't overwrite localStorage, update the cache
              electronSettingsCache.set(key, localStorage.getItem(key)!);
            }
          }
        }
      }
    } catch (error) {
      console.error("[Electron] Failed to load settings cache:", error);
    }
  })();
}

export function setCookie(
  name: string,
  value: string,
  days = 7,
): void | Promise<void> {
  if (isElectron()) {
    try {
      if (name === "jwt") {
        return;
      }

      const electronAPI = (window as ElectronWindow).electronAPI;

      if (electronAPI?.setSetting) {
        electronSettingsCache.set(name, value);
        localStorage.setItem(name, value);
        electronAPI.setSetting(name, value).catch((err: Error) => {
          console.error(`[Electron] Failed to persist setting ${name}:`, err);
        });
      }

      console.log(`[Electron] Set setting: ${name}`);
    } catch (error) {
      console.error(`[Electron] Failed to set setting: ${name}`, error);
    }
  } else {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
  }
}

export function getCookie(name: string): string | undefined {
  if (isElectron()) {
    try {
      if (name === "jwt") {
        return undefined;
      }

      if (electronSettingsCache.has(name)) {
        return electronSettingsCache.get(name);
      }

      const token = localStorage.getItem(name) || undefined;
      if (token) {
        electronSettingsCache.set(name, token);
      }
      console.log(`[Electron] Get setting: ${name} = ${token}`);
      return token;
    } catch (error) {
      console.error(`[Electron] Failed to get setting: ${name}`, error);
      return undefined;
    }
  } else {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    const encodedToken =
      parts.length === 2 ? parts.pop()?.split(";").shift() : undefined;
    const token = encodedToken ? decodeURIComponent(encodedToken) : undefined;
    return token;
  }
}

let userWasAuthenticated = false;
let latestAuthSuccessAt = 0;

export function markUserAuthenticated(): void {
  userWasAuthenticated = true;
  latestAuthSuccessAt =
    typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function isCurrentAuthInvalidationError(error: unknown): boolean {
  const authError = error as {
    __staleAuthInvalidation?: boolean;
  };

  if (authError.__staleAuthInvalidation) {
    return false;
  }

  const axiosError = error as AxiosError;
  const apiError = error as ApiError;
  const responseData = axiosError.response?.data as
    | Record<string, unknown>
    | undefined;
  const errorCode = responseData?.code || apiError.code;
  const errorMessage = responseData?.error || apiError.message;
  const status = axiosError.response?.status || apiError.status;
  const isMissingAuthenticationToken =
    errorMessage === "Missing authentication token";

  return (
    status === 401 &&
    (errorCode === "SESSION_EXPIRED" ||
      errorCode === "SESSION_NOT_FOUND" ||
      (errorCode === "AUTH_REQUIRED" && userWasAuthenticated) ||
      errorMessage === "Invalid token" ||
      (errorMessage === "Authentication required" && userWasAuthenticated) ||
      (isMissingAuthenticationToken && userWasAuthenticated))
  );
}

function createApiInstance(
  baseURL: string,
  serviceName: string = "API",
): AxiosInstance {
  const instance = axios.create({
    baseURL,
    headers: { "Content-Type": "application/json" },
    timeout: 30000,
    withCredentials: true,
  });

  instance.interceptors.request.use((config: AxiosRequestConfig) => {
    const startTime = performance.now();
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const configWithMetadata = config as AxiosRequestConfigExtended;
    configWithMetadata.startTime = startTime;
    configWithMetadata.requestId = requestId;

    const method = config.method?.toUpperCase() || "UNKNOWN";
    const url = config.url || "UNKNOWN";
    const fullUrl = `${config.baseURL}${url}`;

    const context: LogContext = {
      requestId,
      method,
      url: fullUrl,
      operation: "request_start",
    };

    const logger = getLoggerForService(serviceName);

    const isDevMode = process.env.NODE_ENV === "development";

    if (isDevMode) {
      logger.requestStart(method, fullUrl, context);
    }

    if (isElectron()) {
      if (config.headers.set) {
        config.headers.set("X-Electron-App", "true");
      } else {
        config.headers["X-Electron-App"] = "true";
      }
      const jwt = localStorage.getItem("jwt");
      if (jwt) {
        if (config.headers.set) {
          config.headers.set("Authorization", `Bearer ${jwt}`);
        } else {
          config.headers["Authorization"] = `Bearer ${jwt}`;
        }
      }
    }

    if (
      typeof window !== "undefined" &&
      (window as ElectronWindow).ReactNativeWebView
    ) {
      let platform = "Unknown";
      if (typeof navigator !== "undefined" && navigator.userAgent) {
        if (navigator.userAgent.includes("Android")) {
          platform = "Android";
        } else if (
          navigator.userAgent.includes("iPhone") ||
          navigator.userAgent.includes("iPad") ||
          navigator.userAgent.includes("iOS")
        ) {
          platform = "iOS";
        }
      }
      if (config.headers.set) {
        config.headers.set("User-Agent", `Termix-Mobile/${platform}`);
      } else {
        config.headers["User-Agent"] = `Termix-Mobile/${platform}`;
      }
    }

    return config;
  });

  instance.interceptors.response.use(
    (response: AxiosResponse) => {
      const endTime = performance.now();
      const responseConfig = response.config as AxiosRequestConfigExtended;
      const startTime = responseConfig.startTime;
      const requestId = responseConfig.requestId;
      const responseTime = Math.round(endTime - (startTime || endTime));

      const method = response.config.method?.toUpperCase() || "UNKNOWN";
      const url = response.config.url || "UNKNOWN";
      const fullUrl = `${response.config.baseURL}${url}`;

      const context: LogContext = {
        requestId,
        method,
        url: fullUrl,
        status: response.status,
        statusText: response.statusText,
        responseTime,
        operation: "request_success",
      };

      const logger = getLoggerForService(serviceName);

      if (process.env.NODE_ENV === "development") {
        logger.requestSuccess(
          method,
          fullUrl,
          response.status,
          responseTime,
          context,
        );
      }

      if (responseTime > 3000) {
        logger.warn(`🐌 Slow request: ${responseTime}ms`, context);
      }

      dbHealthMonitor.reportDatabaseSuccess();

      return response;
    },
    (error: AxiosErrorExtended) => {
      const endTime = performance.now();
      const startTime = error.config?.startTime;
      const requestId = error.config?.requestId;
      const responseTime = startTime
        ? Math.round(endTime - startTime)
        : undefined;

      const method = error.config?.method?.toUpperCase() || "UNKNOWN";
      const url = error.config?.url || "UNKNOWN";
      const fullUrl = error.config ? `${error.config.baseURL}${url}` : url;
      const status = error.response?.status;
      const message =
        (error.response?.data as { error?: string })?.error ||
        (error as Error).message ||
        "Unknown error";
      const errorCode =
        (error.response?.data as { code?: string })?.code || error.code;

      const context: LogContext = {
        requestId,
        method,
        url: fullUrl,
        status,
        responseTime,
        errorCode,
        errorMessage: message,
        operation: "request_error",
      };

      const logger = getLoggerForService(serviceName);
      // A caller can mark a request as a silent retry (see progressive /status
      // retry) so we don't spam error logs / health events on each attempt.
      const isSilentRetry = !!error.config?.__silentRetry;

      if (process.env.NODE_ENV === "development" && !isSilentRetry) {
        if (status === 401) {
          logger.authError(method, fullUrl, context);
        } else if (status === 0 || !status) {
          logger.networkError(method, fullUrl, message, context);
        } else {
          logger.requestError(
            method,
            fullUrl,
            status || 0,
            message,
            responseTime,
            context,
          );
        }
      }

      if (status === 401) {
        const errorCode = (error.response?.data as Record<string, unknown>)
          ?.code;
        const errorMessage = (error.response?.data as Record<string, unknown>)
          ?.error;
        const isSessionExpired = errorCode === "SESSION_EXPIRED";
        const isSessionNotFound = errorCode === "SESSION_NOT_FOUND";
        const isMissingAuthenticationToken =
          errorMessage === "Missing authentication token";
        const isInvalidToken =
          errorCode === "AUTH_REQUIRED" ||
          errorMessage === "Invalid token" ||
          errorMessage === "Authentication required" ||
          (isMissingAuthenticationToken && userWasAuthenticated);

        if (isSessionExpired || isSessionNotFound || isInvalidToken) {
          const requestStartedAt =
            typeof error.config?.startTime === "number"
              ? error.config.startTime
              : 0;
          const isStaleAuthInvalidation =
            latestAuthSuccessAt > 0 &&
            requestStartedAt > 0 &&
            requestStartedAt < latestAuthSuccessAt;

          if (isStaleAuthInvalidation) {
            (
              error as { __staleAuthInvalidation?: boolean }
            ).__staleAuthInvalidation = true;
            return Promise.reject(error);
          }

          if (isElectron()) {
            const electronAPI = (
              window as unknown as {
                electronAPI?: { clearSessionCookies?: () => Promise<void> };
              }
            ).electronAPI;
            electronAPI?.clearSessionCookies?.().catch(() => {});
          }

          if (typeof window !== "undefined") {
            document.cookie =
              "jwt=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
          }

          if (isSessionExpired && typeof window !== "undefined") {
            console.warn("Session expired - please log in again");
            toast.warning("Session expired. Please log in again.");
          }

          dbHealthMonitor.reportSessionExpired();

          userWasAuthenticated = false;
        }
      } else if (!isSilentRetry) {
        const wasAuthenticated = userWasAuthenticated;
        dbHealthMonitor.reportDatabaseError(error, wasAuthenticated);
      }

      return Promise.reject(error);
    },
  );

  return instance;
}

// ============================================================================
// API INSTANCES
// ============================================================================

function isDev(): boolean {
  if (isElectron()) {
    return false;
  }

  return (
    process.env.NODE_ENV === "development" &&
    (window.location.port === "3000" ||
      window.location.port === "5173" ||
      window.location.port === "" ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1")
  );
}

const apiHost = import.meta.env.VITE_API_HOST || "localhost";
let configuredServerUrl: string | null = null;
let embeddedMode = false;

export interface ServerConfig {
  serverUrl: string;
  lastUpdated: string;
  allowInvalidCertificate?: boolean;
}

interface AxiosRequestConfigExtended extends AxiosRequestConfig {
  startTime?: number;
  requestId?: string;
  __silentRetry?: boolean;
}

interface AxiosErrorExtended extends AxiosError {
  config?: AxiosRequestConfigExtended;
}

export async function getServerConfig(): Promise<ServerConfig | null> {
  if (!isElectron()) return null;

  try {
    const result = await (
      window as Window &
        typeof globalThis & {
          IS_ELECTRON?: boolean;
          electronAPI?: unknown;
          configuredServerUrl?: string;
        }
    ).electronAPI?.invoke("get-server-config");
    return result;
  } catch (error) {
    console.error("Failed to get server config:", error);
    return null;
  }
}

export async function saveServerConfig(config: ServerConfig): Promise<boolean> {
  if (!isElectron()) return false;

  try {
    const result = await (
      window as Window &
        typeof globalThis & {
          IS_ELECTRON?: boolean;
          electronAPI?: unknown;
          configuredServerUrl?: string;
        }
    ).electronAPI?.invoke("save-server-config", config);
    if (result?.success) {
      configuredServerUrl = config.serverUrl;
      (
        window as Window &
          typeof globalThis & {
            IS_ELECTRON?: boolean;
            electronAPI?: unknown;
            configuredServerUrl?: string;
          }
      ).configuredServerUrl = configuredServerUrl;
      updateApiInstances();
      return true;
    }
    return false;
  } catch (error) {
    console.error("Failed to save server config:", error);
    return false;
  }
}

export function getConfiguredServerUrl(): string | null {
  return configuredServerUrl;
}

export async function testServerConnection(
  serverUrl: string,
): Promise<{ success: boolean; error?: string }> {
  if (!isElectron())
    return { success: false, error: "Not in Electron environment" };

  try {
    const result = await (
      window as Window &
        typeof globalThis & {
          IS_ELECTRON?: boolean;
          electronAPI?: unknown;
          configuredServerUrl?: string;
        }
    ).electronAPI?.invoke("test-server-connection", serverUrl);
    return result;
  } catch (error) {
    console.error("Failed to test server connection:", error);
    return { success: false, error: "Connection test failed" };
  }
}

export async function checkElectronUpdate(): Promise<{
  success: boolean;
  status?: "up_to_date" | "requires_update" | "beta";
  localVersion?: string;
  remoteVersion?: string;
  latest_release?: {
    tag_name: string;
    name: string;
    published_at: string;
    html_url: string;
    body: string;
  };
  cached?: boolean;
  cache_age?: number;
  error?: string;
}> {
  if (!isElectron())
    return { success: false, error: "Not in Electron environment" };

  try {
    const result = await (
      window as Window &
        typeof globalThis & {
          IS_ELECTRON?: boolean;
          electronAPI?: unknown;
          configuredServerUrl?: string;
        }
    ).electronAPI?.invoke("check-electron-update");
    return result;
  } catch (error) {
    console.error("Failed to check Electron update:", error);
    return { success: false, error: "Update check failed" };
  }
}

export async function getEmbeddedServerStatus(): Promise<{
  running: boolean;
  embedded: boolean;
  dataDir: string | null;
} | null> {
  if (!isElectron()) return null;

  try {
    const result = await (
      window as Window &
        typeof globalThis & {
          IS_ELECTRON?: boolean;
          electronAPI?: {
            invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
          };
        }
    ).electronAPI?.invoke("get-embedded-server-status");
    return result as {
      running: boolean;
      embedded: boolean;
      dataDir: string | null;
    } | null;
  } catch {
    return null;
  }
}

export function isEmbeddedMode(): boolean {
  return embeddedMode;
}

export function setEmbeddedMode(value: boolean): void {
  embeddedMode = value;
  if (value) {
    configuredServerUrl = null;
    initializeApiInstances();
  }
}

function getApiUrl(path: string, defaultPort: number): string {
  const devMode = isDev();
  const electronMode = isElectron();

  if (electronMode) {
    if (embeddedMode && !configuredServerUrl) {
      return `http://localhost:${defaultPort}${path}`;
    }
    if (configuredServerUrl) {
      const baseUrl = configuredServerUrl.replace(/\/$/, "");
      const url = `${baseUrl}${path}`;
      return url;
    }
    console.warn("Electron mode but no server configured!");
    return "http://no-server-configured";
  } else if (devMode) {
    const protocol = window.location.protocol === "https:" ? "https" : "http";
    const sslPort = protocol === "https" ? 8443 : defaultPort;
    const url = `${protocol}://${apiHost}:${sslPort}${path}`;
    return url;
  } else {
    return getBasePath() + path;
  }
}

function initializeApiInstances() {
  // Host Management API (port 30001) - supports SSH, RDP, VNC, Telnet
  hostApi = createApiInstance(getApiUrl("/host", 30001), "HOST");
  sshHostApi = hostApi;

  // Tunnel Management API (port 30003)
  tunnelApi = createApiInstance(getApiUrl("/ssh", 30003), "TUNNEL");

  // File Manager Operations API (port 30004)
  fileManagerApi = createApiInstance(
    getApiUrl("/ssh/file_manager", 30004),
    "FILE_MANAGER",
  );

  // Server Statistics API (port 30005)
  statsApi = createApiInstance(getApiUrl("", 30005), "STATS");

  // Authentication API (port 30001)
  authApi = createApiInstance(getApiUrl("", 30001), "AUTH");

  // Dashboard API (port 30006)
  dashboardApi = createApiInstance(getApiUrl("", 30006), "DASHBOARD");

  // RBAC API (port 30001)
  rbacApi = createApiInstance(getApiUrl("", 30001), "RBAC");

  // Docker Management API (port 30007)
  dockerApi = createApiInstance(getApiUrl("/docker", 30007), "DOCKER");

  // Tmux Monitor API (port 30010) --- tmux-monitor ---
  tmuxMonitorApi = createApiInstance(
    getApiUrl("/tmux_monitor", 30010),
    "TMUX_MONITOR",
  );
}

// Host Management API (port 30001) - supports SSH, RDP, VNC, Telnet
export let hostApi: AxiosInstance;
// Backward compatibility
export let sshHostApi: AxiosInstance;

// Tunnel Management API (port 30003)
export let tunnelApi: AxiosInstance;

// File Manager Operations API (port 30004)
export let fileManagerApi: AxiosInstance;

// Server Statistics API (port 30005)
export let statsApi: AxiosInstance;

// Authentication API (port 30001)
export let authApi: AxiosInstance;

// Dashboard API (port 30006)
export let dashboardApi: AxiosInstance;

// RBAC API (port 30001)
export let rbacApi: AxiosInstance;

// Docker Management API (port 30007)
export let dockerApi: AxiosInstance;

// Tmux Monitor API (port 30010) --- tmux-monitor ---
export let tmuxMonitorApi: AxiosInstance;

// Pre-initialize with default values to avoid undefined errors during early mounting
initializeApiInstances();

let _resolveAppReady!: () => void;
export const appReadyPromise: Promise<void> = new Promise((resolve) => {
  _resolveAppReady = resolve;
});

function initializeApp() {
  if (isElectron()) {
    Promise.all([getServerConfig(), getEmbeddedServerStatus()])
      .then(([config, status]) => {
        if (status?.embedded && status?.running && !config?.serverUrl) {
          embeddedMode = true;
        }
        if (config?.serverUrl) {
          configuredServerUrl = config.serverUrl;
          (
            window as Window &
              typeof globalThis & {
                IS_ELECTRON?: boolean;
                electronAPI?: unknown;
                configuredServerUrl?: string;
              }
          ).configuredServerUrl = configuredServerUrl;
        } else if (embeddedMode) {
          // Embedded backend running, no remote server needed
        } else {
          console.warn("No server URL in config");
        }
        initializeApiInstances();
      })
      .catch((error) => {
        console.error(
          "Failed to load server config, initializing with default:",
          error,
        );
        initializeApiInstances();
      })
      .finally(() => {
        _resolveAppReady();
      });
  } else {
    initializeApiInstances();
    _resolveAppReady();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeApp);
} else {
  initializeApp();
}

function updateApiInstances() {
  systemLogger.info("Updating API instances with new server configuration", {
    operation: "api_instance_update",
    configuredServerUrl,
  });

  initializeApiInstances();

  (
    window as Window &
      typeof globalThis & {
        IS_ELECTRON?: boolean;
        electronAPI?: unknown;
        configuredServerUrl?: string;
      }
  ).configuredServerUrl = configuredServerUrl;

  systemLogger.success("All API instances updated successfully", {
    operation: "api_instance_update_complete",
    configuredServerUrl,
  });
}

// ============================================================================
// ERROR HANDLING
// ============================================================================

class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function handleApiError(error: unknown, operation: string): never {
  const context: LogContext = {
    operation: "error_handling",
    errorOperation: operation,
  };

  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const message =
      error.response?.data?.message ||
      error.response?.data?.error ||
      error.message;
    const code = error.response?.data?.code || error.response?.data?.error;
    const url = error.config?.url;
    const method = error.config?.method?.toUpperCase();

    const errorContext: LogContext = {
      ...context,
      method,
      url,
      status,
      errorCode: code,
      errorMessage: message,
    };

    if (status === 401) {
      authLogger.warn(
        `Auth failed: ${method} ${url} - ${message}`,
        errorContext,
      );

      const isLoginEndpoint = url?.includes("/users/login");
      const errorMessage = isLoginEndpoint
        ? message
        : "Authentication required. Please log in again.";

      throw new ApiError(errorMessage, 401, code || "AUTH_REQUIRED");
    } else if (status === 403) {
      authLogger.warn(`Access denied: ${method} ${url}`, errorContext);
      const apiError = new ApiError(
        code === "TOTP_REQUIRED"
          ? message
          : "Access denied. You do not have permission to perform this action.",
        403,
        code || "ACCESS_DENIED",
      );
      (apiError as ApiError & { response?: unknown }).response = error.response;
      throw apiError;
    } else if (status === 404) {
      apiLogger.warn(`Not found: ${method} ${url}`, errorContext);
      throw new ApiError(
        "Resource not found. The requested item may have been deleted.",
        404,
        "NOT_FOUND",
      );
    } else if (status === 409) {
      apiLogger.warn(`Conflict: ${method} ${url}`, errorContext);
      throw new ApiError(
        "Conflict. The resource already exists or is in use.",
        409,
        "CONFLICT",
      );
    } else if (status === 422) {
      apiLogger.warn(
        `Validation error: ${method} ${url} - ${message}`,
        errorContext,
      );
      throw new ApiError(
        "Validation error. Please check your input and try again.",
        422,
        "VALIDATION_ERROR",
      );
    } else if (status && status >= 500) {
      apiLogger.error(
        `Server error: ${method} ${url} - ${message}`,
        error,
        errorContext,
      );
      throw new ApiError(
        "Server error occurred. Please try again later.",
        status,
        "SERVER_ERROR",
      );
    } else if (status === 0) {
      if (url.includes("no-server-configured")) {
        apiLogger.error(
          `No server configured: ${method} ${url}`,
          error,
          errorContext,
        );
        throw new ApiError(
          "No server configured. Please configure a Termix server first.",
          0,
          "NO_SERVER_CONFIGURED",
        );
      }
      apiLogger.error(
        `Network error: ${method} ${url} - ${message}`,
        error,
        errorContext,
      );
      throw new ApiError(
        "Network error. Please check your connection and try again.",
        0,
        "NETWORK_ERROR",
      );
    } else {
      apiLogger.error(
        `Request failed: ${method} ${url} - ${message}`,
        error,
        errorContext,
      );
      throw new ApiError(message || `Failed to ${operation}`, status, code);
    }
  }

  if (error instanceof ApiError) {
    throw error;
  }

  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  apiLogger.error(
    `Unexpected error during ${operation}: ${errorMessage}`,
    error,
    context,
  );
  throw new ApiError(
    `Unexpected error during ${operation}: ${errorMessage}`,
    undefined,
    "UNKNOWN_ERROR",
  );
}

// ============================================================================

// ============================================================================
// HOST-TO-HOST TRANSFER
// ============================================================================

export type TransferMethodPreference = "auto" | "tar" | "item_sftp";

export interface TransferScanSummary {
  fileCount: number;
  totalBytes: number;
  largestFileBytes: number;
  incompressibleRatio: number;
}

export interface TransferMethodPreview {
  methodPreference: TransferMethodPreference;
  resolvedMethod: "tar" | "item_sftp";
  reasonKey: string;
  sourcePlatform: "unix" | "windows";
  destPlatform: "unix" | "windows";
  sourceHasTar: boolean;
  destHasTar: boolean;
  summary: TransferScanSummary;
}

export async function getTransferMethodPreview(
  sourceSessionId: string,
  sourcePaths: string[],
  destSessionId: string,
  destPath: string,
  methodPreference?: TransferMethodPreference,
): Promise<TransferMethodPreview> {
  try {
    const response = await fileManagerApi.post("/ssh/transferMethodPreview", {
      sourceSessionId,
      sourcePaths,
      destSessionId,
      destPath,
      methodPreference: methodPreference ?? "auto",
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "preview transfer method");
    throw error;
  }
}

export interface TransferHopMetrics {
  id: string;
  mbPerSec?: number;
}

export interface TransferTimings {
  prepareDestMs?: number;
  compressMs?: number;
  transferMs?: number;
  extractMs?: number;
  sourceDeleteMs?: number;
  totalMs?: number;
  transferBytes?: number;
  endToEndMbPerSec?: number;
  hops?: TransferHopMetrics[];
}

export function getTransferProgressPercent(
  status: TransferProgressResponse,
): number | undefined {
  if (
    status.bytesTransferred !== undefined &&
    status.totalBytes !== undefined &&
    status.totalBytes > 0
  ) {
    return Math.min(
      100,
      Math.round((status.bytesTransferred / status.totalBytes) * 100),
    );
  }
  if (
    status.itemsCompleted !== undefined &&
    status.totalItems !== undefined &&
    status.totalItems > 0
  ) {
    return Math.min(
      100,
      Math.round((status.itemsCompleted / status.totalItems) * 100),
    );
  }
  return undefined;
}

export function formatTransferMbPerSec(
  mbPerSec?: number,
  _bytes?: number,
  _ms?: number,
): string {
  if (mbPerSec === undefined || mbPerSec <= 0) return "";
  if (mbPerSec < 1) return `${(mbPerSec * 1024).toFixed(0)} KB/s`;
  return `${mbPerSec.toFixed(1)} MB/s`;
}

export function formatDurationMs(ms?: number): string {
  if (ms === undefined) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

interface TransferProgressTracker {
  update(status: TransferProgressResponse): {
    rate: number | undefined;
    stalled: boolean;
  };
}

export function createTransferProgressTracker(): TransferProgressTracker {
  let lastBytes: number | undefined;
  let lastTime: number | undefined;
  let lastRate: number | undefined;
  let lastActivityTime: number | undefined;
  const STALL_THRESHOLD_MS = 5000;

  return {
    update(status) {
      const now = Date.now();
      const bytes = status.bytesTransferred;

      if (
        bytes !== undefined &&
        lastBytes !== undefined &&
        lastTime !== undefined
      ) {
        const deltaBytes = bytes - lastBytes;
        const deltaMs = now - lastTime;
        if (deltaMs > 0 && deltaBytes >= 0) {
          lastRate = (deltaBytes / deltaMs / 1024 / 1024) * 1000;
          if (deltaBytes > 0) lastActivityTime = now;
        }
      } else if (bytes !== undefined) {
        lastActivityTime = now;
      }

      lastBytes = bytes;
      lastTime = now;

      const stalled =
        lastActivityTime !== undefined &&
        now - lastActivityTime > STALL_THRESHOLD_MS &&
        status.status === "running" &&
        status.phase === "transferring";

      return { rate: lastRate, stalled };
    },
  };
}

export interface TransferProgressResponse {
  transferId: string;
  status: "running" | "success" | "partial" | "error" | "cancelled";
  phase: "compressing" | "transferring" | "extracting" | "reconnecting";
  bytesTransferred?: number;
  totalBytes?: number;
  itemsCompleted?: number;
  totalItems?: number;
  failedPaths?: string[];
  message?: string;
  method?: "stream" | "tar" | "item_sftp";
  sourcePaths?: string[];
  destPath?: string;
  sourceSessionId?: string;
  destSessionId?: string;
  startedAt?: number;
  timings?: TransferTimings;
  sourceDeleted?: boolean;
  moveRequested?: boolean;
  partialDestRemaining?: boolean;
  cleanupCompleted?: boolean;
  retryable?: boolean;
  parallelSegmentCount?: number;
}

export async function transferToHost(
  sourceSessionId: string,
  sourcePaths: string[],
  destSessionId: string,
  destPath: string,
  move?: boolean,
  methodPreference?: TransferMethodPreference,
  parallelSegmentCount = 2,
): Promise<{ transferId: string }> {
  try {
    fileLogger.info("Starting host transfer", {
      operation: "host_transfer",
      sourceSessionId,
      destSessionId,
      sourcePaths,
      destPath,
      move,
      methodPreference,
      parallelSegmentCount,
    });

    const response = await fileManagerApi.post("/ssh/transferToHost", {
      sourceSessionId,
      sourcePaths,
      destSessionId,
      destPath,
      move,
      methodPreference: methodPreference ?? "auto",
      parallelSegmentCount,
    });

    return response.data;
  } catch (error) {
    fileLogger.error("Failed to start host transfer", error, {
      operation: "host_transfer",
      sourceSessionId,
      destSessionId,
      sourcePaths,
    });
    handleApiError(error, "transfer to host");
    throw error;
  }
}

export async function getTransferStatus(
  transferId: string,
): Promise<TransferProgressResponse> {
  try {
    const response = await fileManagerApi.get(
      `/ssh/transferStatus/${transferId}`,
    );
    return response.data;
  } catch (error) {
    handleApiError(error, "get transfer status");
    throw error;
  }
}

export async function listActiveTransfers(): Promise<{
  transfers: TransferProgressResponse[];
}> {
  try {
    const response = await fileManagerApi.get("/ssh/activeTransfers");
    return response.data;
  } catch (error) {
    handleApiError(error, "list active transfers");
    throw error;
  }
}

export async function cancelTransferToHost(transferId: string): Promise<void> {
  try {
    await fileManagerApi.post(`/ssh/transferCancel/${transferId}`);
  } catch (error) {
    fileLogger.warn("Transfer cancel request failed (non-fatal)", {
      operation: "host_transfer",
      transferId,
      error,
    });
  }
}

export async function cleanupCancelledTransfer(
  transferId: string,
): Promise<{ removedPaths: string[]; failedPaths: string[] }> {
  try {
    const response = await fileManagerApi.post(
      `/ssh/transferCleanup/${transferId}`,
    );
    return response.data;
  } catch (error) {
    handleApiError(error, "clean up cancelled transfer");
    throw error;
  }
}

export async function retryTransferToHost(
  transferId: string,
): Promise<{ ok: boolean; transferId: string }> {
  try {
    const response = await fileManagerApi.post(
      `/ssh/transferRetry/${transferId}`,
    );
    return response.data;
  } catch (error) {
    handleApiError(error, "retry transfer");
    throw error;
  }
}

export async function pollTransferUntilComplete(
  transferId: string,
  onProgress?: (status: TransferProgressResponse) => void,
  intervalMs = 500,
): Promise<TransferProgressResponse> {
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const status = await getTransferStatus(transferId);
        onProgress?.(status);

        if (
          status.status === "success" ||
          status.status === "partial" ||
          status.status === "error" ||
          status.status === "cancelled"
        ) {
          resolve(status);
          return;
        }

        setTimeout(poll, intervalMs);
      } catch (err) {
        reject(err);
      }
    };

    void poll();
  });
}

// ============================================================================
// FILE MANAGER DATA
// ============================================================================

export interface TransferDestination {
  id: number;
  userId: string;
  sourceHostId: number;
  destHostId: number;
  destPath: string;
  destPathLabel?: string;
  lastUsed?: string;
}

export async function getTransferRecent(
  sourceHostId: number,
): Promise<TransferDestination[]> {
  try {
    const response = await authApi.get("/host/transfer/recent", {
      params: { sourceHostId },
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "get transfer recent destinations");
    throw error;
  }
}

export async function addTransferRecent(
  sourceHostId: number,
  destHostId: number,
  destPath: string,
  destPathLabel?: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/host/transfer/recent", {
      sourceHostId,
      destHostId,
      destPath,
      destPathLabel,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "add transfer recent destination");
    throw error;
  }
}

export {
  getSSHHosts,
  createSSHHost,
  updateSSHHost,
  wakeOnLan,
  bulkImportSSHHosts,
  importSSHConfigHosts,
  discoverProxmoxGuests,
  bulkUpdateSSHHosts,
  deleteSSHHost,
  getSSHHostById,
  exportSSHHostWithCredentials,
  exportAllSSHHosts,
  enableAutoStart,
  disableAutoStart,
  getAutoStartStatus,
  testProxyConnection,
} from "@/api/ssh-host-management-api";

export {
  getTunnelStatuses,
  subscribeTunnelStatuses,
  getTunnelStatusByName,
  connectTunnel,
  disconnectTunnel,
  cancelTunnel,
  getC2STunnelPresets,
  createC2STunnelPreset,
  updateC2STunnelPreset,
  deleteC2STunnelPreset,
} from "@/api/tunnel-api";

export {
  getFileManagerRecent,
  addFileManagerRecent,
  removeFileManagerRecent,
  getFileManagerPinned,
  addFileManagerPinned,
  removeFileManagerPinned,
  getFileManagerShortcuts,
  addFileManagerShortcut,
  removeFileManagerShortcut,
} from "@/api/file-manager-metadata-api";

export {
  connectSSH,
  disconnectSSH,
  verifySSHTOTP,
  verifySSHWarpgate,
  quickConnect,
  getSSHStatus,
  keepSSHAlive,
  listSSHFiles,
  identifySSHSymlink,
  resolveSSHPath,
  readSSHFile,
  writeSSHFile,
  uploadSSHFile,
  downloadSSHFile,
  downloadSSHFileStream,
  createSSHFile,
  createSSHFolder,
  deleteSSHItem,
  setSudoPassword,
  copySSHItem,
  renameSSHItem,
  moveSSHItem,
  changeSSHPermissions,
  extractSSHArchive,
  compressSSHFiles,
  ensureSSHSessionForHost,
  browseSSHDirectory,
  type HostConnectionState,
  type EnsureSSHSessionResult,
  type BrowseSSHDirectoryResult,
} from "@/api/ssh-file-operations-api";

export {
  getRecentFiles,
  addRecentFile,
  removeRecentFile,
  getPinnedFiles,
  addPinnedFile,
  removePinnedFile,
  getFolderShortcuts,
  addFolderShortcut,
  removeFolderShortcut,
} from "@/api/file-manager-data-api";

export {
  getAllServerStatuses,
  getServerStatusById,
  getServerMetricsById,
  startMetricsPolling,
  stopMetricsPolling,
  sendMetricsHeartbeat,
  registerMetricsViewer,
  unregisterMetricsViewer,
  submitMetricsTOTP,
  refreshServerPolling,
  notifyHostCreatedOrUpdated,
} from "@/api/host-metrics-status-api";

export {
  getHostMetricsLayout,
  saveHostMetricsLayout,
  getHostPlatform,
  managerGet,
  managerGetSub,
  managerPost,
  type PlatformInfo,
} from "@/api/host-metrics-api";

export {
  getGlobalMonitoringSettings,
  updateGlobalMonitoringSettings,
  getLogLevel,
  updateLogLevel,
  getSessionTimeout,
  updateSessionTimeout,
  getGuacamoleSettings,
  updateGuacamoleSettings,
} from "@/api/settings-api";

// ============================================================================
// AUTHENTICATION
// ============================================================================

export async function registerUser(
  username: string,
  password: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/users/create", {
      username,
      password,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "register user");
  }
}

export async function adminCreateUser(
  username: string,
  password: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/users/admin-create", {
      username,
      password,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "admin create user");
  }
}

export async function loginUser(
  username: string,
  password: string,
  rememberMe: boolean = false,
): Promise<AuthResponse> {
  try {
    const response = await authApi.post("/users/login", {
      username,
      password,
      rememberMe,
    });

    const isInIframe =
      typeof window !== "undefined" && window.self !== window.top;

    if (isInIframe && isElectron() && response.data.success) {
      try {
        window.parent.postMessage(
          {
            type: "AUTH_SUCCESS",
            source: "login_api",
            platform: "desktop",
            timestamp: Date.now(),
          },
          window.location.origin,
        );
      } catch (e) {
        console.error("[main-axios] Error posting message to parent:", e);
      }
    }

    if (response.data.token) {
      localStorage.setItem("jwt", response.data.token);
    }

    if (response.data.success && !response.data.requires_totp) {
      markUserAuthenticated();
    }

    return {
      success: response.data.success,
      is_admin: response.data.is_admin,
      username: response.data.username,
      requires_totp: response.data.requires_totp,
      temp_token: response.data.temp_token,
      rememberMe: response.data.rememberMe,
      is_oidc: response.data.is_oidc,
      totp_enabled: response.data.totp_enabled,
      data_unlocked: response.data.data_unlocked,
      token: response.data.token,
    };
  } catch (error) {
    throw handleApiError(error, "login user");
  }
}

export async function logoutUser(): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    const response = await authApi.post("/users/logout");

    clearTermixSessionStorage();

    if (isElectron()) {
      const electronAPI = (
        window as unknown as {
          electronAPI?: { clearSessionCookies?: () => Promise<void> };
        }
      ).electronAPI;
      electronAPI?.clearSessionCookies?.().catch(() => {});
    } else {
      const isSecure = window.location.protocol === "https:";
      const cookieString = isSecure
        ? "jwt=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; Secure; SameSite=Lax"
        : "jwt=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax";
      document.cookie = cookieString;
    }

    return response.data;
  } catch (error) {
    clearTermixSessionStorage();

    if (isElectron()) {
      const electronAPI = (
        window as unknown as {
          electronAPI?: { clearSessionCookies?: () => Promise<void> };
        }
      ).electronAPI;
      electronAPI?.clearSessionCookies?.().catch(() => {});
    } else {
      const isSecure = window.location.protocol === "https:";
      const cookieString = isSecure
        ? "jwt=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; Secure; SameSite=Lax"
        : "jwt=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax";
      document.cookie = cookieString;
    }
    handleApiError(error, "logout user");
  }
}

export async function getUserInfo(): Promise<UserInfo> {
  try {
    const response = await authApi.get("/users/me");
    markUserAuthenticated();
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch user info");
  }
}

export async function getCurrentToken(): Promise<string | null> {
  try {
    const response = await authApi.get("/users/me/token");
    return response.data?.token ?? null;
  } catch {
    return null;
  }
}

export async function unlockUserData(
  password: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await authApi.post("/users/unlock-data", { password });
    return response.data;
  } catch (error) {
    handleApiError(error, "unlock user data");
  }
}

export async function getRegistrationAllowed(): Promise<{ allowed: boolean }> {
  try {
    const response = await authApi.get("/users/registration-allowed");
    return response.data;
  } catch (error) {
    handleApiError(error, "check registration status");
  }
}

export async function getPasswordLoginAllowed(): Promise<{ allowed: boolean }> {
  try {
    const response = await authApi.get("/users/password-login-allowed");
    return response.data;
  } catch (error) {
    handleApiError(error, "check password login status");
  }
}

export async function getOIDCConfig(): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.get("/users/oidc-config");
    return response.data;
  } catch (error: unknown) {
    console.warn(
      "Failed to fetch OIDC config:",
      error.response?.data?.error || error.message,
    );
    return null;
  }
}

export async function getAdminOIDCConfig(): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.get("/users/oidc-config/admin");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch admin OIDC config");
  }
}

export async function getSetupRequired(): Promise<{ setup_required: boolean }> {
  try {
    const response = await authApi.get("/users/setup-required");
    return response.data;
  } catch (error) {
    handleApiError(error, "check setup status");
  }
}

export async function getUserCount(): Promise<UserCount> {
  try {
    const response = await authApi.get("/users/count");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch user count");
  }
}

export async function initiatePasswordReset(
  username: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/users/initiate-reset", { username });
    return response.data;
  } catch (error) {
    handleApiError(error, "initiate password reset");
  }
}

export async function verifyPasswordResetCode(
  username: string,
  resetCode: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/users/verify-reset-code", {
      username,
      resetCode,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "verify reset code");
  }
}

export async function completePasswordReset(
  username: string,
  tempToken: string,
  newPassword: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/users/complete-reset", {
      username,
      tempToken,
      newPassword,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "complete password reset");
  }
}

export async function changePassword(oldPassword: string, newPassword: string) {
  try {
    const response = await authApi.post("/users/change-password", {
      oldPassword,
      newPassword,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "change password");
  }
}

export async function getOIDCAuthorizeUrl(
  rememberMe = false,
  desktopCallbackPort?: number,
  providerId?: number,
  appCallbackUrl?: string,
): Promise<OIDCAuthorize> {
  try {
    const response = await authApi.get("/users/oidc/authorize", {
      params: { rememberMe, desktopCallbackPort, providerId, appCallbackUrl },
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "get OIDC authorize URL");
  }
}

// ============================================================================
export {
  getUserList,
  getSessions,
  revokeSession,
  revokeAllUserSessions,
  createApiKey,
  getApiKeys,
  deleteApiKey,
  makeUserAdmin,
  removeAdminStatus,
  deleteUser,
  deleteAccount,
  updateRegistrationAllowed,
  getOidcAutoProvision,
  updateOidcAutoProvision,
  getOidcSilentLoginDefault,
  updateOidcSilentLoginDefault,
  updatePasswordLoginAllowed,
  getPasswordResetAllowed,
  updatePasswordResetAllowed,
  updateOIDCConfig,
  disableOIDCConfig,
  getCommandHistoryEnabled,
  updateCommandHistoryEnabled,
  type ApiKey,
  type CreatedApiKey,
} from "@/api/user-management-api";

export {
  setupTOTP,
  enableTOTP,
  disableTOTP,
  verifyTOTPLogin,
  generateBackupCodes,
  getUserAlerts,
  dismissAlert,
  getReleasesRSS,
  getVersionInfo,
  getDatabaseHealth,
} from "@/api/system-status-api";

// SSH CREDENTIALS MANAGEMENT
// ============================================================================

export {
  getCredentials,
  getCredentialDetails,
  createCredential,
  updateCredential,
  deleteCredential,
  getCredentialHosts,
  getCredentialFolders,
  getSSHHostWithCredentials,
  getHostPassword,
  applyCredentialToHost,
  removeCredentialFromHost,
  migrateHostToCredential,
  getFoldersWithStats,
  renameFolder,
  getSSHFolders,
  updateFolderMetadata,
  deleteAllHostsInFolder,
  renameCredentialFolder,
  detectKeyType,
  detectPublicKeyType,
  validateKeyPair,
  generatePublicKeyFromPrivate,
  generateKeyPair,
  deployCredentialToHost,
} from "@/api/credentials-api";

// ============================================================================
// SNIPPETS API
// ============================================================================

export type {
  NetworkTopologyNode,
  NetworkTopologyEdge,
  NetworkTopologyData,
} from "@/api/snippets-api";
export {
  getSnippets,
  createSnippet,
  updateSnippet,
  deleteSnippet,
  executeSnippet,
  getNetworkTopology,
  saveNetworkTopology,
  getSnippetFolders,
  createSnippetFolder,
  updateSnippetFolderMetadata,
  renameSnippetFolder,
  deleteSnippetFolder,
  reorderSnippets,
} from "@/api/snippets-api";

// ============================================================================
export type {
  UptimeInfo,
  RecentActivityItem,
  ServiceLink,
} from "@/api/dashboard-api";
export {
  getUptime,
  getRecentActivity,
  logActivity,
  resetRecentActivity,
  getServiceLinks,
  createServiceLink,
  deleteServiceLink,
  updateServiceLink,
} from "@/api/dashboard-api";

// ============================================================================
export {
  saveCommandToHistory,
  getCommandHistory,
  deleteCommandFromHistory,
  clearCommandHistory,
} from "@/api/command-history-api";

export {
  linkOIDCToPasswordAccount,
  unlinkOIDCFromPasswordAccount,
} from "@/api/oidc-account-api";

export type {
  GuacamoleTokenRequest,
  GuacamoleTokenResponse,
} from "@/api/guacamole-api";
export {
  getGuacamoleDpi,
  getGuacamoleToken,
  getGuacamoleTokenFromHost,
  getGuacdStatus,
} from "@/api/guacamole-api";

// ============================================================================
// RBAC MANAGEMENT
// ============================================================================

export {
  getRoles,
  createRole,
  updateRole,
  deleteRole,
  getUserRoles,
  assignRoleToUser,
  removeRoleFromUser,
  shareHost,
  getHostAccess,
  revokeHostAccess,
  shareSnippet,
  getSnippetAccess,
  revokeSnippetAccess,
  getSharedSnippets,
} from "@/api/rbac-api";

// ============================================================================
// DOCKER MANAGEMENT API
// ============================================================================

export {
  connectDockerSession,
  verifyDockerTOTP,
  verifyDockerWarpgate,
  disconnectDockerSession,
  keepaliveDockerSession,
  getDockerSessionStatus,
  validateDockerAvailability,
  listDockerContainers,
  getDockerContainerDetails,
  startDockerContainer,
  stopDockerContainer,
  restartDockerContainer,
  pauseDockerContainer,
  unpauseDockerContainer,
  removeDockerContainer,
  getContainerLogs,
  downloadContainerLogs,
  getContainerStats,
} from "@/api/docker-api";

export {
  getOpenTabs,
  syncOpenTabs,
  deleteOpenTab,
  patchOpenTab,
  addOpenTab,
  getActiveSessions,
  getUserPreferences,
  saveUserPreferences,
  type OpenTabRecord,
  type OpenTabSyncPayload,
  type OpenTabUpsertPayload,
  type ActiveSessionInfo,
  type UserPreferences,
} from "@/api/open-tabs-api";
