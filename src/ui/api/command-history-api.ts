import { authApi, handleApiError } from "@/main-axios";

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
