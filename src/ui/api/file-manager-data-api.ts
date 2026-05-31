import { authApi, handleApiError } from "@/main-axios";

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
