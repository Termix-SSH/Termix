import type { FileItem, SSHHost } from "./host-types";
import type { LogEntry } from "@termix/plugin-sdk/ui";

export interface FileManagerProps {
  initialHost?: SSHHost | null;
  initialFilePath?: string;
  initialPath?: string;
  onClose?: () => void;
  onOpenTerminalTab?: (path?: string) => void;
  /** When false, pause keepalive while the tab stays mounted in the background. */
  isVisible?: boolean;
}

export type ConnectionLogPayload = Omit<LogEntry, "id" | "timestamp">;

export type SSHConnectionError = Error & {
  connectionLogs?: ConnectionLogPayload[];
  requires_totp?: boolean;
  requires_browser_sign_in?: boolean;
  sessionId?: string;
  prompt?: string;
  url?: string;
  code?: string;
  label?: string;
  status?: string;
  reason?: "no_keyboard" | "auth_failed" | "timeout";
};

export interface CreateIntent {
  id: string;
  type: "file" | "directory";
  defaultName: string;
  currentName: string;
}

export type PendingSudoOperation =
  { type: "delete"; files: FileItem[] } | { type: "navigate"; path: string };
