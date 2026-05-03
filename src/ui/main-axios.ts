import axios, { AxiosError, type AxiosInstance } from "axios";
import { toast } from "sonner";
import { getBasePath } from "@/lib/base-path";
import { isElectron } from "@/lib/electron";
import { clearTermixSessionStorage } from "@/ui/desktop/navigation/tabs/TabContext";
import type {
  SSHHost,
  SSHHostData,
  SSHFolder,
  TunnelConfig,
  TunnelStatus,
  TunnelConnection,
  C2STunnelPreset,
  FileManagerFile,
  FileManagerShortcut,
  DockerContainer,
  DockerStats,
  DockerLogOptions,
  DockerValidation,
  ProxyNode,
} from "../types/index.js";

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
} from "../lib/frontend-logger.js";
import { dbHealthMonitor } from "../lib/db-health-monitor.js";

interface FileManagerOperation {
  name: string;
  path: string;
  isSSH: boolean;
  sshSessionId?: string;
  hostId: number;
}

export type ServerStatus = {
  status: "online" | "offline";
  lastChecked: string;
};

export type SSHHostWithStatus = SSHHost & {
  status: "online" | "offline" | "unknown";
};

type ApiConnectionLog = {
  type: "info" | "success" | "warning" | "error";
  stage: string;
  message: string;
  details?: Record<string, unknown>;
};

