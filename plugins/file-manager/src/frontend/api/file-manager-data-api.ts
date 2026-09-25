import { fileManagerApi, handleApiError } from "./client";

/** Row shape shared by the recent / pinned / shortcut list endpoints. */
export interface FileManagerEntry {
  id: number;
  name: string;
  path: string;
  lastOpened?: string;
  [key: string]: unknown;
}

// FILE MANAGER DATA
// ============================================================================

export async function getRecentFiles(
  hostId: number,
): Promise<FileManagerEntry[]> {
  try {
    const response = await fileManagerApi().get("/recent", {
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
    const response = await fileManagerApi().post("/recent", {
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
    const response = await fileManagerApi().delete("/recent", {
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
): Promise<FileManagerEntry[]> {
  try {
    const response = await fileManagerApi().get("/pinned", {
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
    const response = await fileManagerApi().post("/pinned", {
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
    const response = await fileManagerApi().delete("/pinned", {
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
): Promise<FileManagerEntry[]> {
  try {
    const response = await fileManagerApi().get("/shortcuts", {
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
    const response = await fileManagerApi().post("/shortcuts", {
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
    const response = await fileManagerApi().delete("/shortcuts", {
      data: { hostId, path },
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "remove folder shortcut");
    throw error;
  }
}

// ============================================================================
