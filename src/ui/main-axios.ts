import axios, { AxiosError, type AxiosInstance } from "axios";
import type {
  SSHHost,
  SSHHostData,
  TunnelConfig,
  TunnelStatus,
  Credential,
  CredentialData,
  HostInfo,
  ApiResponse,
  FileManagerFile,
  FileManagerShortcut,
} from "../types/index.js";
import {
  apiLogger,
  authLogger,
  sshLogger,
  tunnelLogger,
  fileLogger,
  statsLogger,
  systemLogger,
  type LogContext,
} from "../lib/frontend-logger.js";

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
}

export type ServerMetrics = {
  cpu: CpuMetrics;
  memory: MemoryMetrics;
  disk: DiskMetrics;
  lastChecked: string;
};

interface AuthResponse {
  token: string;
  success?: boolean;
  is_admin?: boolean;
  username?: string;
  userId?: string;
  is_oidc?: boolean;
  totp_enabled?: boolean;
  data_unlocked?: boolean;
}

interface UserInfo {
  totp_enabled: boolean;
  userId: string;
  username: string;
  is_admin: boolean;
  is_oidc: boolean;
  data_unlocked: boolean;
}

interface UserCount {
  count: number;
}

interface OIDCAuthorize {
  auth_url: string;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export function isElectron(): boolean {
  return (
    (window as any).IS_ELECTRON === true ||
    (window as any).electronAPI?.isElectron === true
  );
}

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
  } else {
    return apiLogger;
  }
}

export function setCookie(name: string, value: string, days = 7): void {
  if (isElectron()) {
    localStorage.setItem(name, value);
  } else {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
  }
}

