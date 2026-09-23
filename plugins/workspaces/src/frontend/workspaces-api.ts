import type { PluginApiClient, ShellLayout } from "@termix/plugin-sdk/frontend";
import type { Workspace } from "./types";

/**
 * The workspace routes, through the plugin's own client. Paths are relative
 * to /plugin-api/workspaces/, which the client already points at.
 */
export function createWorkspacesApi(api: PluginApiClient) {
  const data = async <T>(request: Promise<{ data: T }>) => (await request).data;

  return {
    list: () => data(api.get<Workspace[]>("/")),
    create: (body: {
      name: string;
      color?: string | null;
      icon?: string | null;
      payload: ShellLayout;
    }) => data(api.post<Workspace>("/", body)),
    rename: (
      id: number,
      body: { name?: string; color?: string | null; icon?: string | null },
    ) => data(api.patch<Workspace>(`/${id}`, body)),
    updateContent: (id: number, payload: ShellLayout) =>
      data(api.put<Workspace>(`/${id}/content`, { payload })),
    remove: (id: number) => data(api.delete<{ success: boolean }>(`/${id}`)),
    duplicate: (id: number, name: string) =>
      data(api.post<Workspace>(`/${id}/duplicate`, { name })),
    setDefault: (id: number) => data(api.post<Workspace>(`/${id}/set-default`)),
    unsetDefault: (id: number) =>
      data(api.post<Workspace>(`/${id}/unset-default`)),
    apply: (id: number) => data(api.post<Workspace>(`/${id}/apply`)),
    getLastSession: () => data(api.get<Workspace | null>("/last-session")),
    saveLastSession: (payload: ShellLayout) =>
      data(api.put<Workspace>("/last-session", { payload })),
  };
}

export type WorkspacesApi = ReturnType<typeof createWorkspacesApi>;