type ConnectErrorResponse = {
  error?: string;
  message?: string;
  connectionLogs?: ApiConnectionLog[];
  requires_totp?: boolean;
  requires_warpgate?: boolean;
  sessionId?: string;
  prompt?: string;
  url?: string;
  securityKey?: string;
  status?: string;
  reason?: string;
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

export type ServerMetrics = {
  cpu: CpuMetrics;
  memory: MemoryMetrics;
  disk: DiskMetrics;
  lastChecked: string;
};

interface AuthResponse {
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
}

interface UserInfo {
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

function markUserAuthenticated(): void {
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

          const wasAuthenticated = userWasAuthenticated;

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

interface AxiosRequestConfigExtended extends AxiosRequestConfig {
  startTime?: number;
  requestId?: string;
  __silentRetry?: boolean;
}

interface AxiosErrorExtended extends AxiosError {
  config?: AxiosRequestConfigExtended;
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

// Pre-initialize with default values to avoid undefined errors during early mounting
initializeApiInstances();

function initializeApp() {
  if (isElectron()) {
    Promise.all([getServerConfig(), getEmbeddedServerStatus()])
      .then(([config, status]) => {
        if (status?.embedded && status?.running) {
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
      });
  } else {
    initializeApiInstances();
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

function handleApiError(error: unknown, operation: string): never {
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
// SSH HOST MANAGEMENT
// ============================================================================

export async function getSSHHosts(): Promise<SSHHostWithStatus[]> {
  try {
    const hostsResponse = await sshHostApi.get("/db/host");
    const hosts: SSHHost[] = Array.isArray(hostsResponse.data)
      ? hostsResponse.data
      : [];

    let statuses: Record<number, ServerStatus> = {};
    try {
      statuses = (await getAllServerStatuses()) || {};
    } catch {
      // Status fetch failure should not prevent host list from loading
    }

    return hosts.map((host) => ({
      ...host,
      status: statuses[host.id]?.status || "unknown",
    }));
  } catch (error) {
    throw handleApiError(error, "fetch SSH hosts");
  }
}

export async function createSSHHost(hostData: SSHHostData): Promise<SSHHost> {
  try {
    const submitData = {
      connectionType: hostData.connectionType || "ssh",
      name: hostData.name || "",
      ip: hostData.ip,
      port: parseInt(hostData.port.toString()) || 22,
      username: hostData.username,
      folder: hostData.folder || "",
      tags: hostData.tags || [],
      pin: Boolean(hostData.pin),
      authType: hostData.authType,
      password:
        hostData.connectionType !== "ssh"
          ? hostData.password || null
          : hostData.authType === "password"
            ? hostData.password
            : null,
      key: hostData.authType === "key" ? hostData.key : null,
      keyPassword: hostData.authType === "key" ? hostData.keyPassword : null,
      keyType: hostData.authType === "key" ? hostData.keyType : null,
      credentialId:
        hostData.authType === "credential" ? hostData.credentialId : null,
      overrideCredentialUsername: Boolean(hostData.overrideCredentialUsername),
      enableTerminal: Boolean(hostData.enableTerminal),
      enableTunnel: Boolean(hostData.enableTunnel),
      enableFileManager: Boolean(hostData.enableFileManager),
      enableDocker: Boolean(hostData.enableDocker),
      showTerminalInSidebar: Boolean(hostData.showTerminalInSidebar),
      showFileManagerInSidebar: Boolean(hostData.showFileManagerInSidebar),
      showTunnelInSidebar: Boolean(hostData.showTunnelInSidebar),
      showDockerInSidebar: Boolean(hostData.showDockerInSidebar),
      showServerStatsInSidebar: Boolean(hostData.showServerStatsInSidebar),
      defaultPath: hostData.defaultPath || "/",
      tunnelConnections: hostData.tunnelConnections || [],
      jumpHosts: hostData.jumpHosts || [],
      quickActions: hostData.quickActions || [],
      sudoPassword: hostData.sudoPassword || null,
      statsConfig: hostData.statsConfig || null,
      dockerConfig: hostData.dockerConfig || null,
      terminalConfig: hostData.terminalConfig || null,
      forceKeyboardInteractive: Boolean(hostData.forceKeyboardInteractive),
      domain: hostData.domain || null,
      security: hostData.security || null,
      ignoreCert: Boolean(hostData.ignoreCert),
      guacamoleConfig: hostData.guacamoleConfig || null,
      notes: hostData.notes || "",
      useSocks5: Boolean(hostData.useSocks5),
      socks5Host: hostData.socks5Host || null,
      socks5Port: hostData.socks5Port || null,
      socks5Username: hostData.socks5Username || null,
      socks5Password: hostData.socks5Password || null,
      socks5ProxyChain: hostData.socks5ProxyChain || null,
      macAddress: hostData.macAddress || null,
      portKnockSequence: hostData.portKnockSequence || null,
    };

    if (!submitData.enableTunnel) {
      submitData.tunnelConnections = [];
    }

    if (!submitData.enableFileManager) {
      submitData.defaultPath = "";
    }

    if (hostData.authType === "key" && hostData.key instanceof File) {
      const formData = new FormData();
      formData.append("key", hostData.key);

      const dataWithoutFile = { ...submitData };
      delete dataWithoutFile.key;
      formData.append("data", JSON.stringify(dataWithoutFile));

      const response = await sshHostApi.post("/db/host", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return response.data;
    } else {
      const response = await sshHostApi.post("/db/host", submitData);
      return response.data;
    }
  } catch (error) {
    throw handleApiError(error, "create SSH host");
  }
}

export async function updateSSHHost(
  hostId: number,
  hostData: SSHHostData,
): Promise<SSHHost> {
  try {
    const submitData = {
      connectionType: hostData.connectionType || "ssh",
      name: hostData.name || "",
      ip: hostData.ip,
      port: parseInt(hostData.port.toString()) || 22,
      username: hostData.username,
      folder: hostData.folder || "",
      tags: hostData.tags || [],
      pin: Boolean(hostData.pin),
      authType: hostData.authType,
      password:
        hostData.connectionType !== "ssh"
          ? hostData.password || null
          : hostData.authType === "password"
            ? hostData.password
            : null,
      key: hostData.authType === "key" ? hostData.key : null,
      keyPassword: hostData.authType === "key" ? hostData.keyPassword : null,
      keyType: hostData.authType === "key" ? hostData.keyType : null,
      credentialId:
        hostData.authType === "credential" ? hostData.credentialId : null,
      overrideCredentialUsername: Boolean(hostData.overrideCredentialUsername),
      enableTerminal: Boolean(hostData.enableTerminal),
      enableTunnel: Boolean(hostData.enableTunnel),
      enableFileManager: Boolean(hostData.enableFileManager),
      enableDocker: Boolean(hostData.enableDocker),
      showTerminalInSidebar: Boolean(hostData.showTerminalInSidebar),
      showFileManagerInSidebar: Boolean(hostData.showFileManagerInSidebar),
      showTunnelInSidebar: Boolean(hostData.showTunnelInSidebar),
      showDockerInSidebar: Boolean(hostData.showDockerInSidebar),
      showServerStatsInSidebar: Boolean(hostData.showServerStatsInSidebar),
      defaultPath: hostData.defaultPath || "/",
      tunnelConnections: hostData.tunnelConnections || [],
      jumpHosts: hostData.jumpHosts || [],
      quickActions: hostData.quickActions || [],
      sudoPassword: hostData.sudoPassword || null,
      statsConfig: hostData.statsConfig || null,
      dockerConfig: hostData.dockerConfig || null,
      terminalConfig: hostData.terminalConfig || null,
      forceKeyboardInteractive: Boolean(hostData.forceKeyboardInteractive),
      domain: hostData.domain || null,
      security: hostData.security || null,
      ignoreCert: Boolean(hostData.ignoreCert),
      guacamoleConfig: hostData.guacamoleConfig || null,
      notes: hostData.notes || "",
      useSocks5: Boolean(hostData.useSocks5),
      socks5Host: hostData.socks5Host || null,
      socks5Port: hostData.socks5Port || null,
      socks5Username: hostData.socks5Username || null,
      socks5Password: hostData.socks5Password || null,
      socks5ProxyChain: hostData.socks5ProxyChain || null,
      macAddress: hostData.macAddress || null,
      portKnockSequence: hostData.portKnockSequence || null,
    };

    if (!submitData.enableTunnel) {
      submitData.tunnelConnections = [];
    }
    if (!submitData.enableFileManager) {
      submitData.defaultPath = "";
    }

    if (hostData.authType === "key" && hostData.key instanceof File) {
      const formData = new FormData();
      formData.append("key", hostData.key);

      const dataWithoutFile = { ...submitData };
      delete dataWithoutFile.key;
      formData.append("data", JSON.stringify(dataWithoutFile));

      const response = await sshHostApi.put(`/db/host/${hostId}`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return response.data;
    } else {
      const response = await sshHostApi.put(`/db/host/${hostId}`, submitData);
      return response.data;
    }
  } catch (error) {
    throw handleApiError(error, "update SSH host");
  }
}

export async function wakeOnLan(hostId: number): Promise<{ success: boolean }> {
  try {
    const response = await sshHostApi.post(`/db/host/${hostId}/wake`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "wake on LAN");
  }
}

export async function bulkImportSSHHosts(
  hosts: SSHHostData[],
  overwrite = false,
): Promise<{
  message: string;
  success: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: string[];
}> {
  try {
    const response = await sshHostApi.post("/bulk-import", {
      hosts,
      overwrite,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "bulk import SSH hosts");
  }
}

export async function bulkUpdateSSHHosts(
  hostIds: number[],
  updates: Record<string, unknown>,
): Promise<{ updated: number; failed: number; errors: string[] }> {
  try {
    const response = await sshHostApi.patch("/bulk-update", {
      hostIds,
      updates,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "bulk update SSH hosts");
  }
}

export async function deleteSSHHost(
  hostId: number,
): Promise<Record<string, unknown>> {
  try {
    const response = await sshHostApi.delete(`/db/host/${hostId}`);
    return response.data;
  } catch (error) {
    handleApiError(error, "delete SSH host");
  }
}

export async function getSSHHostById(hostId: number): Promise<SSHHost> {
  try {
    const response = await sshHostApi.get(`/db/host/${hostId}`);
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch SSH host");
  }
}

export async function exportSSHHostWithCredentials(
  hostId: number,
): Promise<SSHHost> {
  try {
    const response = await sshHostApi.get(`/db/host/${hostId}/export`);
    return response.data;
  } catch (error) {
    handleApiError(error, "export SSH host with credentials");
  }
}

export async function exportAllSSHHosts(): Promise<{
  hosts: SSHHost[];
}> {
  try {
    const response = await sshHostApi.get("/db/hosts/export");
    return response.data;
  } catch (error) {
    handleApiError(error, "export all SSH hosts");
  }
}

// ============================================================================
// SSH AUTOSTART MANAGEMENT
// ============================================================================

export async function enableAutoStart(
  sshConfigId: number,
): Promise<Record<string, unknown>> {
  try {
    const response = await sshHostApi.post("/autostart/enable", {
      sshConfigId,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "enable autostart");
  }
}

export async function disableAutoStart(
  sshConfigId: number,
): Promise<Record<string, unknown>> {
  try {
    const response = await sshHostApi.delete("/autostart/disable", {
      data: { sshConfigId },
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "disable autostart");
  }
}

export async function getAutoStartStatus(): Promise<{
  autostart_configs: Array<{
    sshConfigId: number;
    host: string;
    port: number;
    username: string;
    authType: string;
  }>;
  total_count: number;
}> {
  try {
    const response = await sshHostApi.get("/autostart/status");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch autostart status");
  }
}

// ============================================================================
// PROXY CONNECTIVITY TEST
// ============================================================================

export async function testProxyConnection(options: {
  singleProxy?: {
    host: string;
    port: number;
    type?: 4 | 5 | "http";
    username?: string;
    password?: string;
  };
  proxyChain?: ProxyNode[];
  testTarget?: { host: string; port: number };
}): Promise<{ success: boolean; latencyMs?: number; error?: string }> {
  try {
    const response = await sshHostApi.post("/db/proxy/test", options);
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError && error.response?.data?.error) {
      return { success: false, error: error.response.data.error };
    }
    handleApiError(error, "test proxy connection");
  }
}

// ============================================================================
// TUNNEL MANAGEMENT
// ============================================================================

export async function getTunnelStatuses(): Promise<
  Record<string, TunnelStatus>
> {
  try {
    const response = await tunnelApi.get("/tunnel/status");
    return response.data || {};
  } catch (error) {
    handleApiError(error, "fetch tunnel statuses");
  }
}

export function subscribeTunnelStatuses(
  onStatuses: (statuses: Record<string, TunnelStatus>) => void,
  onError?: () => void,
): () => void {
  const baseURL = (tunnelApi.defaults.baseURL || "").replace(/\/$/, "");
  const source = new EventSource(`${baseURL}/tunnel/status/stream`, {
    withCredentials: true,
  });

  source.addEventListener("statuses", (event) => {
    try {
      onStatuses(JSON.parse(event.data) as Record<string, TunnelStatus>);
    } catch {
      onError?.();
    }
  });

  source.onerror = () => {
    onError?.();
  };

  return () => source.close();
}

export async function getTunnelStatusByName(
  tunnelName: string,
): Promise<TunnelStatus | undefined> {
  const statuses = await getTunnelStatuses();
  return statuses[tunnelName];
}

export async function connectTunnel(
  tunnelConfig: TunnelConfig,
): Promise<Record<string, unknown>> {
  try {
    const response = await tunnelApi.post("/tunnel/connect", tunnelConfig);
    return response.data;
  } catch (error) {
    handleApiError(error, "connect tunnel");
  }
}

export async function disconnectTunnel(
  tunnelName: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await tunnelApi.post("/tunnel/disconnect", { tunnelName });
    return response.data;
  } catch (error) {
    handleApiError(error, "disconnect tunnel");
  }
}

export async function cancelTunnel(
  tunnelName: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await tunnelApi.post("/tunnel/cancel", { tunnelName });
    return response.data;
  } catch (error) {
    handleApiError(error, "cancel tunnel");
  }
}

export async function getC2STunnelPresets(): Promise<C2STunnelPreset[]> {
  try {
    const response = await authApi.get("/c2s-tunnel-presets");
    return response.data || [];
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return [];
    }
    handleApiError(error, "fetch client tunnel presets");
  }
}

export async function createC2STunnelPreset(data: {
  name: string;
  config: TunnelConnection[];
  platform?: string;
  computerName?: string;
}): Promise<C2STunnelPreset> {
  try {
    const response = await authApi.post("/c2s-tunnel-presets", data);
    return response.data;
  } catch (error) {
    handleApiError(error, "create client tunnel preset");
  }
}

export async function updateC2STunnelPreset(
  id: number,
  data: Partial<{
    name: string;
    config: TunnelConnection[];
    platform: string;
    computerName: string;
  }>,
): Promise<C2STunnelPreset> {
  try {
    const response = await authApi.put(`/c2s-tunnel-presets/${id}`, data);
    return response.data;
  } catch (error) {
    handleApiError(error, "update client tunnel preset");
  }
}

export async function deleteC2STunnelPreset(
  id: number,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.delete(`/c2s-tunnel-presets/${id}`);
    return response.data;
  } catch (error) {
    handleApiError(error, "delete client tunnel preset");
  }
}

// ============================================================================
// FILE MANAGER METADATA (Recent, Pinned, Shortcuts)
// ============================================================================

export async function getFileManagerRecent(
  hostId: number,
): Promise<FileManagerFile[]> {
  try {
    const response = await sshHostApi.get(
      `/file_manager/recent?hostId=${hostId}`,
    );
    return response.data || [];
  } catch {
    return [];
  }
}

export async function addFileManagerRecent(
  file: FileManagerOperation,
): Promise<Record<string, unknown>> {
  try {
    const response = await sshHostApi.post("/file_manager/recent", file);
    return response.data;
  } catch (error) {
    handleApiError(error, "add recent file");
  }
}

export async function removeFileManagerRecent(
  file: FileManagerOperation,
): Promise<Record<string, unknown>> {
  try {
    const response = await sshHostApi.delete("/file_manager/recent", {
      data: file,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "remove recent file");
  }
}

export async function getFileManagerPinned(
  hostId: number,
): Promise<FileManagerFile[]> {
  try {
    const response = await sshHostApi.get(
      `/file_manager/pinned?hostId=${hostId}`,
    );
    return response.data || [];
  } catch {
    return [];
  }
}

export async function addFileManagerPinned(
  file: FileManagerOperation,
): Promise<Record<string, unknown>> {
  try {
    const response = await sshHostApi.post("/file_manager/pinned", file);
    return response.data;
  } catch (error) {
    handleApiError(error, "add pinned file");
  }
}

export async function removeFileManagerPinned(
  file: FileManagerOperation,
): Promise<Record<string, unknown>> {
  try {
    const response = await sshHostApi.delete("/file_manager/pinned", {
      data: file,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "remove pinned file");
  }
}

export async function getFileManagerShortcuts(
  hostId: number,
): Promise<FileManagerShortcut[]> {
  try {
    const response = await sshHostApi.get(
      `/file_manager/shortcuts?hostId=${hostId}`,
    );
    return response.data || [];
  } catch {
    return [];
  }
}

export async function addFileManagerShortcut(
  shortcut: FileManagerOperation,
): Promise<Record<string, unknown>> {
  try {
    const response = await sshHostApi.post("/file_manager/shortcuts", shortcut);
    return response.data;
  } catch (error) {
    handleApiError(error, "add shortcut");
  }
}

export async function removeFileManagerShortcut(
  shortcut: FileManagerOperation,
): Promise<Record<string, unknown>> {
  try {
    const response = await sshHostApi.delete("/file_manager/shortcuts", {
      data: shortcut,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "remove shortcut");
  }
}

// ============================================================================
// SSH FILE OPERATIONS
// ============================================================================

export async function connectSSH(
  sessionId: string,
  config: {
    hostId?: number;
    ip: string;
    port: number;
    username: string;
    password?: string;
    sshKey?: string;
    keyPassword?: string;
    authType?: string;
    credentialId?: number;
    userId?: string;
    forceKeyboardInteractive?: boolean;
    useSocks5?: boolean;
    socks5Host?: string;
    socks5Port?: number;
    socks5Username?: string;
    socks5Password?: string;
    socks5ProxyChain?: unknown;
    jumpHosts?: Array<{ hostId: number }>;
  },
): Promise<Record<string, unknown>> {
  try {
    const response = await fileManagerApi.post("/ssh/connect", {
      sessionId,
      ...config,
    });
    return response.data;
  } catch (error: unknown) {
    if (
      axios.isAxiosError<ConnectErrorResponse>(error) &&
      error.response?.data?.connectionLogs
    ) {
      const data = error.response.data;
      const errorWithLogs = new Error(
        data.error || data.message || error.message,
      );
      Object.assign(errorWithLogs, {
        connectionLogs: data.connectionLogs,
      });
      if (data.requires_totp) {
        Object.assign(errorWithLogs, {
          requires_totp: true,
          sessionId: data.sessionId,
          prompt: data.prompt,
        });
      }
      if (data.requires_warpgate) {
        Object.assign(errorWithLogs, {
          requires_warpgate: true,
          sessionId: data.sessionId,
          url: data.url,
          securityKey: data.securityKey,
        });
      }
      if (data.status === "auth_required") {
        Object.assign(errorWithLogs, {
          status: "auth_required",
          reason: data.reason,
        });
      }
      throw errorWithLogs;
    }
    handleApiError(error, "connect SSH");
  }
}

export async function disconnectSSH(
  sessionId: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await fileManagerApi.post("/ssh/disconnect", {
      sessionId,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "disconnect SSH");
  }
}

export async function verifySSHTOTP(
  sessionId: string,
  totpCode: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await fileManagerApi.post("/ssh/connect-totp", {
      sessionId,
      totpCode,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "verify SSH TOTP");
  }
}

export async function verifySSHWarpgate(
  sessionId: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await fileManagerApi.post("/ssh/connect-warpgate", {
      sessionId,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "verify SSH Warpgate");
  }
}

/**
 * @openapi
 * /ssh/quick-connect:
 *   post:
 *     summary: Create a temporary SSH connection without saving to database
 *     description: Returns a temporary host configuration for immediate use
 *     tags:
 *       - SSH
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - ip
 *               - port
 *               - username
 *               - authType
 *             properties:
 *               ip:
 *                 type: string
 *                 description: SSH server IP or hostname
 *               port:
 *                 type: number
 *                 description: SSH server port
 *               username:
 *                 type: string
 *                 description: SSH username
 *               authType:
 *                 type: string
 *                 enum: [password, key, credential]
 *                 description: Authentication method
 *               password:
 *                 type: string
 *                 description: Password (required if authType is password)
 *               key:
 *                 type: string
 *                 description: SSH private key (required if authType is key)
 *               keyPassword:
 *                 type: string
 *                 description: SSH key password (optional)
 *               keyType:
 *                 type: string
 *                 description: SSH key type
 *               credentialId:
 *                 type: number
 *                 description: Credential ID (required if authType is credential)
 *               overrideCredentialUsername:
 *                 type: boolean
 *                 description: Use provided username instead of credential username
 *     responses:
 *       200:
 *         description: Temporary host configuration created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               description: SSHHost object
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
export async function quickConnect(
  data: Record<string, unknown>,
): Promise<SSHHost> {
  try {
    const response = await authApi.post("/host/quick-connect", data);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "quick connect");
  }
}

export async function getSSHStatus(
  sessionId: string,
): Promise<{ connected: boolean }> {
  try {
    const response = await fileManagerApi.get("/ssh/status", {
      params: { sessionId },
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "get SSH status");
  }
}

export async function keepSSHAlive(
  sessionId: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await fileManagerApi.post("/ssh/keepalive", {
      sessionId,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "SSH keepalive");
  }
}

export async function listSSHFiles(
  sessionId: string,
  path: string,
): Promise<{ files: unknown[]; path: string }> {
  try {
    const response = await fileManagerApi.get("/ssh/listFiles", {
      params: { sessionId, path },
    });
    return response.data || { files: [], path };
  } catch (error) {
    handleApiError(error, "list SSH files");
    return { files: [], path };
  }
}

export async function identifySSHSymlink(
  sessionId: string,
  path: string,
): Promise<{ path: string; target: string; type: "directory" | "file" }> {
  try {
    const response = await fileManagerApi.get("/ssh/identifySymlink", {
      params: { sessionId, path },
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "identify SSH symlink");
  }
}

export async function resolveSSHPath(
  sessionId: string,
  path: string,
): Promise<string> {
  try {
    const response = await fileManagerApi.get("/ssh/resolvePath", {
      params: { sessionId, path },
    });
    return response.data?.resolvedPath || path;
  } catch {
    return path;
  }
}

export async function readSSHFile(
  sessionId: string,
  path: string,
): Promise<{
  content: string;
  path: string;
  encoding?: "base64" | "utf8";
}> {
  try {
    const response = await fileManagerApi.get("/ssh/readFile", {
      params: { sessionId, path },
    });
    return response.data;
  } catch (error: unknown) {
    if (error.response?.status === 404) {
      const customError = new Error("File not found");
      (
        customError as Error & { response?: unknown; isFileNotFound?: boolean }
      ).response = error.response;
      (
        customError as Error & { response?: unknown; isFileNotFound?: boolean }
      ).isFileNotFound = error.response.data?.fileNotFound || true;
      throw customError;
    }
    handleApiError(error, "read SSH file");
  }
}

export async function writeSSHFile(
  sessionId: string,
  path: string,
  content: string,
  hostId?: number,
  userId?: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await fileManagerApi.post("/ssh/writeFile", {
      sessionId,
      path,
      content,
      hostId,
      userId,
    });

    if (
      response.data &&
      (response.data.message === "File written successfully" ||
        response.status === 200)
    ) {
      return response.data;
    } else {
      throw new Error("File write operation did not return success status");
    }
  } catch (error) {
    handleApiError(error, "write SSH file");
  }
}

export async function uploadSSHFile(
  sessionId: string,
  path: string,
  fileName: string,
  content: string,
  hostId?: number,
  userId?: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await fileManagerApi.post("/ssh/uploadFile", {
      sessionId,
      path,
      fileName,
      content,
      hostId,
      userId,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "upload SSH file");
  }
}

export async function downloadSSHFile(
  sessionId: string,
  filePath: string,
  hostId?: number,
  userId?: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await fileManagerApi.post("/ssh/downloadFile", {
      sessionId,
      path: filePath,
      hostId,
      userId,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "download SSH file");
  }
}

export async function createSSHFile(
  sessionId: string,
  path: string,
  fileName: string,
  content: string = "",
  hostId?: number,
  userId?: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await fileManagerApi.post("/ssh/createFile", {
      sessionId,
      path,
      fileName,
      content,
      hostId,
      userId,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "create SSH file");
  }
}

export async function createSSHFolder(
  sessionId: string,
  path: string,
  folderName: string,
  hostId?: number,
  userId?: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await fileManagerApi.post("/ssh/createFolder", {
      sessionId,
      path,
      folderName,
      hostId,
      userId,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "create SSH folder");
  }
}

export async function deleteSSHItem(
  sessionId: string,
  path: string,
  isDirectory: boolean,
  hostId?: number,
  userId?: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await fileManagerApi.delete("/ssh/deleteItem", {
      data: {
        sessionId,
        path,
        isDirectory,
        hostId,
        userId,
      },
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "delete SSH item");
  }
}

export async function setSudoPassword(
  sessionId: string,
  password: string,
): Promise<void> {
  try {
    await fileManagerApi.post("/sudo-password", {
      sessionId,
      password,
    });
  } catch (error) {
    handleApiError(error, "set sudo password");
  }
}

export async function copySSHItem(
  sessionId: string,
  sourcePath: string,
  targetDir: string,
  hostId?: number,
  userId?: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await fileManagerApi.post(
      "/ssh/copyItem",
      {
        sessionId,
        sourcePath,
        targetDir,
        hostId,
        userId,
      },
      {
        timeout: 60000,
      },
    );
    return response.data;
  } catch (error) {
    handleApiError(error, "copy SSH item");
    throw error;
  }
}

export async function renameSSHItem(
  sessionId: string,
  oldPath: string,
  newName: string,
  hostId?: number,
  userId?: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await fileManagerApi.put("/ssh/renameItem", {
      sessionId,
      oldPath,
      newName,
      hostId,
      userId,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "rename SSH item");
    throw error;
  }
}

export async function moveSSHItem(
  sessionId: string,
  oldPath: string,
  newPath: string,
  hostId?: number,
  userId?: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await fileManagerApi.put(
      "/ssh/moveItem",
      {
        sessionId,
        oldPath,
        newPath,
        hostId,
        userId,
      },
      {
        timeout: 60000,
      },
    );
    return response.data;
  } catch (error) {
    handleApiError(error, "move SSH item");
    throw error;
  }
}

export async function changeSSHPermissions(
  sessionId: string,
  path: string,
  permissions: string,
  hostId?: number,
  userId?: string,
): Promise<{ success: boolean; message: string }> {
  try {
    fileLogger.info("Changing SSH file permissions", {
      operation: "change_permissions",
      sessionId,
      path,
      permissions,
      hostId,
      userId,
    });

    const response = await fileManagerApi.post("/ssh/changePermissions", {
      sessionId,
      path,
      permissions,
      hostId,
      userId,
    });

    fileLogger.success("SSH file permissions changed successfully", {
      operation: "change_permissions",
      sessionId,
      path,
      permissions,
    });

    return response.data;
  } catch (error) {
    fileLogger.error("Failed to change SSH file permissions", error, {
      operation: "change_permissions",
      sessionId,
      path,
      permissions,
    });
    handleApiError(error, "change SSH permissions");
    throw error;
  }
}

export async function extractSSHArchive(
  sessionId: string,
  archivePath: string,
  extractPath?: string,
  hostId?: number,
  userId?: string,
): Promise<{ success: boolean; message: string; extractPath: string }> {
  try {
    fileLogger.info("Extracting archive", {
      operation: "extract_archive",
      sessionId,
      archivePath,
      extractPath,
      hostId,
      userId,
    });

    const response = await fileManagerApi.post("/ssh/extractArchive", {
      sessionId,
      archivePath,
      extractPath,
      hostId,
      userId,
    });

    fileLogger.success("Archive extracted successfully", {
      operation: "extract_archive",
      sessionId,
      archivePath,
      extractPath: response.data.extractPath,
    });

    return response.data;
  } catch (error) {
    fileLogger.error("Failed to extract archive", error, {
      operation: "extract_archive",
      sessionId,
      archivePath,
      extractPath,
    });
    handleApiError(error, "extract archive");
    throw error;
  }
}

export async function compressSSHFiles(
  sessionId: string,
  paths: string[],
  archiveName: string,
  format?: string,
  hostId?: number,
  userId?: string,
): Promise<{ success: boolean; message: string; archivePath: string }> {
  try {
    fileLogger.info("Compressing files", {
      operation: "compress_files",
      sessionId,
      paths,
      archiveName,
      format,
      hostId,
      userId,
    });

    const response = await fileManagerApi.post("/ssh/compressFiles", {
      sessionId,
      paths,
      archiveName,
      format: format || "zip",
      hostId,
      userId,
    });

    fileLogger.success("Files compressed successfully", {
      operation: "compress_files",
      sessionId,
      paths,
      archivePath: response.data.archivePath,
    });

    return response.data;
  } catch (error) {
    fileLogger.error("Failed to compress files", error, {
      operation: "compress_files",
      sessionId,
      paths,
      archiveName,
      format,
    });
    handleApiError(error, "compress files");
    throw error;
  }
}

// ============================================================================
// FILE MANAGER DATA
// ============================================================================

export async function getRecentFiles(
  hostId: number,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.get("/host/file_manager/recent", {
      params: { hostId },
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "get recent files");
    throw error;
  }
}

export async function addRecentFile(
  hostId: number,
  path: string,
  name?: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/host/file_manager/recent", {
      hostId,
      path,
      name,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "add recent file");
    throw error;
  }
}

export async function removeRecentFile(
  hostId: number,
  path: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.delete("/host/file_manager/recent", {
      data: { hostId, path },
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "remove recent file");
    throw error;
  }
}

export async function getPinnedFiles(
  hostId: number,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.get("/host/file_manager/pinned", {
      params: { hostId },
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "get pinned files");
    throw error;
  }
}

export async function addPinnedFile(
  hostId: number,
  path: string,
  name?: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/host/file_manager/pinned", {
      hostId,
      path,
      name,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "add pinned file");
    throw error;
  }
}

export async function removePinnedFile(
  hostId: number,
  path: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.delete("/host/file_manager/pinned", {
      data: { hostId, path },
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "remove pinned file");
    throw error;
  }
}

export async function getFolderShortcuts(
  hostId: number,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.get("/host/file_manager/shortcuts", {
      params: { hostId },
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "get folder shortcuts");
    throw error;
  }
}

export async function addFolderShortcut(
  hostId: number,
  path: string,
  name?: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/host/file_manager/shortcuts", {
      hostId,
      path,
      name,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "add folder shortcut");
    throw error;
  }
}

export async function removeFolderShortcut(
  hostId: number,
  path: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.delete("/host/file_manager/shortcuts", {
      data: { hostId, path },
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "remove folder shortcut");
    throw error;
  }
}

// ============================================================================
// SERVER STATISTICS
// ============================================================================

/**
 * Progressive retry schedule for the background /status poll.
 *
 * Each entry describes one attempt's per-request timeout and the pause to
 * observe before the next attempt. The pause on the last entry is `null`:
 * after that final failure we surface the network error, which flows
 * through the response interceptor + dbHealthMonitor (which decides
 * between the degraded toast and the full-outage overlay based on whether
 * any WebSocket is still alive).
 *
 * Sequence: try(2s) -> wait 3s -> try(5s) -> wait 5s -> try(8s) -> fail.
 * Worst-case wall-clock = 23s, which fits inside the 30s ServerStatusContext
 * poll cadence, so the next tick acts as the next retry without overlap.
 */
const STATUS_RETRY_SCHEDULE: ReadonlyArray<{
  timeoutMs: number;
  pauseAfterMs: number | null;
}> = [
  { timeoutMs: 2000, pauseAfterMs: 3000 },
  { timeoutMs: 5000, pauseAfterMs: 5000 },
  { timeoutMs: 8000, pauseAfterMs: null },
];

function isTransientStatusError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  if (error.response) {
    // Definitive server response (even 5xx) is not something more retries
    // will fix in a useful timeframe; bail out and report it normally.
    return false;
  }
  const code = error.code;
  if (!code) {
    // No code + no response means classic network error (offline / DNS / TCP)
    return true;
  }
  return (
    code === "ECONNABORTED" ||
    code === "ETIMEDOUT" ||
    code === "ERR_NETWORK" ||
    code === "ECONNREFUSED" ||
    code === "ECONNRESET"
  );
}

export async function getAllServerStatuses(): Promise<
  Record<number, ServerStatus>
> {
  let lastError: unknown = null;

  for (let i = 0; i < STATUS_RETRY_SCHEDULE.length; i++) {
    const { timeoutMs, pauseAfterMs } = STATUS_RETRY_SCHEDULE[i];
    const isFinalAttempt = i === STATUS_RETRY_SCHEDULE.length - 1;

    try {
      const response = await statsApi.get("/status", {
        timeout: timeoutMs,
        // Silence per-attempt interceptor logging & health-monitor side
        // effects on all attempts except the final one, so background
        // blips don't look like real outages.
        __silentRetry: !isFinalAttempt,
      } as AxiosRequestConfig & { __silentRetry?: boolean });
      return response.data || {};
    } catch (error) {
      lastError = error;
      if (!isTransientStatusError(error)) {
        break;
      }
      if (pauseAfterMs === null) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, pauseAfterMs));
    }
  }

  handleApiError(lastError, "fetch server statuses");
}

export async function getServerStatusById(id: number): Promise<ServerStatus> {
  try {
    const response = await statsApi.get(`/status/${id}`);
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch server status");
    throw error;
  }
}

export async function getServerMetricsById(
  id: number,
): Promise<ServerMetrics | null> {
  try {
    const response = await statsApi.get(`/metrics/${id}`, {
      // Treat 404 as an expected "no metrics yet / disabled" signal rather
      // than an error so we don't spam warn logs on the client.
      validateStatus: (status) => status === 200 || status === 404,
    });
    if (response.status === 404) {
      return null;
    }
    return response.data;
  } catch (error) {
    // If a 404 still slips through (e.g. intercepted before reaching here),
    // swallow it quietly; everything else still flows through handleApiError.
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return null;
    }
    handleApiError(error, "fetch server metrics");
    throw error;
  }
}

export async function startMetricsPolling(hostId: number): Promise<{
  success: boolean;
  requires_totp?: boolean;
  sessionId?: string;
  prompt?: string;
  viewerSessionId?: string;
  connectionLogs?: ApiConnectionLog[];
}> {
  try {
    const response = await statsApi.post(`/metrics/start/${hostId}`);
    return response.data;
  } catch (error: unknown) {
    if (
      axios.isAxiosError<ConnectErrorResponse>(error) &&
      error.response?.data?.connectionLogs
    ) {
      const data = error.response.data;
      const errorWithLogs = new Error(
        data.error || data.message || error.message,
      );
      Object.assign(errorWithLogs, {
        connectionLogs: data.connectionLogs,
      });
      throw errorWithLogs;
    }
    handleApiError(error, "start metrics polling");
    throw error;
  }
}

export async function stopMetricsPolling(
  hostId: number,
  viewerSessionId?: string,
): Promise<void> {
  try {
    await statsApi.post(`/metrics/stop/${hostId}`, { viewerSessionId });
  } catch (error) {
    handleApiError(error, "stop metrics polling");
    throw error;
  }
}

export async function sendMetricsHeartbeat(
  viewerSessionId: string,
): Promise<void> {
  try {
    await statsApi.post("/metrics/heartbeat", { viewerSessionId });
  } catch (error) {
    handleApiError(error, "send metrics heartbeat");
    throw error;
  }
}

export async function registerMetricsViewer(hostId: number): Promise<{
  success: boolean;
  viewerSessionId?: string;
  skipped?: boolean;
  reason?: string;
}> {
  try {
    const response = await statsApi.post("/metrics/register-viewer", {
      hostId,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "register metrics viewer");
    throw error;
  }
}

export async function unregisterMetricsViewer(
  hostId: number,
  viewerSessionId: string,
): Promise<void> {
  try {
    await statsApi.post("/metrics/unregister-viewer", {
      hostId,
      viewerSessionId,
    });
  } catch (error) {
    handleApiError(error, "unregister metrics viewer");
    throw error;
  }
}

export async function submitMetricsTOTP(
  sessionId: string,
  totpCode: string,
): Promise<{
  success: boolean;
  viewerSessionId?: string;
}> {
  try {
    const response = await statsApi.post("/metrics/connect-totp", {
      sessionId,
      totpCode,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "submit metrics TOTP");
    throw error;
  }
}

export async function refreshServerPolling(): Promise<void> {
  try {
    await statsApi.post("/refresh");
  } catch (error) {
    console.warn("Failed to refresh server polling:", error);
  }
}

export async function notifyHostCreatedOrUpdated(
  hostId: number,
): Promise<void> {
  try {
    await statsApi.post("/host-updated", { hostId });
  } catch (error) {
    console.warn("Failed to notify stats server of host update:", error);
  }
}

// ============================================================================
// GLOBAL MONITORING SETTINGS
// ============================================================================

export async function getGlobalMonitoringSettings(): Promise<{
  statusCheckInterval: number;
  metricsInterval: number;
}> {
  try {
    const response = await statsApi.get("/global-settings");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch global monitoring settings");
  }
}

export async function updateGlobalMonitoringSettings(settings: {
  statusCheckInterval?: number;
  metricsInterval?: number;
}): Promise<void> {
  try {
    await statsApi.post("/global-settings", settings);
  } catch (error) {
    handleApiError(error, "update global monitoring settings");
  }
}

// ============================================================================
// LOG LEVEL SETTINGS
// ============================================================================

export async function getLogLevel(): Promise<{ level: string }> {
  try {
    const response = await authApi.get("/users/log-level");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch log level");
  }
}

export async function updateLogLevel(level: string): Promise<void> {
  try {
    await authApi.patch("/users/log-level", { level });
  } catch (error) {
    handleApiError(error, "update log level");
  }
}

// ============================================================================
// SESSION TIMEOUT SETTINGS
// ============================================================================

export async function getSessionTimeout(): Promise<{ timeoutHours: number }> {
  try {
    const response = await authApi.get("/users/session-timeout");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch session timeout");
  }
}

export async function updateSessionTimeout(
  timeoutHours: number,
): Promise<void> {
  try {
    await authApi.patch("/users/session-timeout", { timeoutHours });
  } catch (error) {
    handleApiError(error, "update session timeout");
  }
}

// ============================================================================
// GUACAMOLE SETTINGS
// ============================================================================

export async function getGuacamoleSettings(): Promise<{
  enabled: boolean;
  url: string;
}> {
  try {
    const response = await authApi.get("/users/guacamole-settings");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch guacamole settings");
  }
}

export async function updateGuacamoleSettings(settings: {
  enabled?: boolean;
  url?: string;
}): Promise<void> {
  try {
    await authApi.patch("/users/guacamole-settings", settings);
  } catch (error) {
    handleApiError(error, "update guacamole settings");
  }
}

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
): Promise<OIDCAuthorize> {
  try {
    const response = await authApi.get("/users/oidc/authorize", {
      params: { rememberMe },
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "get OIDC authorize URL");
  }
}

// ============================================================================
// USER MANAGEMENT
// ============================================================================

export async function getUserList(): Promise<{ users: UserInfo[] }> {
  try {
    const response = await authApi.get("/users/list");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch user list");
  }
}

export async function getSessions(): Promise<{
  sessions: {
    id: string;
    userId: string;
    username?: string;
    deviceType: string;
    deviceInfo: string;
    createdAt: string;
    expiresAt: string;
    lastActiveAt: string;
    isRevoked?: boolean;
    isCurrentSession?: boolean;
  }[];
}> {
  try {
    const response = await authApi.get("/users/sessions");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch sessions");
  }
}

export async function revokeSession(
  sessionId: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await authApi.delete(`/users/sessions/${sessionId}`);
    return response.data;
  } catch (error) {
    handleApiError(error, "revoke session");
  }
}

export async function revokeAllUserSessions(
  userId: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await authApi.post("/users/sessions/revoke-all", {
      targetUserId: userId,
      exceptCurrent: false,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "revoke all user sessions");
  }
}

export interface ApiKey {
  id: string;
  name: string;
  userId: string;
  username: string | null;
  tokenPrefix: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  isActive: boolean;
}

export interface CreatedApiKey extends ApiKey {
  token: string;
}

export async function createApiKey(
  name: string,
  userId: string,
  expiresAt?: string,
): Promise<CreatedApiKey> {
  try {
    const response = await authApi.post("/users/api-keys", {
      name,
      userId,
      expiresAt: expiresAt ?? null,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "create API key");
  }
}

export async function getApiKeys(): Promise<{ apiKeys: ApiKey[] }> {
  try {
    const response = await authApi.get("/users/api-keys");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch API keys");
  }
}

export async function deleteApiKey(
  keyId: string,
): Promise<{ success: boolean }> {
  try {
    const response = await authApi.delete(`/users/api-keys/${keyId}`);
    return response.data;
  } catch (error) {
    handleApiError(error, "delete API key");
  }
}

export async function makeUserAdmin(
  userId: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/users/make-admin", { userId });
    return response.data;
  } catch (error) {
    handleApiError(error, "make user admin");
  }
}

export async function removeAdminStatus(
  userId: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/users/remove-admin", { userId });
    return response.data;
  } catch (error) {
    handleApiError(error, "remove admin status");
  }
}

export async function deleteUser(
  username: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.delete("/users/delete-user", {
      data: { username },
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "delete user");
  }
}

export async function deleteAccount(
  password: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.delete("/users/delete-account", {
      data: { password },
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "delete account");
  }
}

export async function updateRegistrationAllowed(
  allowed: boolean,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.patch("/users/registration-allowed", {
      allowed,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "update registration allowed");
  }
}

export async function updatePasswordLoginAllowed(
  allowed: boolean,
): Promise<{ allowed: boolean }> {
  try {
    const response = await authApi.patch("/users/password-login-allowed", {
      allowed,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "update password login allowed");
  }
}

export async function getPasswordResetAllowed(): Promise<boolean> {
  try {
    const response = await authApi.get("/users/password-reset-allowed");
    return response.data.allowed;
  } catch (error) {
    handleApiError(error, "get password reset allowed");
  }
}

export async function updatePasswordResetAllowed(
  allowed: boolean,
): Promise<{ allowed: boolean }> {
  try {
    const response = await authApi.patch("/users/password-reset-allowed", {
      allowed,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "update password reset allowed");
  }
}

export async function updateOIDCConfig(
  config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/users/oidc-config", config);
    return response.data;
  } catch (error) {
    handleApiError(error, "update OIDC config");
  }
}

export async function disableOIDCConfig(): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.delete("/users/oidc-config");
    return response.data;
  } catch (error) {
    handleApiError(error, "disable OIDC config");
  }
}

// ============================================================================
// ALERTS
// ============================================================================

export async function setupTOTP(): Promise<{
  secret: string;
  qr_code: string;
}> {
  try {
    const response = await authApi.post("/users/totp/setup");
    return response.data;
  } catch (error) {
    handleApiError(error as AxiosError, "setup TOTP");
    throw error;
  }
}

export async function enableTOTP(
  totp_code: string,
): Promise<{ message: string; backup_codes: string[] }> {
  try {
    const response = await authApi.post("/users/totp/enable", { totp_code });
    return response.data;
  } catch (error) {
    handleApiError(error as AxiosError, "enable TOTP");
    throw error;
  }
}

export async function disableTOTP(
  password?: string,
  totp_code?: string,
): Promise<{ message: string }> {
  try {
    const response = await authApi.post("/users/totp/disable", {
      password,
      totp_code,
    });
    return response.data;
  } catch (error) {
    handleApiError(error as AxiosError, "disable TOTP");
    throw error;
  }
}

export async function verifyTOTPLogin(
  temp_token: string,
  totp_code: string,
  rememberMe: boolean = false,
): Promise<AuthResponse> {
  try {
    const response = await authApi.post("/users/totp/verify-login", {
      temp_token,
      totp_code,
      rememberMe,
    });

    const isInIframe =
      typeof window !== "undefined" && window.self !== window.top;

    if (isInIframe && isElectron() && response.data.success) {
      try {
        window.parent.postMessage(
          {
            type: "AUTH_SUCCESS",
            source: "totp_verify",
            platform: "desktop",
            timestamp: Date.now(),
          },
          window.location.origin,
        );
      } catch (e) {
        console.error("[main-axios] Error posting message to parent:", e);
      }
    }

    if (response.data.success) {
      markUserAuthenticated();
    }

    return response.data;
  } catch (error) {
    handleApiError(error as AxiosError, "verify TOTP login");
    throw error;
  }
}

export async function generateBackupCodes(
  password?: string,
  totp_code?: string,
): Promise<{ backup_codes: string[] }> {
  try {
    const response = await authApi.post("/users/totp/backup-codes", {
      password,
      totp_code,
    });
    return response.data;
  } catch (error) {
    handleApiError(error as AxiosError, "generate backup codes");
    throw error;
  }
}

export async function getUserAlerts(): Promise<{
  alerts: Array<Record<string, unknown>>;
}> {
  try {
    const response = await authApi.get(`/alerts`);
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch user alerts");
    throw error;
  }
}

export async function dismissAlert(
  alertId: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/alerts/dismiss", { alertId });
    return response.data;
  } catch (error) {
    handleApiError(error, "dismiss alert");
    throw error;
  }
}

// ============================================================================
// UPDATES & RELEASES
// ============================================================================

export async function getReleasesRSS(
  perPage: number = 100,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.get(`/releases/rss?per_page=${perPage}`);
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch releases RSS");
  }
}

export async function getVersionInfo(
  checkRemote = true,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.get(
      `/version${checkRemote ? "" : "?checkRemote=false"}`,
    );
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch version info");
  }
}

// ============================================================================
// DATABASE HEALTH
// ============================================================================

export async function getDatabaseHealth(): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.get("/health");
    return response.data;
  } catch (error) {
    handleApiError(error, "check database health");
  }
}

// ============================================================================
// SSH CREDENTIALS MANAGEMENT
// ============================================================================

export async function getCredentials(): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.get("/credentials");
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch credentials");
  }
}

