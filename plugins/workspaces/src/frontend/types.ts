import type { ShellLayout } from "@termix/plugin-sdk/frontend";

export type WorkspaceKind = "manual" | "last_session";

/** A saved workspace as the routes return it. */
export interface Workspace {
  id: number;
  userId: string;
  name: string;
  color: string | null;
  icon: string | null;
  kind: WorkspaceKind;
  isDefault: boolean;
  /** Whatever app.tabs.getLayout returned when it was saved. */
  payload: ShellLayout & { tabs?: unknown[] };
  syncId: string | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  tabCount: number;
}

/** The server's error text when it sent one, else the error's own message. */
export function errorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { error?: unknown } } })
    ?.response?.data;
  if (typeof data?.error === "string") return data.error;
  return "";
}
