import type { UseFormReturn } from "react-hook-form";
import type React from "react";
import type { SSHHost, Credential } from "@/types";

export interface HostGeneralTabProps {
  form: UseFormReturn<FormData>;
  authTab: "password" | "key" | "credential" | "none";
  setAuthTab: (value: "password" | "key" | "credential" | "none") => void;
  keyInputMethod: "upload" | "paste";
  setKeyInputMethod: (value: "upload" | "paste") => void;
  proxyMode: "single" | "chain";
  setProxyMode: (value: "single" | "chain") => void;
  tagInput: string;
  setTagInput: (value: string) => void;
  folderDropdownOpen: boolean;
  setFolderDropdownOpen: (value: boolean) => void;
  folderInputRef: React.RefObject<HTMLInputElement>;
  folderDropdownRef: React.RefObject<HTMLDivElement>;
  filteredFolders: string[];
  handleFolderClick: (folder: string) => void;
  keyTypeDropdownOpen: boolean;
  setKeyTypeDropdownOpen: (value: boolean) => void;
  keyTypeButtonRef: React.RefObject<HTMLButtonElement>;
  keyTypeDropdownRef: React.RefObject<HTMLDivElement>;
  keyTypeOptions: Array<{ value: string; label: string }>;
  ipInputRef: React.RefObject<HTMLInputElement>;
  editorTheme: unknown;
  hosts: SSHHost[];
  editingHost?: SSHHost | null;
  folders: string[];
  credentials: Credential[];
  t: (key: string) => string;
}

export interface HostTerminalTabProps {
  form: UseFormReturn<FormData>;
  snippets: Array<{ id: number; name: string; content: string }>;
  t: (key: string) => string;
}

export interface HostDockerTabProps {
  form: UseFormReturn<FormData>;
  t: (key: string) => string;
}

export interface HostTunnelTabProps {
  form: UseFormReturn<FormData>;
  sshConfigDropdownOpen: { [key: number]: boolean };
  setSshConfigDropdownOpen: React.Dispatch<
    React.SetStateAction<{ [key: number]: boolean }>
  >;
  sshConfigInputRefs: React.MutableRefObject<{
    [key: number]: HTMLInputElement | null;
  }>;
  sshConfigDropdownRefs: React.MutableRefObject<{
    [key: number]: HTMLDivElement | null;
  }>;
  getFilteredSshConfigs: (index: number) => string[];
  handleSshConfigClick: (config: string, index: number) => void;
  t: (key: string) => string;
}

export interface HostFileManagerTabProps {
  form: UseFormReturn<FormData>;
  t: (key: string) => string;
}

export interface HostStatisticsTabProps {
  form: UseFormReturn<FormData>;
  statusIntervalUnit: "seconds" | "minutes";
  setStatusIntervalUnit: (value: "seconds" | "minutes") => void;
  metricsIntervalUnit: "seconds" | "minutes";
  setMetricsIntervalUnit: (value: "seconds" | "minutes") => void;
  snippets: Array<{ id: number; name: string; content: string }>;
  t: (key: string) => string;
}

export interface HostSharingTabProps {
  hostId: number | undefined;
  isNewHost: boolean;
}

export interface JumpHostItemProps {
  jumpHost: { hostId: number };
  index: number;
  hosts: SSHHost[];
  editingHost?: SSHHost | null;
  onUpdate: (hostId: number) => void;
  onRemove: () => void;
  t: (key: string) => string;
}

export interface QuickActionItemProps {
  quickAction: { name: string; snippetId: number };
  index: number;
  snippets: Array<{ id: number; name: string; content: string }>;
  onUpdate: (name: string, snippetId: number) => void;
  onRemove: () => void;
  t: (key: string) => string;
}