export async function getCredentialDetails(
  credentialId: number,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.get(`/credentials/${credentialId}`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch credential details");
  }
}

export async function createCredential(
  credentialData: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/credentials", credentialData);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "create credential");
  }
}

export async function updateCredential(
  credentialId: number,
  credentialData: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.put(
      `/credentials/${credentialId}`,
      credentialData,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "update credential");
  }
}

export async function deleteCredential(
  credentialId: number,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.delete(`/credentials/${credentialId}`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "delete credential");
  }
}

export async function getCredentialHosts(
  credentialId: number,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.get(`/credentials/${credentialId}/hosts`);
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch credential hosts");
  }
}

export async function getCredentialFolders(): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.get("/credentials/folders");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch credential folders");
  }
}

export async function getSSHHostWithCredentials(
  hostId: number,
): Promise<Record<string, unknown>> {
  try {
    const response = await sshHostApi.get(
      `/db/host/${hostId}/with-credentials`,
    );
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch SSH host with credentials");
  }
}

export async function getHostPassword(
  hostId: number,
  field: "password" | "sudoPassword" = "password",
): Promise<string | null> {
  try {
    const response = await sshHostApi.get(
      `/db/host/${hostId}/password?field=${field}`,
    );
    return response.data?.value || null;
  } catch {
    return null;
  }
}

