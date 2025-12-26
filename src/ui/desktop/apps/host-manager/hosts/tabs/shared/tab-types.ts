import type {
  Control,
  UseFormWatch,
  UseFormSetValue,
  UseFormGetValues,
} from "react-hook-form";
import type { SSHHost, Credential } from "@/types";

/**
 * Minimal props for simple tabs (Docker, File Manager)
 */
export interface MinimalTabProps<TFormData = any> {
  control: Control<TFormData>;
  t: (key: string, params?: any) => string;
}

/**
 * Base props that all HostManager tabs receive
 */
export interface BaseHostTabProps<TFormData = any> {
  // Form integration
  control: Control<TFormData>;
  watch: UseFormWatch<TFormData>;
  setValue: UseFormSetValue<TFormData>;
  getValues: UseFormGetValues<TFormData>;

  // Shared state (read-only for tabs)
  hosts: SSHHost[];
  credentials: Credential[];
  folders: string[];
  snippets: Array<{ id: number; name: string; content: string }>;

  // Theme context
  editorTheme: any; // CodeMirror theme

  // Translation
  t: (key: string, params?: any) => string;

  // Current editing context
  editingHost?: SSHHost | null;
}

/**
 * Props for tabs that need tab state management
 */
export interface TabWithStateProps<
  TFormData = any,
> extends BaseHostTabProps<TFormData> {
  // Tab-specific state setters (for nested tabs like auth)
  activeAuthTab?: "password" | "key" | "credential" | "none";
  onAuthTabChange?: (tab: "password" | "key" | "credential" | "none") => void;
}

/**
 * Props for tabs that need conditional rendering based on form state
 */
export interface ConditionalTabProps<
  TFormData = any,
> extends BaseHostTabProps<TFormData> {
  // For tabs that show/hide content based on form.watch()
  isNewHost: boolean;
}

/**
 * Props for the Docker tab
 */
export interface HostDockerTabProps extends MinimalTabProps {}

/**
 * Props for the File Manager tab
 */
export interface HostFileManagerTabProps {
  control: Control<any>;
  watch: UseFormWatch<any>;
  t: (key: string, params?: any) => string;
}

/**
 * Props for the Tunnel tab
 */
export interface HostTunnelTabProps {
  control: Control<any>;
  watch: UseFormWatch<any>;
  setValue: UseFormSetValue<any>;
  getValues: UseFormGetValues<any>;
  sshConfigurations: string[];
  editingHost?: SSHHost | null;
  t: (key: string, params?: any) => string;
}

/**
 * Props for the Statistics tab
 */
export interface HostStatisticsTabProps {
  control: Control<any>;
  watch: UseFormWatch<any>;
  setValue: UseFormSetValue<any>;
  statusIntervalUnit: "seconds" | "minutes";
  setStatusIntervalUnit: (unit: "seconds" | "minutes") => void;
  metricsIntervalUnit: "seconds" | "minutes";
  setMetricsIntervalUnit: (unit: "seconds" | "minutes") => void;
  t: (key: string, params?: any) => string;
}

/**
 * Props for the Terminal tab
 */
export interface HostTerminalTabProps {
  control: Control<any>;
  watch: UseFormWatch<any>;
  setValue: UseFormSetValue<any>;
  snippets: Array<{ id: number; name: string; content: string }>;
  editorTheme: any;
  t: (key: string, params?: any) => string;
}

/**
 * Props for the General tab
 */
export interface HostGeneralTabProps extends BaseHostTabProps {
  // Auth state
  authTab: "password" | "key" | "credential" | "none";
  setAuthTab: (tab: "password" | "key" | "credential" | "none") => void;
  keyInputMethod: "upload" | "paste";
  setKeyInputMethod: (method: "upload" | "paste") => void;

  // Proxy mode state
  proxyMode: "single" | "chain";
  setProxyMode: (mode: "single" | "chain") => void;

  // Ref for IP input focus
  ipInputRef?: React.RefObject<HTMLInputElement>;
}

/**
 * Props for the Authentication Section (nested in General tab)
 */
export interface HostAuthenticationSectionProps {
  control: Control<any>;
  watch: UseFormWatch<any>;
  setValue: UseFormSetValue<any>;
  credentials: Credential[];
  authTab: "password" | "key" | "credential" | "none";
  setAuthTab: (tab: "password" | "key" | "credential" | "none") => void;
  keyInputMethod: "upload" | "paste";
  setKeyInputMethod: (method: "upload" | "paste") => void;
  editorTheme: any;
  editingHost?: SSHHost | null;
  t: (key: string, params?: any) => string;
}

/**
 * Props for JumpHostItem component
 */
export interface JumpHostItemProps {
  jumpHost: { hostId: number };
  index: number;
  hosts: SSHHost[];
  editingHost?: SSHHost | null;
  onUpdate: (hostId: number) => void;
  onRemove: () => void;
  t: (key: string) => string;
}

/**
 * Props for QuickActionItem component
 */
export interface QuickActionItemProps {
  quickAction: { name: string; snippetId: number };
  index: number;
  snippets: Array<{ id: number; name: string; content: string }>;
  onUpdate: (name: string, snippetId: number) => void;
  onRemove: () => void;
  t: (key: string) => string;
}
