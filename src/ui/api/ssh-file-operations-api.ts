import axios from "axios";
import { authApi, fileManagerApi, handleApiError } from "@/main-axios";
import { fileLogger } from "@/lib/frontend-logger";
import type { SSHHost } from "@/types/index";

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

export async function downloadSSHFileStream(
  sessionId: string,
  filePath: string,
): Promise<void> {
  const response = await fileManagerApi.post(
    "/ssh/downloadFileStream",
    { sessionId, path: filePath },
    { responseType: "blob" },
  );
  const blob = response.data as Blob;
  const fileName = filePath.split("/").pop() || "download";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
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

export type HostConnectionState =
  | "disconnected"
  | "connecting"
  | "ready"
  | "auth_required"
  | "error";

export interface EnsureSSHSessionResult {
  state: HostConnectionState;
  sessionId?: string;
  error?: string;
}

export async function ensureSSHSessionForHost(
  host: SSHHost,
): Promise<EnsureSSHSessionResult> {
  const sessionId = host.id.toString();
  try {
    const status = await getSSHStatus(sessionId);
    if (status?.connected) {
      return { state: "ready", sessionId };
    }
  } catch {
    // not connected — fall through to connect
  }

  try {
    const result = await connectSSH(sessionId, {
      hostId: host.id,
      ip: host.ip,
      port: host.port,
      username: host.username,
      password: host.password,
      sshKey: host.key,
      keyPassword: host.keyPassword,
      authType: host.authType,
      credentialId: host.credentialId,
      userId: host.userId,
      forceKeyboardInteractive: host.forceKeyboardInteractive,
      jumpHosts: host.jumpHosts,
      useSocks5: host.useSocks5,
      socks5Host: host.socks5Host,
      socks5Port: host.socks5Port,
      socks5Username: host.socks5Username,
      socks5Password: host.socks5Password,
      socks5ProxyChain: host.socks5ProxyChain,
    });

    if (
      result?.requires_totp ||
      result?.requires_warpgate ||
      result?.status === "auth_required"
    ) {
      return { state: "auth_required", sessionId };
    }

    return { state: "ready", sessionId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Connection failed";
    return { state: "error", error: message };
  }
}

export interface BrowseSSHDirectoryResult {
  status: "ok" | "not_found" | "error";
  path: string;
  files: Array<{ name: string; type: "file" | "directory" | "link" }>;
}

export async function browseSSHDirectory(
  sessionId: string,
  path: string,
): Promise<BrowseSSHDirectoryResult> {
  try {
    const result = await listSSHFiles(sessionId, path);
    return {
      status: "ok",
      path: result.path,
      files: result.files as Array<{
        name: string;
        type: "file" | "directory" | "link";
      }>,
    };
  } catch (err) {
    const status =
      (err as { response?: { status?: number } })?.response?.status === 404
        ? "not_found"
        : "error";
    return { status, path, files: [] };
  }
}