export async function applyCredentialToHost(
  hostId: number,
  credentialId: number,
): Promise<Record<string, unknown>> {
  try {
    const response = await sshHostApi.post(
      `/db/host/${hostId}/apply-credential`,
      { credentialId },
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "apply credential to host");
  }
}

export async function removeCredentialFromHost(
  hostId: number,
): Promise<Record<string, unknown>> {
  try {
    const response = await sshHostApi.delete(`/db/host/${hostId}/credential`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "remove credential from host");
  }
}

export async function migrateHostToCredential(
  hostId: number,
  credentialName: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await sshHostApi.post(
      `/db/host/${hostId}/migrate-to-credential`,
      { credentialName },
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "migrate host to credential");
  }
}

// ============================================================================
// SSH FOLDER MANAGEMENT
// ============================================================================

export async function getFoldersWithStats(): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.get("/host/db/folders/with-stats");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch folders with statistics");
  }
}

export async function renameFolder(
  oldName: string,
  newName: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.put("/host/folders/rename", {
      oldName,
      newName,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "rename folder");
  }
}

export async function getSSHFolders(): Promise<SSHFolder[]> {
  try {
    sshLogger.info("Fetching SSH folders", {
      operation: "fetch_ssh_folders",
    });

    const response = await authApi.get("/host/folders");

    sshLogger.success("SSH folders fetched successfully", {
      operation: "fetch_ssh_folders",
      count: response.data.length,
    });

    return response.data;
  } catch (error) {
    sshLogger.error("Failed to fetch SSH folders", error, {
      operation: "fetch_ssh_folders",
    });
    handleApiError(error, "fetch SSH folders");
    throw error;
  }
}

