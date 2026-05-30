import { authApi, handleApiError } from "@/main-axios";

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
    const response = await authApi.put("/snippets/reorder", {
      snippets: updates,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "reorder snippets");
  }
}
