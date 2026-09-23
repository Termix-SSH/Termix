import type { PluginApiClient } from "@termix/plugin-sdk/frontend";
import type { Snippet, SnippetAccessEntry, SnippetFolder } from "./types";

export interface NewSnippetInput {
  name: string;
  content: string;
  description?: string | null;
  folder?: string | null;
  order?: number | null;
  hostFilter?: unknown;
  isNote?: boolean;
}

export interface SnippetUpdateInput {
  name?: string;
  content?: string;
  description?: string | null;
  folder?: string | null;
  order?: number;
  hostFilter?: unknown;
  isNote?: boolean;
}

export interface SnippetReorderUpdate {
  id: number;
  order: number;
  folder?: string;
}

export interface SnippetExecutionResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface SnippetShareInput {
  targetType: "user" | "role";
  targetUserId?: string;
  targetRoleId?: number;
  expiresAt?: string | null;
}

/**
 * The snippets routes, through the plugin's own client. Paths are relative
 * to /plugin-api/snippets/, which the client already points at.
 */
export function createSnippetsApi(api: PluginApiClient) {
  const data = async <T>(request: Promise<{ data: T }>) => (await request).data;

  return {
    list: () => data(api.get<Snippet[]>("/")),
    get: (id: number) => data(api.get<Snippet>(`/${id}`)),
    create: (body: NewSnippetInput) => data(api.post<Snippet>("/", body)),
    update: (id: number, body: SnippetUpdateInput) =>
      data(api.put<Snippet>(`/${id}`, body)),
    remove: (id: number) => data(api.delete<{ success: boolean }>(`/${id}`)),
    execute: (
      snippetId: number,
      hostId: number,
      inputValues?: Record<string, string>,
    ) =>
      data(
        api.post<SnippetExecutionResult>("/execute", {
          snippetId,
          hostId,
          inputValues,
        }),
      ),
    reorder: (updates: SnippetReorderUpdate[]) =>
      data(api.put<{ success: boolean }>("/reorder", { snippets: updates })),
    export: () =>
      data(api.get<{ snippets: unknown[]; folders: unknown[] }>("/export")),
    bulkImport: (body: {
      snippets?: unknown[];
      folders?: unknown[];
      overwrite?: boolean;
    }) => data(api.post<{ success: boolean }>("/bulk-import", body)),

    listFolders: () => data(api.get<SnippetFolder[]>("/folders")),
    createFolder: (body: {
      name: string;
      color?: string | null;
      icon?: string | null;
    }) => data(api.post<SnippetFolder>("/folders", body)),
    updateFolderMetadata: (
      name: string,
      body: { color?: string | null; icon?: string | null },
    ) =>
      data(
        api.put<SnippetFolder>(
          `/folders/${encodeURIComponent(name)}/metadata`,
          body,
        ),
      ),
    renameFolder: (oldName: string, newName: string) =>
      data(
        api.put<{ success: boolean }>("/folders/rename", { oldName, newName }),
      ),
    deleteFolder: (name: string) =>
      data(
        api.delete<{ success: boolean }>(
          `/folders/${encodeURIComponent(name)}`,
        ),
      ),

    share: (snippetId: number, body: SnippetShareInput) =>
      data(api.post<{ success: boolean }>(`/${snippetId}/share`, body)),
    shareFolder: (folder: string, body: SnippetShareInput) =>
      data(
        api.put<{ success: boolean; snippetsShared: number }>("/folder/share", {
          folder,
          ...body,
        }),
      ),
    getAccess: (snippetId: number) =>
      data(api.get<SnippetAccessEntry[]>(`/${snippetId}/access`)),
    revokeAccess: (snippetId: number, accessId: number) =>
      data(
        api.delete<{ success: boolean }>(`/${snippetId}/access/${accessId}`),
      ),
    listShared: () => data(api.get<{ sharedSnippets: Snippet[] }>("/shared")),
  };
}

export type SnippetsApi = ReturnType<typeof createSnippetsApi>;