export async function updateFolderMetadata(
  name: string,
  color?: string,
  icon?: string,
): Promise<void> {
  try {
    sshLogger.info("Updating folder metadata", {
      operation: "update_folder_metadata",
      name,
      color,
      icon,
    });

    await authApi.put("/host/folders/metadata", {
      name,
      color,
      icon,
    });

    sshLogger.success("Folder metadata updated successfully", {
      operation: "update_folder_metadata",
      name,
    });
  } catch (error) {
    sshLogger.error("Failed to update folder metadata", error, {
      operation: "update_folder_metadata",
      name,
    });
    handleApiError(error, "update folder metadata");
    throw error;
  }
}

export async function deleteAllHostsInFolder(
  folderName: string,
): Promise<{ deletedCount: number }> {
  try {
    sshLogger.info("Deleting all hosts in folder", {
      operation: "delete_folder_hosts",
      folderName,
    });

    const response = await authApi.delete(
      `/host/folders/${encodeURIComponent(folderName)}/hosts`,
    );

    sshLogger.success("All hosts in folder deleted successfully", {
      operation: "delete_folder_hosts",
      folderName,
      deletedCount: response.data.deletedCount,
    });

    return response.data;
  } catch (error) {
    sshLogger.error("Failed to delete hosts in folder", error, {
      operation: "delete_folder_hosts",
      folderName,
    });
    handleApiError(error, "delete hosts in folder");
    throw error;
  }
}

