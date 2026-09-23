export const FOLDER_ICONS = [
  "folder",
  "server",
  "cloud",
  "database",
  "box",
  "network",
  "copy",
  "settings",
  "cpu",
  "globe",
] as const;
export type FolderIconId = (typeof FOLDER_ICONS)[number];

export interface Snippet {
  id: number;
  userId: string;
  name: string;
  content: string;
  description: string | null;
  folder: string | null;
  order: number;
  hostFilter: string | null;
  isNote: boolean;
  isShared?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SnippetFolder {
  id: number;
  userId: string;
  name: string;
  color: string | null;
  icon: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SnippetAccessEntry {
  id: number;
  targetType: "user" | "role";
  userId: string | null;
  roleId: number | null;
  username: string | null;
  roleName: string | null;
  roleDisplayName: string | null;
  grantedBy: string;
  grantedByUsername: string | null;
  permissionLevel: string;
  expiresAt: string | null;
  createdAt: string;
}

export function errorMessage(error: unknown, fallback: string): string {
  if (
    error &&
    typeof error === "object" &&
    "response" in error &&
    error.response &&
    typeof error.response === "object" &&
    "data" in error.response &&
    error.response.data &&
    typeof error.response.data === "object" &&
    "error" in error.response.data &&
    typeof error.response.data.error === "string"
  ) {
    return error.response.data.error;
  }
  return fallback;
}
