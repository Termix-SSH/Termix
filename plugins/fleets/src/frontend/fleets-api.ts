import type { PluginApiClient } from "@termix/plugin-sdk/frontend";

export type SharePermissionLevel = "connect" | "view" | "edit" | "manage";

export interface ShareTarget {
  type: "user" | "role";
  id: string | number;
}

export interface ShareableUser {
  id: string;
  username: string;
}

export interface ShareableRole {
  id: number;
  name: string;
  displayName: string | null;
}

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
  permissionLevel: SharePermissionLevel | null;
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

export interface FleetShareHostResult {
  hostId: number;
  shared: boolean;
  reason?: string;
}

export interface FleetShareResult {
  success: boolean;
  permissionLevel: SharePermissionLevel;
  expiresAt: string | null;
  hostsShared: number;
  hostsTotal: number;
  hostResults: FleetShareHostResult[];
}

/**
 * The fleets routes, through the plugin's own client. Paths are relative to
 * /plugin-api/fleets/, which the client already points at.
 */
export function createFleetsApi(api: PluginApiClient) {
  const data = async <T>(request: Promise<{ data: T }>) => (await request).data;

  return {
    list: () => data(api.get<FleetRow[]>("/")),

    create: (fleetData: {
      name: string;
      description?: string | null;
      color?: string | null;
      icon?: string | null;
      tagRules?: string[];
    }) => data(api.post<FleetRow>("/", fleetData)),

    update: (
      fleetId: number,
      fleetData: {
        name?: string;
        description?: string | null;
        color?: string | null;
        icon?: string | null;
        tagRules?: string[];
      },
    ) => data(api.patch<FleetRow>(`/${fleetId}`, fleetData)),

    remove: (fleetId: number) =>
      data(api.delete<{ success: boolean }>(`/${fleetId}`)),

    members: (fleetId: number) =>
      data(api.get<FleetMemberRow[]>(`/${fleetId}/members`)),

    addMember: (fleetId: number, hostId: number) =>
      data(api.post<{ success: boolean }>(`/${fleetId}/members`, { hostId })),

    removeMember: (fleetId: number, hostId: number) =>
      data(api.delete<{ success: boolean }>(`/${fleetId}/members/${hostId}`)),

    runCommand: (
      fleetId: number,
      command: string,
      inputValues?: Record<string, string>,
    ) =>
      data(
        api.post<{ results: FleetHostResult[] }>(`/${fleetId}/execute`, {
          command,
          ...(inputValues ? { inputValues } : {}),
        }),
      ),

    pushFile: async (fleetId: number, file: File, remotePath: string) => {
      const form = new FormData();
      form.append("file", file);
      form.append("remotePath", remotePath);
      return data(
        api.post<{ results: FleetHostResult[] }>(
          `/${fleetId}/transfer/push`,
          form,
          { headers: { "Content-Type": "multipart/form-data" } },
        ),
      );
    },

    pullFile: async (
      fleetId: number,
      remotePath: string,
    ): Promise<{
      results: FleetHostResult[];
      blob: Blob;
      fileName: string;
    }> => {
      const response = await api.post<Blob>(
        `/${fleetId}/transfer/pull`,
        { remotePath },
        { responseType: "blob" },
      );
      const headers = (response as { headers?: Record<string, string> })
        .headers;
      const resultsHeader = headers?.["x-fleet-transfer-results"];
      const results: FleetHostResult[] = resultsHeader
        ? JSON.parse(atob(resultsHeader))
        : [];
      const disposition = headers?.["content-disposition"];
      const match = disposition?.match(/filename="([^"]+)"/);
      const fileName = match?.[1] ?? "fleet-transfer.zip";
      return { results, blob: response.data, fileName };
    },

    inventory: (fleetId: number) =>
      data(api.get<FleetInventoryEntry[]>(`/${fleetId}/inventory`)),

    refreshInventory: (fleetId: number) =>
      data(api.post<{ results: FleetHostResult[] }>(`/${fleetId}/inventory`)),

    runPackageAction: (
      fleetId: number,
      action: FleetPackageAction,
      packageName?: string,
    ) =>
      data(
        api.post<{ results: FleetHostResult[] }>(`/${fleetId}/packages`, {
          action,
          ...(packageName ? { package: packageName } : {}),
        }),
      ),

    share: (
      fleetId: number,
      shareData: {
        targets: ShareTarget[];
        permissionLevel: SharePermissionLevel;
        durationHours?: number;
      },
    ) => data(api.post<FleetShareResult>(`/${fleetId}/share`, shareData)),

    shareTargetUsers: () =>
      data(api.get<{ users: ShareableUser[] }>("/share-targets/users")),

    shareTargetRoles: () =>
      data(api.get<{ roles: ShareableRole[] }>("/share-targets/roles")),
  };
}

export type FleetsApi = ReturnType<typeof createFleetsApi>;