export function getCookie(name: string): string | undefined {
  if (isElectron()) {
    const token = localStorage.getItem(name) || undefined;
    return token;
  } else {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    const encodedToken =
      parts.length === 2 ? parts.pop()?.split(";").shift() : undefined;
    const token = encodedToken ? decodeURIComponent(encodedToken) : undefined;
    return token;
  }
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

  instance.interceptors.request.use((config) => {
    const startTime = performance.now();
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    (config as any).startTime = startTime;
    (config as any).requestId = requestId;

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

    if (process.env.NODE_ENV === "development") {
      logger.requestStart(method, fullUrl, context);
    }

    if (isElectron()) {
      config.headers["X-Electron-App"] = "true";

      const token = localStorage.getItem("jwt");
      if (token) {
        config.headers["Authorization"] = `Bearer ${token}`;
      }
    }

    return config;
  });

  instance.interceptors.response.use(
    (response) => {
      const endTime = performance.now();
      const startTime = (response.config as any).startTime;
      const requestId = (response.config as any).requestId;
      const responseTime = Math.round(endTime - startTime);

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

      return response;
    },
    (error: AxiosError) => {
      const endTime = performance.now();
      const startTime = (error.config as any)?.startTime;
      const requestId = (error.config as any)?.requestId;
      const responseTime = startTime
        ? Math.round(endTime - startTime)
        : undefined;

      const method = error.config?.method?.toUpperCase() || "UNKNOWN";
      const url = error.config?.url || "UNKNOWN";
      const fullUrl = error.config ? `${error.config.baseURL}${url}` : url;
      const status = error.response?.status;
      const message =
        (error.response?.data as any)?.error ||
        (error as Error).message ||
        "Unknown error";
      const errorCode = (error.response?.data as any)?.code || error.code;

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

      if (process.env.NODE_ENV === "development") {
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
        const errorCode = (error.response?.data as any)?.code;
        const isSessionExpired = errorCode === "SESSION_EXPIRED";

        if (isElectron()) {
          localStorage.removeItem("jwt");
        } else {
          localStorage.removeItem("jwt");
        }

        if (isSessionExpired && typeof window !== "undefined") {
          console.warn("Session expired - please log in again");

          import("sonner").then(({ toast }) => {
            toast.warning("Session expired - please log in again");
          });

          setTimeout(() => window.location.reload(), 100);
        }
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

let apiHost = import.meta.env.VITE_API_HOST || "localhost";
let apiPort = 30001;
let configuredServerUrl: string | null = null;

if (isElectron()) {
  apiPort = 30001;
}

export interface ServerConfig {
  serverUrl: string;
  lastUpdated: string;
}

export async function getServerConfig(): Promise<ServerConfig | null> {
  if (!isElectron()) return null;

  try {
    const result = await (window as any).electronAPI?.invoke(
      "get-server-config",
    );
    return result;
  } catch (error) {
    console.error("Failed to get server config:", error);
    return null;
  }
}

export async function saveServerConfig(config: ServerConfig): Promise<boolean> {
  if (!isElectron()) return false;

  try {
    const result = await (window as any).electronAPI?.invoke(
      "save-server-config",
      config,
    );
    if (result?.success) {
      configuredServerUrl = config.serverUrl;
      (window as any).configuredServerUrl = configuredServerUrl;
      updateApiInstances();
      return true;
    }
    return false;
  } catch (error) {
    console.error("Failed to save server config:", error);
    return false;
  }
}

export async function testServerConnection(
  serverUrl: string,
): Promise<{ success: boolean; error?: string }> {
  if (!isElectron())
    return { success: false, error: "Not in Electron environment" };

  try {
    const result = await (window as any).electronAPI?.invoke(
      "test-server-connection",
      serverUrl,
    );
    return result;
  } catch (error) {
    console.error("Failed to test server connection:", error);
    return { success: false, error: "Connection test failed" };
  }
}

export async function checkElectronUpdate(): Promise<{
  success: boolean;
  status?: "up_to_date" | "requires_update";
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
    const result = await (window as any).electronAPI?.invoke(
      "check-electron-update",
    );
    return result;
  } catch (error) {
    console.error("Failed to check Electron update:", error);
    return { success: false, error: "Update check failed" };
  }
}

function getApiUrl(path: string, defaultPort: number): string {
  if (isDev()) {
    const protocol = window.location.protocol === "https:" ? "https" : "http";
    const sslPort = protocol === "https" ? 8443 : defaultPort;
    return `${protocol}://${apiHost}:${sslPort}${path}`;
  } else if (isElectron()) {
    if (configuredServerUrl) {
      const baseUrl = configuredServerUrl.replace(/\/$/, "");
      return `${baseUrl}${path}`;
    }
    return "http://no-server-configured";
  } else {
    return path;
  }
}

function initializeApiInstances() {
  // SSH Host Management API (port 30001)
  sshHostApi = createApiInstance(getApiUrl("/ssh", 30001), "SSH_HOST");

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
}

// SSH Host Management API (port 30001)
export let sshHostApi: AxiosInstance;

// Tunnel Management API (port 30003)
export let tunnelApi: AxiosInstance;

// File Manager Operations API (port 30004)
export let fileManagerApi: AxiosInstance;

// Server Statistics API (port 30005)
export let statsApi: AxiosInstance;

// Authentication API (port 30001)
export let authApi: AxiosInstance;

if (isElectron()) {
  getServerConfig()
    .then((config) => {
      if (config?.serverUrl) {
        configuredServerUrl = config.serverUrl;
        (window as any).configuredServerUrl = configuredServerUrl;
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

function updateApiInstances() {
  systemLogger.info("Updating API instances with new server configuration", {
    operation: "api_instance_update",
    configuredServerUrl,
  });

  initializeApiInstances();

  (window as any).configuredServerUrl = configuredServerUrl;

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
    const message = error.response?.data?.error || error.message;
    const code = error.response?.data?.code;
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

      throw new ApiError(errorMessage, 401, "AUTH_REQUIRED");
    } else if (status === 403) {
      authLogger.warn(`Access denied: ${method} ${url}`, errorContext);
      throw new ApiError(
        "Access denied. You do not have permission to perform this action.",
        403,
        "ACCESS_DENIED",
      );
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

export async function getSSHHosts(): Promise<SSHHost[]> {
  try {
    const response = await sshHostApi.get("/db/host");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch SSH hosts");
  }
}

export async function createSSHHost(hostData: SSHHostData): Promise<SSHHost> {
  try {
    const submitData = {
      name: hostData.name || "",
      ip: hostData.ip,
      port: parseInt(hostData.port.toString()) || 22,
      username: hostData.username,
      folder: hostData.folder || "",
      tags: hostData.tags || [],
      pin: Boolean(hostData.pin),
      authType: hostData.authType,
      password: hostData.authType === "password" ? hostData.password : null,
      key: hostData.authType === "key" ? hostData.key : null,
      keyPassword: hostData.authType === "key" ? hostData.keyPassword : null,
      keyType: hostData.authType === "key" ? hostData.keyType : null,
      credentialId:
        hostData.authType === "credential" ? hostData.credentialId : null,
      enableTerminal: Boolean(hostData.enableTerminal),
      enableTunnel: Boolean(hostData.enableTunnel),
      enableFileManager: Boolean(hostData.enableFileManager),
      defaultPath: hostData.defaultPath || "/",
      tunnelConnections: hostData.tunnelConnections || [],
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
    handleApiError(error, "create SSH host");
  }
}

export async function updateSSHHost(
  hostId: number,
  hostData: SSHHostData,
): Promise<SSHHost> {
  try {
    const submitData = {
      name: hostData.name || "",
      ip: hostData.ip,
      port: parseInt(hostData.port.toString()) || 22,
      username: hostData.username,
      folder: hostData.folder || "",
      tags: hostData.tags || [],
      pin: Boolean(hostData.pin),
      authType: hostData.authType,
      password: hostData.authType === "password" ? hostData.password : null,
      key: hostData.authType === "key" ? hostData.key : null,
      keyPassword: hostData.authType === "key" ? hostData.keyPassword : null,
      keyType: hostData.authType === "key" ? hostData.keyType : null,
      credentialId:
        hostData.authType === "credential" ? hostData.credentialId : null,
      enableTerminal: Boolean(hostData.enableTerminal),
      enableTunnel: Boolean(hostData.enableTunnel),
      enableFileManager: Boolean(hostData.enableFileManager),
      defaultPath: hostData.defaultPath || "/",
      tunnelConnections: hostData.tunnelConnections || [],
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
    handleApiError(error, "update SSH host");
  }
}

export async function bulkImportSSHHosts(hosts: SSHHostData[]): Promise<{
  message: string;
  success: number;
  failed: number;
  errors: string[];
}> {
  try {
    const response = await sshHostApi.post("/bulk-import", { hosts });
    return response.data;
  } catch (error) {
    handleApiError(error, "bulk import SSH hosts");
  }
}

export async function deleteSSHHost(hostId: number): Promise<any> {
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

// ============================================================================
// SSH AUTOSTART MANAGEMENT
// ============================================================================

export async function enableAutoStart(sshConfigId: number): Promise<any> {
  try {
    const response = await sshHostApi.post("/autostart/enable", {
      sshConfigId,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "enable autostart");
  }
}

export async function disableAutoStart(sshConfigId: number): Promise<any> {
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

export async function getTunnelStatusByName(
  tunnelName: string,
): Promise<TunnelStatus | undefined> {
  const statuses = await getTunnelStatuses();
  return statuses[tunnelName];
}

export async function connectTunnel(tunnelConfig: TunnelConfig): Promise<any> {
  try {
    const response = await tunnelApi.post("/tunnel/connect", tunnelConfig);
    return response.data;
  } catch (error) {
    handleApiError(error, "connect tunnel");
  }
}

export async function disconnectTunnel(tunnelName: string): Promise<any> {
  try {
    const response = await tunnelApi.post("/tunnel/disconnect", { tunnelName });
    return response.data;
  } catch (error) {
    handleApiError(error, "disconnect tunnel");
  }
}

export async function cancelTunnel(tunnelName: string): Promise<any> {
  try {
    const response = await tunnelApi.post("/tunnel/cancel", { tunnelName });
    return response.data;
  } catch (error) {
    handleApiError(error, "cancel tunnel");
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
  } catch (error) {
    return [];
  }
}

export async function addFileManagerRecent(
  file: FileManagerOperation,
): Promise<any> {
  try {
    const response = await sshHostApi.post("/file_manager/recent", file);
    return response.data;
  } catch (error) {
    handleApiError(error, "add recent file");
  }
}

export async function removeFileManagerRecent(
  file: FileManagerOperation,
): Promise<any> {
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
  } catch (error) {
    return [];
  }
}

export async function addFileManagerPinned(
  file: FileManagerOperation,
): Promise<any> {
  try {
    const response = await sshHostApi.post("/file_manager/pinned", file);
    return response.data;
  } catch (error) {
    handleApiError(error, "add pinned file");
  }
}

export async function removeFileManagerPinned(
  file: FileManagerOperation,
): Promise<any> {
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
  } catch (error) {
    return [];
  }
}

export async function addFileManagerShortcut(
  shortcut: FileManagerOperation,
): Promise<any> {
  try {
    const response = await sshHostApi.post("/file_manager/shortcuts", shortcut);
    return response.data;
  } catch (error) {
    handleApiError(error, "add shortcut");
  }
}

export async function removeFileManagerShortcut(
  shortcut: FileManagerOperation,
): Promise<any> {
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
  },
): Promise<any> {
  try {
    const response = await fileManagerApi.post("/ssh/connect", {
      sessionId,
      ...config,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "connect SSH");
  }
}

export async function disconnectSSH(sessionId: string): Promise<any> {
  try {
    const response = await fileManagerApi.post("/ssh/disconnect", {
      sessionId,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "disconnect SSH");
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

export async function keepSSHAlive(sessionId: string): Promise<any> {
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
): Promise<{ files: any[]; path: string }> {
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

export async function readSSHFile(
  sessionId: string,
  path: string,
): Promise<{ content: string; path: string }> {
  try {
    const response = await fileManagerApi.get("/ssh/readFile", {
      params: { sessionId, path },
    });
    return response.data;
  } catch (error: any) {
    if (error.response?.status === 404) {
      const customError = new Error("File not found");
      (customError as any).response = error.response;
      (customError as any).isFileNotFound =
        error.response.data?.fileNotFound || true;
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
): Promise<any> {
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
): Promise<any> {
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
): Promise<any> {
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
): Promise<any> {
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
): Promise<any> {
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
): Promise<any> {
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

export async function copySSHItem(
  sessionId: string,
  sourcePath: string,
  targetDir: string,
  hostId?: number,
  userId?: string,
): Promise<any> {
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
): Promise<any> {
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
): Promise<any> {
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

// ============================================================================
// FILE MANAGER DATA
// ============================================================================

// Recent Files
export async function getRecentFiles(hostId: number): Promise<any> {
  try {
    const response = await authApi.get("/ssh/file_manager/recent", {
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
): Promise<any> {
  try {
    const response = await authApi.post("/ssh/file_manager/recent", {
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
): Promise<any> {
  try {
    const response = await authApi.delete("/ssh/file_manager/recent", {
      data: { hostId, path },
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "remove recent file");
    throw error;
  }
}

export async function getPinnedFiles(hostId: number): Promise<any> {
  try {
    const response = await authApi.get("/ssh/file_manager/pinned", {
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
): Promise<any> {
  try {
    const response = await authApi.post("/ssh/file_manager/pinned", {
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
): Promise<any> {
  try {
    const response = await authApi.delete("/ssh/file_manager/pinned", {
      data: { hostId, path },
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "remove pinned file");
    throw error;
  }
}

export async function getFolderShortcuts(hostId: number): Promise<any> {
  try {
    const response = await authApi.get("/ssh/file_manager/shortcuts", {
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
): Promise<any> {
  try {
    const response = await authApi.post("/ssh/file_manager/shortcuts", {
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
): Promise<any> {
  try {
    const response = await authApi.delete("/ssh/file_manager/shortcuts", {
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

export async function getAllServerStatuses(): Promise<
  Record<number, ServerStatus>
> {
  try {
    const response = await statsApi.get("/status");
    return response.data || {};
  } catch (error) {
    handleApiError(error, "fetch server statuses");
  }
}

export async function getServerStatusById(id: number): Promise<ServerStatus> {
  try {
    const response = await statsApi.get(`/status/${id}`);
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch server status");
  }
}

export async function getServerMetricsById(id: number): Promise<ServerMetrics> {
  try {
    const response = await statsApi.get(`/metrics/${id}`);
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch server metrics");
  }
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

export async function registerUser(
  username: string,
  password: string,
): Promise<any> {
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
): Promise<AuthResponse> {
  try {
    const response = await authApi.post("/users/login", { username, password });

    if (isElectron() && response.data.token) {
      localStorage.setItem("jwt", response.data.token);
    }

    return {
      token: response.data.token || "cookie-based",
      success: response.data.success,
      is_admin: response.data.is_admin,
      username: response.data.username,
      requires_totp: response.data.requires_totp,
      temp_token: response.data.temp_token,
    };
  } catch (error) {
    handleApiError(error, "login user");
  }
}

export async function logoutUser(): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    const response = await authApi.post("/users/logout");
    return response.data;
  } catch (error) {
    handleApiError(error, "logout user");
  }
}

export async function getUserInfo(): Promise<UserInfo> {
  try {
    const response = await authApi.get("/users/me");
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

export async function getOIDCConfig(): Promise<any> {
  try {
    const response = await authApi.get("/users/oidc-config");
    return response.data;
  } catch (error: any) {
    console.warn(
      "Failed to fetch OIDC config:",
      error.response?.data?.error || error.message,
    );
    return null;
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

export async function initiatePasswordReset(username: string): Promise<any> {
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
): Promise<any> {
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
): Promise<any> {
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

export async function getOIDCAuthorizeUrl(): Promise<OIDCAuthorize> {
  try {
    const response = await authApi.get("/users/oidc/authorize");
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

export async function makeUserAdmin(username: string): Promise<any> {
  try {
    const response = await authApi.post("/users/make-admin", { username });
    return response.data;
  } catch (error) {
    handleApiError(error, "make user admin");
  }
}

export async function removeAdminStatus(username: string): Promise<any> {
  try {
    const response = await authApi.post("/users/remove-admin", { username });
    return response.data;
  } catch (error) {
    handleApiError(error, "remove admin status");
  }
}

export async function deleteUser(username: string): Promise<any> {
  try {
    const response = await authApi.delete("/users/delete-user", {
      data: { username },
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "delete user");
  }
}

export async function deleteAccount(password: string): Promise<any> {
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
): Promise<any> {
  try {
    const response = await authApi.patch("/users/registration-allowed", {
      allowed,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "update registration allowed");
  }
}

export async function updateOIDCConfig(config: any): Promise<any> {
  try {
    const response = await authApi.post("/users/oidc-config", config);
    return response.data;
  } catch (error) {
    handleApiError(error, "update OIDC config");
  }
}

export async function disableOIDCConfig(): Promise<any> {
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
): Promise<AuthResponse> {
  try {
    const response = await authApi.post("/users/totp/verify-login", {
      temp_token,
      totp_code,
    });
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

export async function getUserAlerts(): Promise<{ alerts: any[] }> {
  try {
    const response = await authApi.get(`/alerts`);
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch user alerts");
  }
}

export async function dismissAlert(alertId: string): Promise<any> {
  try {
    const response = await authApi.post("/alerts/dismiss", { alertId });
    return response.data;
  } catch (error) {
    handleApiError(error, "dismiss alert");
  }
}

// ============================================================================
// UPDATES & RELEASES
// ============================================================================

export async function getReleasesRSS(perPage: number = 100): Promise<any> {
  try {
    const response = await authApi.get(`/releases/rss?per_page=${perPage}`);
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch releases RSS");
  }
}

export async function getVersionInfo(): Promise<any> {
  try {
    const response = await authApi.get("/version");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch version info");
  }
}

// ============================================================================
// DATABASE HEALTH
// ============================================================================

export async function getDatabaseHealth(): Promise<any> {
  try {
    const response = await authApi.get("/users/db-health");
    return response.data;
  } catch (error) {
    handleApiError(error, "check database health");
  }
}

// ============================================================================
// SSH CREDENTIALS MANAGEMENT
// ============================================================================

export async function getCredentials(): Promise<any> {
  try {
    const response = await authApi.get("/credentials");
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch credentials");
  }
}

export async function getCredentialDetails(credentialId: number): Promise<any> {
  try {
    const response = await authApi.get(`/credentials/${credentialId}`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch credential details");
  }
}

export async function createCredential(credentialData: any): Promise<any> {
  try {
    const response = await authApi.post("/credentials", credentialData);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "create credential");
  }
}

export async function updateCredential(
  credentialId: number,
  credentialData: any,
): Promise<any> {
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

export async function deleteCredential(credentialId: number): Promise<any> {
  try {
    const response = await authApi.delete(`/credentials/${credentialId}`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "delete credential");
  }
}

export async function getCredentialHosts(credentialId: number): Promise<any> {
  try {
    const response = await authApi.get(`/credentials/${credentialId}/hosts`);
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch credential hosts");
  }
}

export async function getCredentialFolders(): Promise<any> {
  try {
    const response = await authApi.get("/credentials/folders");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch credential folders");
  }
}

export async function getSSHHostWithCredentials(hostId: number): Promise<any> {
  try {
    const response = await sshHostApi.get(
      `/db/host/${hostId}/with-credentials`,
    );
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch SSH host with credentials");
  }
}

export async function applyCredentialToHost(
  hostId: number,
  credentialId: number,
): Promise<any> {
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

export async function removeCredentialFromHost(hostId: number): Promise<any> {
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
): Promise<any> {
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

export async function getFoldersWithStats(): Promise<any> {
  try {
    const response = await authApi.get("/ssh/db/folders/with-stats");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch folders with statistics");
  }
}

export async function renameFolder(
  oldName: string,
  newName: string,
): Promise<any> {
  try {
    const response = await authApi.put("/ssh/folders/rename", {
      oldName,
      newName,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "rename folder");
  }
}

export async function renameCredentialFolder(
  oldName: string,
  newName: string,
): Promise<any> {
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
): Promise<any> {
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

export async function detectPublicKeyType(publicKey: string): Promise<any> {
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
): Promise<any> {
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
): Promise<any> {
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
): Promise<any> {
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
): Promise<any> {
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
