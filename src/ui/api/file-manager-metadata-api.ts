import { handleApiError, sshHostApi } from "@/main-axios";
import type { FileManagerFile, FileManagerShortcut } from "@/types/index";

interface FileManagerOperation {
  name: string;
  path: string;
  isSSH: boolean;
  sshSessionId?: string;
  hostId: number;
}

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
