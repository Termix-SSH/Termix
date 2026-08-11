import { authApi, handleApiError } from "@/main-axios";

export interface FleetRow {
  id: number;
  userId: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  tagRules: string[];
  syncId: string | null;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
}

export interface FleetMemberRow {
  id: number;
  name: string;
  ip: string;
  tags: string[];
  static: boolean;
  permissionLevel: "connect" | "view" | "edit" | "manage" | null;
}

export interface FleetHostResult {
  hostId: number;
  hostName: string;
  success: boolean;
  output?: string;
  error?: string;
}

export interface FleetInventoryRecord {
  id: number;
  hostId: number;
  userId: string;
  osPrettyName: string | null;
  kernel: string | null;
  architecture: string | null;
  hostname: string | null;
  uptimeSeconds: number | null;
  ip: string | null;
  packageManager: string | null;
  collectedAt: string;
}

export interface FleetInventoryEntry {
  hostId: number;
  hostName: string;
  inventory: FleetInventoryRecord | null;
}

export type FleetPackageAction = "install" | "remove" | "upgrade-all";

export async function listFleets(): Promise<FleetRow[]> {
  try {
    const response = await authApi.get("/fleets");
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch fleets");
  }
}

export async function createFleet(fleetData: {
  name: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  tagRules?: string[];
}): Promise<FleetRow> {
  try {
    const response = await authApi.post("/fleets", fleetData);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "create fleet");
  }
}

export async function updateFleet(
  fleetId: number,
  fleetData: {
    name?: string;
    description?: string | null;
    color?: string | null;
    icon?: string | null;
    tagRules?: string[];
  },
): Promise<FleetRow> {
  try {
    const response = await authApi.patch(`/fleets/${fleetId}`, fleetData);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "update fleet");
  }
}

export async function deleteFleet(
  fleetId: number,
): Promise<{ success: boolean }> {
  try {
    const response = await authApi.delete(`/fleets/${fleetId}`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "delete fleet");
  }
}

export async function getFleetMembers(
  fleetId: number,
): Promise<FleetMemberRow[]> {
  try {
    const response = await authApi.get(`/fleets/${fleetId}/members`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch fleet members");
  }
}

export async function addFleetMember(
  fleetId: number,
  hostId: number,
): Promise<{ success: boolean }> {
  try {
    const response = await authApi.post(`/fleets/${fleetId}/members`, {
      hostId,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "add fleet member");
  }
}

export async function removeFleetMember(
  fleetId: number,
  hostId: number,
): Promise<{ success: boolean }> {
  try {
    const response = await authApi.delete(
      `/fleets/${fleetId}/members/${hostId}`,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "remove fleet member");
  }
}

export async function shareFleet(
  fleetId: number,
  shareData: {
    targets: Array<{ type: "user" | "role"; id: string | number }>;
    permissionLevel?: "connect" | "view" | "edit" | "manage";
    durationHours?: number;
  },
): Promise<{
  success: boolean;
  permissionLevel: string;
  expiresAt: string | null;
  hostsShared: number;
  hostsTotal: number;
}> {
  try {
    const response = await authApi.post(`/fleets/${fleetId}/share`, shareData);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "share fleet");
  }
}

export async function runFleetCommand(
  fleetId: number,
  command: string,
  inputValues?: Record<string, string>,
): Promise<{ results: FleetHostResult[] }> {
  try {
    const response = await authApi.post(`/fleets/${fleetId}/execute`, {
      command,
      ...(inputValues ? { inputValues } : {}),
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "run fleet command");
  }
}

export async function pushFleetFile(
  fleetId: number,
  file: File,
  remotePath: string,
): Promise<{ results: FleetHostResult[] }> {
  try {
    const form = new FormData();
    form.append("file", file);
    form.append("remotePath", remotePath);
    const response = await authApi.post(
      `/fleets/${fleetId}/transfer/push`,
      form,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "push file to fleet");
  }
}

export async function pullFleetFile(
  fleetId: number,
  remotePath: string,
): Promise<{ results: FleetHostResult[]; blob: Blob; fileName: string }> {
  try {
    const response = await authApi.post(
      `/fleets/${fleetId}/transfer/pull`,
      { remotePath },
      { responseType: "blob" },
    );

    const resultsHeader = response.headers["x-fleet-transfer-results"];
    const results: FleetHostResult[] = resultsHeader
      ? JSON.parse(atob(resultsHeader))
      : [];

    const disposition = response.headers["content-disposition"] as
      string | undefined;
    const match = disposition?.match(/filename="([^"]+)"/);
    const fileName = match?.[1] ?? "fleet-transfer.zip";

    return { results, blob: response.data, fileName };
  } catch (error) {
    throw handleApiError(error, "pull file from fleet");
  }
}

export async function getFleetInventory(
  fleetId: number,
): Promise<FleetInventoryEntry[]> {
  try {
    const response = await authApi.get(`/fleets/${fleetId}/inventory`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch fleet inventory");
  }
}

export async function refreshFleetInventory(
  fleetId: number,
): Promise<{ results: FleetHostResult[] }> {
  try {
    const response = await authApi.post(`/fleets/${fleetId}/inventory`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "refresh fleet inventory");
  }
}

export async function runFleetPackageAction(
  fleetId: number,
  action: FleetPackageAction,
  packageName?: string,
): Promise<{ results: FleetHostResult[] }> {
  try {
    const response = await authApi.post(`/fleets/${fleetId}/packages`, {
      action,
      ...(packageName ? { package: packageName } : {}),
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "run fleet package action");
  }
}