export async function renameCredentialFolder(
  oldName: string,
  newName: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.put("/credentials/folders/rename", {
      oldName,
      newName,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "rename credential folder");
  }
}

export async function detectKeyType(
  privateKey: string,
  keyPassword?: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/credentials/detect-key-type", {
      privateKey,
      keyPassword,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "detect key type");
  }
}

export async function detectPublicKeyType(
  publicKey: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/credentials/detect-public-key-type", {
      publicKey,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "detect public key type");
  }
}

export async function validateKeyPair(
  privateKey: string,
  publicKey: string,
  keyPassword?: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/credentials/validate-key-pair", {
      privateKey,
      publicKey,
      keyPassword,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "validate key pair");
  }
}

export async function generatePublicKeyFromPrivate(
  privateKey: string,
  keyPassword?: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/credentials/generate-public-key", {
      privateKey,
      keyPassword,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "generate public key from private key");
  }
}

export async function generateKeyPair(
  keyType: "ssh-ed25519" | "ssh-rsa" | "ecdsa-sha2-nistp256",
  keySize?: number,
  passphrase?: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/credentials/generate-key-pair", {
      keyType,
      keySize,
      passphrase,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "generate SSH key pair");
  }
}

export async function deployCredentialToHost(
  credentialId: number,
  targetHostId: number,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post(
      `/credentials/${credentialId}/deploy-to-host`,
      { targetHostId },
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "deploy credential to host");
  }
}

// ============================================================================
// SNIPPETS API
// ============================================================================

export async function getSnippets(): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.get("/snippets");
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch snippets");
  }
}

export async function createSnippet(
  snippetData: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/snippets", snippetData);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "create snippet");
  }
}

export async function updateSnippet(
  snippetId: number,
  snippetData: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.put(`/snippets/${snippetId}`, snippetData);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "update snippet");
  }
}

export async function deleteSnippet(
  snippetId: number,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.delete(`/snippets/${snippetId}`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "delete snippet");
  }
}

export async function executeSnippet(
  snippetId: number,
  hostId: number,
): Promise<{ success: boolean; output: string; error?: string }> {
  try {
    const response = await authApi.post("/snippets/execute", {
      snippetId,
      hostId,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "execute snippet");
  }
}

// ============================================================================
// MISCELLANEOUS API CALLS
// ============================================================================

export interface NetworkTopologyNode {
  data: {
    id: string;
    label?: string;
    ip?: string;
    status?: string;
    tags?: string[];
    parent?: string;
    color?: string;
  };
  position?: { x: number; y: number };
}

export interface NetworkTopologyEdge {
  data: {
    id?: string;
    source: string;
    target: string;
  };
}

export interface NetworkTopologyData {
  nodes: NetworkTopologyNode[];
  edges: NetworkTopologyEdge[];
}

export async function getNetworkTopology(): Promise<NetworkTopologyData | null> {
  try {
    const response = await authApi.get("/network-topology/");
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch network topology");
  }
}

export async function saveNetworkTopology(
  topology: NetworkTopologyData,
): Promise<{ success: boolean }> {
  try {
    const response = await authApi.post("/network-topology/", { topology });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "save network topology");
  }
}

export async function getSnippetFolders(): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.get("/snippets/folders");
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch snippet folders");
  }
}

export async function createSnippetFolder(folderData: {
  name: string;
  color?: string;
  icon?: string;
}): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/snippets/folders", folderData);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "create snippet folder");
  }
}

export async function updateSnippetFolderMetadata(
  folderName: string,
  metadata: { color?: string; icon?: string },
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.put(
      `/snippets/folders/${encodeURIComponent(folderName)}/metadata`,
      metadata,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "update snippet folder metadata");
  }
}

