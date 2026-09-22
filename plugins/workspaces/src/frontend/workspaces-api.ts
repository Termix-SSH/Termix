import { authApi, handleApiError } from "@/main-axios";
import type { Workspace, WorkspacePayload } from "@/types/ui-types";

export async function listWorkspaces(): Promise<Workspace[]> {
  try {
    const response = await authApi.get("/workspaces");
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch workspaces");
  }
}

export async function createWorkspace(data: {
  name: string;
  color?: string | null;
  icon?: string | null;
  payload: WorkspacePayload;
}): Promise<Workspace> {
  try {
    const response = await authApi.post("/workspaces", data);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "create workspace");
  }
}

export async function renameWorkspace(
  id: number,
  data: { name?: string; color?: string | null; icon?: string | null },
): Promise<Workspace> {
  try {
    const response = await authApi.patch(`/workspaces/${id}`, data);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "update workspace");
  }
}

export async function updateWorkspaceContent(
  id: number,
  payload: WorkspacePayload,
): Promise<Workspace> {
  try {
    const response = await authApi.put(`/workspaces/${id}/content`, {
      payload,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "update workspace content");
  }
}

export async function deleteWorkspace(
  id: number,
): Promise<{ success: boolean }> {
  try {
    const response = await authApi.delete(`/workspaces/${id}`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "delete workspace");
  }
}

export async function duplicateWorkspace(
  id: number,
  name: string,
): Promise<Workspace> {
  try {
    const response = await authApi.post(`/workspaces/${id}/duplicate`, {
      name,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "duplicate workspace");
  }
}

export async function setDefaultWorkspace(id: number): Promise<Workspace> {
  try {
    const response = await authApi.post(`/workspaces/${id}/set-default`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "set default workspace");
  }
}

export async function unsetDefaultWorkspace(id: number): Promise<Workspace> {
  try {
    const response = await authApi.post(`/workspaces/${id}/unset-default`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "unset default workspace");
  }
}

export async function applyWorkspaceServer(id: number): Promise<Workspace> {
  try {
    const response = await authApi.post(`/workspaces/${id}/apply`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "apply workspace");
  }
}

export async function getLastSessionWorkspace(): Promise<Workspace | null> {
  try {
    const response = await authApi.get("/workspaces/last-session");
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch last session workspace");
  }
}

export async function saveLastSessionWorkspace(
  payload: WorkspacePayload,
): Promise<Workspace> {
  try {
    const response = await authApi.put("/workspaces/last-session", {
      payload,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "save last session workspace");
  }
}
