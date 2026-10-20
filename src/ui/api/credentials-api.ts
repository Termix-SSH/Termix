import { authApi, handleApiError, sshHostApi } from "@/main-axios";
import type { SSHFolder } from "@/types/index";
import { sshLogger } from "@/lib/frontend-logger";
import {
  getCachedSSHFolders,
  invalidateSSHFoldersCache,
  invalidateHostsAndStatusCaches,
} from "@/lib/hosts-request-cache";

export async function getCredentials(): Promise<
  Record<string, unknown>[] | Record<string, unknown>
> {
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

export async function duplicateCredential(
  credentialId: number,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post(
      `/credentials/${credentialId}/duplicate`,
      data,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "duplicate credential");
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
  field: "password" | "sudoPassword" | "key" | "keyPassword" = "password",
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
    invalidateSSHFoldersCache();
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

    const folders = await getCachedSSHFolders(async () => {
      const response = await authApi.get("/host/folders");
      return response.data;
    });

    sshLogger.success("SSH folders fetched successfully", {
      operation: "fetch_ssh_folders",
      count: folders.length,
    });

    return folders;
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
  credentialId?: number | null,
  localOnly?: boolean,
): Promise<void> {
  try {
    sshLogger.info("Updating folder metadata", {
      operation: "update_folder_metadata",
      name,
      color,
      icon,
      credentialId,
    });

    await authApi.put("/host/folders/metadata", {
      name,
      color,
      icon,
      credentialId,
      localOnly,
    });

    invalidateSSHFoldersCache();

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

export async function reorderFolders(
  positions: { name: string; sortOrder: number }[],
): Promise<{ updated: number }> {
  try {
    const response = await authApi.put("/host/folders/reorder", {
      positions,
    });
    invalidateSSHFoldersCache();
    return response.data;
  } catch (error) {
    handleApiError(error, "reorder folders");
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

    invalidateHostsAndStatusCaches();

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
    invalidateSSHFoldersCache();
    return response.data;
  } catch (error) {
    throw handleApiError(error, "rename credential folder");
  }
}

export async function reorderCredentials(
  positions: { id: number; sortOrder: number }[],
): Promise<{ updated: number }> {
  try {
    const response = await authApi.put("/credentials/reorder", {
      positions,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "reorder credentials");
    throw error;
  }
}