export async function renameSnippetFolder(
  oldName: string,
  newName: string,
): Promise<{ success: boolean; oldName: string; newName: string }> {
  try {
    const response = await authApi.put("/snippets/folders/rename", {
      oldName,
      newName,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "rename snippet folder");
  }
}

export async function deleteSnippetFolder(
  folderName: string,
): Promise<{ success: boolean }> {
  try {
    const response = await authApi.delete(
      `/snippets/folders/${encodeURIComponent(folderName)}`,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "delete snippet folder");
  }
}

export async function reorderSnippets(
  updates: Array<{ id: number; order: number; folder?: string }>,
): Promise<{ success: boolean }> {
  try {
    const response = await authApi.post("/snippets/reorder", {
      snippets: updates,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "reorder snippets");
  }
}

// ============================================================================
// DASHBOARD API
// ============================================================================

export interface UptimeInfo {
  uptimeMs: number;
  uptimeSeconds: number;
  formatted: string;
}

export interface RecentActivityItem {
  id: number;
  userId: string;
  type:
    | "terminal"
    | "file_manager"
    | "server_stats"
    | "tunnel"
    | "docker"
    | "telnet"
    | "vnc"
    | "rdp";
  hostId: number;
  hostName: string;
  timestamp: string;
}

export async function getUptime(): Promise<UptimeInfo> {
  try {
    const response = await dashboardApi.get("/uptime");
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch uptime");
  }
}

export async function getRecentActivity(
  limit?: number,
): Promise<RecentActivityItem[]> {
  try {
    const response = await dashboardApi.get("/activity/recent", {
      params: { limit },
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch recent activity");
  }
}

export async function logActivity(
  type:
    | "terminal"
    | "file_manager"
    | "server_stats"
    | "tunnel"
    | "docker"
    | "rdp"
    | "vnc"
    | "telnet",
  hostId: number,
  hostName: string,
): Promise<{ message: string; id: number | string }> {
  try {
    const response = await dashboardApi.post("/activity/log", {
      type,
      hostId,
      hostName,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "log activity");
  }
}

export async function resetRecentActivity(): Promise<{ message: string }> {
  try {
    const response = await dashboardApi.delete("/activity/reset");
    return response.data;
  } catch (error) {
    throw handleApiError(error, "reset recent activity");
  }
}

// ============================================================================
// COMMAND HISTORY API
// ============================================================================

export async function saveCommandToHistory(
  hostId: number,
  command: string,
): Promise<{ id: number; command: string; executedAt: string }> {
  try {
    const response = await authApi.post("/terminal/command_history", {
      hostId,
      command,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "save command to history");
  }
}

export async function getCommandHistory(
  hostId: number,
  limit: number = 100,
): Promise<string[]> {
  try {
    const response = await authApi.get(`/terminal/command_history/${hostId}`, {
      params: { limit },
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch command history");
  }
}

export async function deleteCommandFromHistory(
  hostId: number,
  command: string,
): Promise<{ success: boolean }> {
  try {
    const response = await authApi.post("/terminal/command_history/delete", {
      hostId,
      command,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "delete command from history");
  }
}

export async function clearCommandHistory(
  hostId: number,
): Promise<{ success: boolean }> {
  try {
    const response = await authApi.delete(
      `/terminal/command_history/${hostId}`,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "clear command history");
  }
}

// ============================================================================
// OIDC ACCOUNT LINKING
// ============================================================================

export async function linkOIDCToPasswordAccount(
  oidcUserId: string,
  targetUsername: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await authApi.post("/users/link-oidc-to-password", {
      oidcUserId,
      targetUsername,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "link OIDC account to password account");
  }
}

export async function unlinkOIDCFromPasswordAccount(
  userId: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await authApi.post("/users/unlink-oidc-from-password", {
      userId,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "unlink OIDC from password account");
  }
}

export interface GuacamoleTokenRequest {
  protocol: "rdp" | "vnc" | "telnet";
  hostname: string;
  port?: number;
  username?: string;
  password?: string;
  domain?: string;
  security?: string;
  ignoreCert?: boolean;
  guacamoleConfig?: {
    colorDepth?: number;
    width?: number;
    height?: number;
    dpi?: number;
    resizeMethod?: string;
    forceLossless?: boolean;
    disableAudio?: boolean;
    enableAudioInput?: boolean;
    enableWallpaper?: boolean;
    enableTheming?: boolean;
    enableFontSmoothing?: boolean;
    enableFullWindowDrag?: boolean;
    enableDesktopComposition?: boolean;
    enableMenuAnimations?: boolean;
    disableBitmapCaching?: boolean;
    disableOffscreenCaching?: boolean;
    disableGlyphCaching?: boolean;
    disableGfx?: boolean;
    enablePrinting?: boolean;
    printerName?: string;
    enableDrive?: boolean;
    driveName?: string;
    drivePath?: string;
    createDrivePath?: boolean;
    disableDownload?: boolean;
    disableUpload?: boolean;
    enableTouch?: boolean;
    clientName?: string;
    console?: boolean;
    initialProgram?: string;
    serverLayout?: string;
    timezone?: string;
    gatewayHostname?: string;
    gatewayPort?: number;
    gatewayUsername?: string;
    gatewayPassword?: string;
    gatewayDomain?: string;
    remoteApp?: string;
    remoteAppDir?: string;
    remoteAppArgs?: string;
    normalizeClipboard?: string;
    disableCopy?: boolean;
    disablePaste?: boolean;
    cursor?: string;
    swapRedBlue?: boolean;
    readOnly?: boolean;
    recordingPath?: string;
    recordingName?: string;
    createRecordingPath?: boolean;
    recordingExcludeOutput?: boolean;
    recordingExcludeMouse?: boolean;
    recordingIncludeKeys?: boolean;
    wolSendPacket?: boolean;
    wolMacAddr?: string;
    wolBroadcastAddr?: string;
    wolUdpPort?: number;
    wolWaitTime?: number;
  };
}

export interface GuacamoleTokenResponse {
  token: string;
}

type GuacamoleConfigSource = {
  guacamoleConfig?: string | Record<string, unknown> | null;
};

export function getGuacamoleDpi(
  source?: GuacamoleConfigSource,
): number | undefined {
  const config = source?.guacamoleConfig;
  if (!config) return undefined;

  let dpi: unknown;
  if (typeof config === "string") {
    try {
      dpi = JSON.parse(config).dpi;
    } catch {
      return undefined;
    }
  } else {
    dpi = config.dpi;
  }

  const parsedDpi = typeof dpi === "string" ? Number(dpi) : dpi;
  if (
    typeof parsedDpi !== "number" ||
    !Number.isFinite(parsedDpi) ||
    parsedDpi <= 0
  ) {
    return undefined;
  }

  return Math.trunc(parsedDpi);
}

function toGuacamoleParams(
  config: GuacamoleTokenRequest["guacamoleConfig"],
): Record<string, unknown> {
  if (!config) return {};

  const params: Record<string, unknown> = {};

  const mappings: Record<string, string> = {
    colorDepth: "color-depth",
    resizeMethod: "resize-method",
    forceLossless: "force-lossless",
    disableAudio: "disable-audio",
    enableAudioInput: "enable-audio-input",
    enableWallpaper: "enable-wallpaper",
    enableTheming: "enable-theming",
    enableFontSmoothing: "enable-font-smoothing",
    enableFullWindowDrag: "enable-full-window-drag",
    enableDesktopComposition: "enable-desktop-composition",
    enableMenuAnimations: "enable-menu-animations",
    disableBitmapCaching: "disable-bitmap-caching",
    disableOffscreenCaching: "disable-offscreen-caching",
    disableGlyphCaching: "disable-glyph-caching",
    disableGfx: "disable-gfx",
    enablePrinting: "enable-printing",
    printerName: "printer-name",
    enableDrive: "enable-drive",
    driveName: "drive-name",
    drivePath: "drive-path",
    createDrivePath: "create-drive-path",
    disableDownload: "disable-download",
    disableUpload: "disable-upload",
    enableTouch: "enable-touch",
    clientName: "client-name",
    initialProgram: "initial-program",
    serverLayout: "server-layout",
    gatewayHostname: "gateway-hostname",
    gatewayPort: "gateway-port",
    gatewayUsername: "gateway-username",
    gatewayPassword: "gateway-password",
    gatewayDomain: "gateway-domain",
    remoteApp: "remote-app",
    remoteAppDir: "remote-app-dir",
    remoteAppArgs: "remote-app-args",
    normalizeClipboard: "normalize-clipboard",
    disableCopy: "disable-copy",
    disablePaste: "disable-paste",
    swapRedBlue: "swap-red-blue",
    readOnly: "read-only",
    recordingPath: "recording-path",
    recordingName: "recording-name",
    createRecordingPath: "create-recording-path",
    recordingExcludeOutput: "recording-exclude-output",
    recordingExcludeMouse: "recording-exclude-mouse",
    recordingIncludeKeys: "recording-include-keys",
    wolSendPacket: "wol-send-packet",
    wolMacAddr: "wol-mac-addr",
    wolBroadcastAddr: "wol-broadcast-addr",
    wolUdpPort: "wol-udp-port",
    wolWaitTime: "wol-wait-time",
  };

  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined && value !== null && value !== "") {
      const paramName = mappings[key] || key;
      if (typeof value === "boolean") {
        params[paramName] = value ? "true" : "false";
      } else {
        params[paramName] = value;
      }
    }
  }

  return params;
}

export async function getGuacamoleToken(
  request: GuacamoleTokenRequest,
): Promise<GuacamoleTokenResponse> {
  try {
    const guacParams = toGuacamoleParams(request.guacamoleConfig);

    const response = await authApi.post("/guacamole/token", {
      type: request.protocol,
      hostname: request.hostname,
      port: request.port,
      username: request.username,
      password: request.password,
      domain: request.domain,
      security: request.security,
      "ignore-cert": request.ignoreCert,
      ...guacParams,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "get guacamole token");
  }
}

export async function getGuacamoleTokenFromHost(
  hostId: number,
): Promise<GuacamoleTokenResponse> {
  try {
    const response = await authApi.post(`/guacamole/connect-host/${hostId}`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "get guacamole token from host");
  }
}

// ============================================================================
// RBAC MANAGEMENT
// ============================================================================

export async function getRoles(): Promise<{ roles: Role[] }> {
  try {
    const response = await rbacApi.get("/rbac/roles");
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch roles");
  }
}

export async function createRole(roleData: {
  name: string;
  displayName: string;
  description?: string | null;
}): Promise<{ role: Role }> {
  try {
    const response = await rbacApi.post("/rbac/roles", roleData);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "create role");
  }
}

export async function updateRole(
  roleId: number,
  roleData: {
    displayName?: string;
    description?: string | null;
  },
): Promise<{ role: Role }> {
  try {
    const response = await rbacApi.put(`/rbac/roles/${roleId}`, roleData);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "update role");
  }
}

export async function deleteRole(
  roleId: number,
): Promise<{ success: boolean }> {
  try {
    const response = await rbacApi.delete(`/rbac/roles/${roleId}`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "delete role");
  }
}

export async function getUserRoles(
  userId: string,
): Promise<{ roles: UserRole[] }> {
  try {
    const response = await rbacApi.get(`/rbac/users/${userId}/roles`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch user roles");
  }
}

export async function assignRoleToUser(
  userId: string,
  roleId: number,
): Promise<{ success: boolean }> {
  try {
    const response = await rbacApi.post(`/rbac/users/${userId}/roles`, {
      roleId,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "assign role to user");
  }
}

export async function removeRoleFromUser(
  userId: string,
  roleId: number,
): Promise<{ success: boolean }> {
  try {
    const response = await rbacApi.delete(
      `/rbac/users/${userId}/roles/${roleId}`,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "remove role from user");
  }
}

export async function shareHost(
  hostId: number,
  shareData: {
    targetType: "user" | "role";
    targetUserId?: string;
    targetRoleId?: number;
    permissionLevel: "view";
    durationHours?: number;
  },
): Promise<{ success: boolean }> {
  try {
    const response = await rbacApi.post(
      `/rbac/host/${hostId}/share`,
      shareData,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "share host");
  }
}

export async function getHostAccess(
  hostId: number,
): Promise<{ accessList: AccessRecord[] }> {
  try {
    const response = await rbacApi.get(`/rbac/host/${hostId}/access`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch host access");
  }
}

export async function revokeHostAccess(
  hostId: number,
  accessId: number,
): Promise<{ success: boolean }> {
  try {
    const response = await rbacApi.delete(
      `/rbac/host/${hostId}/access/${accessId}`,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "revoke host access");
  }
}

// ============================================================================
// SNIPPET SHARING
// ============================================================================

export async function shareSnippet(
  snippetId: number,
  shareData: {
    targetType: "user" | "role";
    targetUserId?: string;
    targetRoleId?: number;
    durationHours?: number;
  },
): Promise<{ success: boolean }> {
  try {
    const response = await rbacApi.post(
      `/rbac/snippet/${snippetId}/share`,
      shareData,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "share snippet");
  }
}

export async function getSnippetAccess(
  snippetId: number,
): Promise<{ accessList: AccessRecord[] }> {
  try {
    const response = await rbacApi.get(`/rbac/snippet/${snippetId}/access`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch snippet access");
  }
}

export async function revokeSnippetAccess(
  snippetId: number,
  accessId: number,
): Promise<{ success: boolean }> {
  try {
    const response = await rbacApi.delete(
      `/rbac/snippet/${snippetId}/access/${accessId}`,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "revoke snippet access");
  }
}

export async function getSharedSnippets(): Promise<{
  sharedSnippets: Array<{
    id: number;
    name: string;
    content: string;
    description: string | null;
    folder: string | null;
    ownerUsername: string;
    permissionLevel: string;
    expiresAt: string | null;
  }>;
}> {
  try {
    const response = await rbacApi.get("/rbac/shared-snippets");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch shared snippets");
  }
}

// ============================================================================
// DOCKER MANAGEMENT API
// ============================================================================

export async function connectDockerSession(
  sessionId: string,
  hostId: number,
  config?: {
    userProvidedPassword?: string;
    userProvidedSshKey?: string;
    userProvidedKeyPassword?: string;
    forceKeyboardInteractive?: boolean;
    useSocks5?: boolean;
    socks5Host?: string;
    socks5Port?: number;
    socks5Username?: string;
    socks5Password?: string;
    socks5ProxyChain?: unknown;
  },
): Promise<{
  success?: boolean;
  message?: string;
  requires_totp?: boolean;
  prompt?: string;
  isPassword?: boolean;
  status?: string;
  reason?: string;
  connectionLogs?: ApiConnectionLog[];
  requires_warpgate?: boolean;
  url?: string;
  securityKey?: string;
}> {
  try {
    const response = await dockerApi.post("/ssh/connect", {
      sessionId,
      hostId,
      ...config,
    });
    return response.data;
  } catch (error: unknown) {
    if (
      axios.isAxiosError<ConnectErrorResponse>(error) &&
      error.response?.data?.status === "auth_required"
    ) {
      return error.response.data;
    }
    if (
      axios.isAxiosError<ConnectErrorResponse>(error) &&
      error.response?.data?.requires_totp
    ) {
      return error.response.data;
    }
    if (
      axios.isAxiosError<ConnectErrorResponse>(error) &&
      error.response?.data?.requires_warpgate
    ) {
      return error.response.data;
    }
    if (
      axios.isAxiosError<ConnectErrorResponse>(error) &&
      error.response?.data?.connectionLogs
    ) {
      const data = error.response.data;
      const errorWithLogs = new Error(
        data.error || data.message || error.message,
      );
      Object.assign(errorWithLogs, {
        connectionLogs: data.connectionLogs,
      });
      throw errorWithLogs;
    }
    throw handleApiError(error, "connect to Docker SSH session");
  }
}

export async function verifyDockerTOTP(
  sessionId: string,
  totpCode: string,
): Promise<{ status: string; message: string }> {
  try {
    const response = await dockerApi.post("/ssh/connect-totp", {
      sessionId,
      totpCode,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "verify Docker TOTP");
  }
}

export async function verifyDockerWarpgate(
  sessionId: string,
): Promise<{ status: string; message: string }> {
  try {
    const response = await dockerApi.post("/ssh/connect-warpgate", {
      sessionId,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "verify Docker Warpgate");
  }
}

export async function disconnectDockerSession(
  sessionId: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await dockerApi.post("/ssh/disconnect", {
      sessionId,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "disconnect from Docker SSH session");
  }
}

export async function keepaliveDockerSession(
  sessionId: string,
): Promise<{ success: boolean }> {
  try {
    const response = await dockerApi.post("/ssh/keepalive", {
      sessionId,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "keepalive Docker SSH session");
  }
}

export async function getDockerSessionStatus(
  sessionId: string,
): Promise<{ success: boolean; connected: boolean }> {
  try {
    const response = await dockerApi.get("/ssh/status", {
      params: { sessionId },
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "get Docker session status");
  }
}

export async function validateDockerAvailability(
  sessionId: string,
): Promise<DockerValidation> {
  try {
    const response = await dockerApi.get(`/validate/${sessionId}`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "validate Docker availability");
  }
}

export async function listDockerContainers(
  sessionId: string,
  all: boolean = true,
): Promise<DockerContainer[]> {
  try {
    const response = await dockerApi.get(`/containers/${sessionId}`, {
      params: { all },
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "list Docker containers");
  }
}

export async function getDockerContainerDetails(
  sessionId: string,
  containerId: string,
): Promise<DockerContainer> {
  try {
    const response = await dockerApi.get(
      `/containers/${sessionId}/${containerId}`,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "get Docker container details");
  }
}

export async function startDockerContainer(
  sessionId: string,
  containerId: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await dockerApi.post(
      `/containers/${sessionId}/${containerId}/start`,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "start Docker container");
  }
}

export async function stopDockerContainer(
  sessionId: string,
  containerId: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await dockerApi.post(
      `/containers/${sessionId}/${containerId}/stop`,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "stop Docker container");
  }
}

export async function restartDockerContainer(
  sessionId: string,
  containerId: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await dockerApi.post(
      `/containers/${sessionId}/${containerId}/restart`,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "restart Docker container");
  }
}

export async function pauseDockerContainer(
  sessionId: string,
  containerId: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await dockerApi.post(
      `/containers/${sessionId}/${containerId}/pause`,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "pause Docker container");
  }
}

export async function unpauseDockerContainer(
  sessionId: string,
  containerId: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await dockerApi.post(
      `/containers/${sessionId}/${containerId}/unpause`,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "unpause Docker container");
  }
}

export async function removeDockerContainer(
  sessionId: string,
  containerId: string,
  force: boolean = false,
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await dockerApi.delete(
      `/containers/${sessionId}/${containerId}/remove`,
      {
        params: { force },
      },
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "remove Docker container");
  }
}

export async function getContainerLogs(
  sessionId: string,
  containerId: string,
  options?: DockerLogOptions,
): Promise<{ logs: string }> {
  try {
    const response = await dockerApi.get(
      `/containers/${sessionId}/${containerId}/logs`,
      {
        params: options,
      },
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "get container logs");
  }
}

export async function downloadContainerLogs(
  sessionId: string,
  containerId: string,
  options?: DockerLogOptions,
): Promise<Blob> {
  try {
    const response = await dockerApi.get(
      `/containers/${sessionId}/${containerId}/logs`,
      {
        params: { ...options, download: true },
        responseType: "blob",
      },
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "download container logs");
  }
}

export async function getContainerStats(
  sessionId: string,
  containerId: string,
): Promise<DockerStats> {
  try {
    const response = await dockerApi.get(
      `/containers/${sessionId}/${containerId}/stats`,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "get container stats");
  }
}

export interface DashboardLayout {
  cards: Array<{ id: string; enabled: boolean; order: number }>;
}

export async function getDashboardPreferences(): Promise<DashboardLayout> {
  const response = await dashboardApi.get("/dashboard/preferences");
  return response.data;
}

export async function saveDashboardPreferences(
  layout: DashboardLayout,
): Promise<{ success: boolean }> {
  const response = await dashboardApi.post("/dashboard/preferences", layout);
  return response.data;
}
