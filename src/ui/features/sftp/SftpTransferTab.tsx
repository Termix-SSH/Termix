import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  ArrowLeftRight,
  ChevronDown,
  File as FileIcon,
  Folder,
  FolderOpen,
  HardDrive,
  RefreshCw,
  Server,
  Upload,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/alert-dialog";
import { Button } from "@/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog";
import { Input } from "@/components/input";
import { Label } from "@/components/label";
import {
  browseSSHDirectory,
  changeSSHPermissions,
  createSSHFolder,
  deleteSSHItem,
  ensureSSHSessionForHost,
  getSSHHosts,
  listSSHFiles,
  readSSHFile,
  renameSSHItem,
  transferToHost,
  uploadSSHFile,
  type HostConnectionState,
} from "@/main-axios";
import type { SSHHost } from "@/types";
import type { LocalCollectedFile, LocalFileEntry } from "@/types/electron";
import { PermissionsDialog } from "@/features/file-manager/components/PermissionsDialog";
import { beginTransferProgressMonitoring } from "@/features/file-manager/transferProgressMonitor";
import {
  buildLocalUploadTargets,
  getRequiredRemoteDirectories,
  hasSameHostTransferConflict,
  joinRemotePath,
  normalizeRemoteDir,
} from "./sftp-transfer-utils";
import { Select2 } from "@/components/select2";

type TransferMode = "local-server" | "server-server";
type EntryType = "file" | "directory" | "link" | "other";
type PaneId = "local" | "source" | "dest";
type DragPayload =
  | { kind: "local"; paths: string[] }
  | {
      kind: "remote";
      paths: string[];
      sourceHostId: string;
      sourceSessionId: string;
    };

interface BrowserEntry {
  name: string;
  path: string;
  type: EntryType;
  size?: number;
  modified?: string;
  permissions?: string;
  owner?: string;
  group?: string;
}

interface LocalPaneState {
  path: string;
  parent: string;
  entries: BrowserEntry[];
  loading: boolean;
  error: string | null;
}

interface RemotePaneState {
  hostId: string;
  sessionId: string | null;
  connectionState: HostConnectionState;
  error: string | null;
  path: string;
  entries: BrowserEntry[];
  selectedPaths: Set<string>;
  loading: boolean;
}

interface ContextMenuState {
  x: number;
  y: number;
  paneId: PaneId;
  entry?: BrowserEntry;
}

interface NameDialogState {
  kind: "rename" | "mkdir";
  paneId: PaneId;
  entry?: BrowserEntry;
  value: string;
}

interface PermissionsTarget {
  paneId: PaneId;
  entry: BrowserEntry;
}

const defaultLocalPane = (): LocalPaneState => ({
  path: "",
  parent: "",
  entries: [],
  loading: false,
  error: null,
});

const defaultRemotePane = (): RemotePaneState => ({
  hostId: "",
  sessionId: null,
  connectionState: "disconnected",
  error: null,
  path: "/",
  entries: [],
  selectedPaths: new Set(),
  loading: false,
});

function formatSize(size?: number): string {
  if (!size) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value < 10 && index > 0 ? value.toFixed(1) : Math.round(value)} ${units[index]}`;
}

function parentRemotePath(remotePath: string): string {
  const normalized = normalizeRemoteDir(remotePath);
  if (normalized === "/") return "/";
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "/" : normalized.slice(0, index);
}

function base64ToFile(data: string, fileName: string): File {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new File([bytes], fileName);
}

function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function connectionLabel(state: HostConnectionState): string {
  switch (state) {
    case "ready":
      return "Ready";
    case "connecting":
      return "Connecting";
    case "auth_required":
      return "Authentication required";
    case "error":
      return "Connection failed";
    default:
      return "Disconnected";
  }
}

function FileRow({
  entry,
  selected,
  onToggle,
  onOpen,
  draggable = false,
  onDragStart,
  onDragEnd,
  onDropPayload,
  acceptsDrop,
  onContextMenu,
}: {
  entry: BrowserEntry;
  selected: boolean;
  onToggle: () => void;
  onOpen?: () => void;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDropPayload?: () => void;
  acceptsDrop?: boolean;
  onContextMenu?: (
    event: MouseEvent<HTMLDivElement>,
    entry: BrowserEntry,
  ) => void;
}) {
  const Icon = entry.type === "directory" ? Folder : FileIcon;
  const canDrop = entry.type === "directory" && !!onDropPayload && acceptsDrop;
  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_5rem] items-center border-b border-border/70 text-xs ${
        selected ? "bg-accent-brand/10 text-accent-brand" : "hover:bg-muted/50"
      }`}
      draggable={draggable}
      onDragStart={(event) => {
        if (!draggable || !onDragStart) return;
        event.dataTransfer.effectAllowed = "copyMove";
        event.dataTransfer.setData("text/plain", entry.path);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        if (!canDrop) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        if (!canDrop) return;
        event.preventDefault();
        event.stopPropagation();
        onDropPayload();
      }}
      onContextMenu={(event) => onContextMenu?.(event, entry)}
    >
      <button
        type="button"
        className="flex min-w-0 items-center gap-2 px-3 py-2 text-left"
        onClick={onToggle}
        onDoubleClick={entry.type === "directory" ? onOpen : undefined}
      >
        <Icon
          className={`size-3.5 shrink-0 ${
            entry.type === "directory"
              ? "text-yellow-500"
              : "text-muted-foreground"
          }`}
        />
        <span className="truncate font-medium" title={entry.path}>
          {entry.name}
        </span>
      </button>
      <div className="flex items-center justify-end gap-2 px-3 py-2 text-[10px] text-muted-foreground">
        {entry.type === "directory" && onOpen ? (
          <button
            type="button"
            className="font-bold uppercase tracking-widest hover:text-accent-brand"
            onClick={onOpen}
          >
            Open
          </button>
        ) : (
          <span>{formatSize(entry.size)}</span>
        )}
      </div>
    </div>
  );
}

function ContextMenuButton({
  children,
  disabled,
  onClick,
}: {
  children: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="w-full px-3 py-2 text-left text-xs hover:bg-muted disabled:cursor-not-allowed disabled:text-muted-foreground/50 disabled:hover:bg-transparent"
      onClick={(event) => {
        event.stopPropagation();
        if (!disabled) onClick();
      }}
    >
      {children}
    </button>
  );
}

function LocalPane({
  pane,
  setPane,
  loadPath,
  selectedPaths,
  setSelectedPaths,
  onDragStart,
  onDragEnd,
  onPaneContextMenu,
  onEntryContextMenu,
}: {
  pane: LocalPaneState;
  setPane: (updater: (pane: LocalPaneState) => LocalPaneState) => void;
  loadPath: (path: string) => Promise<void>;
  selectedPaths: Set<string>;
  setSelectedPaths: (paths: Set<string>) => void;
  onDragStart: (paths: string[]) => void;
  onDragEnd: () => void;
  onPaneContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  onEntryContextMenu: (
    event: MouseEvent<HTMLDivElement>,
    entry: BrowserEntry,
  ) => void;
}) {
  const electronApi = window.electronAPI;
  const electronReady = !!electronApi?.listLocalDirectory;

  const toggle = (entryPath: string) => {
    const next = new Set(selectedPaths);
    if (next.has(entryPath)) next.delete(entryPath);
    else next.add(entryPath);
    setSelectedPaths(next);
  };

  const getDragPaths = (entryPath: string): string[] => {
    if (selectedPaths.has(entryPath) && selectedPaths.size > 0) {
      return [...selectedPaths];
    }
    setSelectedPaths(new Set([entryPath]));
    return [entryPath];
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <HardDrive className="size-4 text-accent-brand" />
          <span className="text-xs font-bold uppercase tracking-widest">
            Local
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-none"
            disabled={!electronReady || !pane.parent || pane.parent === pane.path}
            onClick={() => void loadPath(pane.parent)}
          >
            <FolderOpen className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-none"
            disabled={!electronReady || pane.loading}
            onClick={() => void loadPath(pane.path)}
          >
            <RefreshCw
              className={`size-3.5 ${pane.loading ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Input
          value={pane.path}
          onChange={(event) =>
            setPane((current) => ({ ...current, path: event.target.value }))
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") void loadPath(pane.path);
          }}
          disabled={!electronReady}
          className="h-8 rounded-none border-border bg-muted/40 font-mono text-xs"
        />
      </div>
      {pane.error ? (
        <div className="p-3 text-xs text-red-400">{pane.error}</div>
      ) : (
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          onContextMenu={onPaneContextMenu}
        >
          {pane.entries.length === 0 && !pane.loading ? (
            <div className="p-3 text-xs text-muted-foreground">No files</div>
          ) : (
            pane.entries.map((entry) => (
              <FileRow
                key={entry.path}
                entry={entry}
                selected={selectedPaths.has(entry.path)}
                onToggle={() => toggle(entry.path)}
                draggable
                onDragStart={() => onDragStart(getDragPaths(entry.path))}
                onDragEnd={onDragEnd}
                onOpen={
                  entry.type === "directory"
                    ? () => void loadPath(entry.path)
                    : undefined
                }
                onContextMenu={onEntryContextMenu}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}

function RemotePane({
  title,
  hosts,
  pane,
  setPane,
  selectable,
  draggable = false,
  dragPayload,
  onDragStart,
  onDragEnd,
  onDropPayload,
  onPaneContextMenu,
  onEntryContextMenu,
}: {
  title: string;
  hosts: SSHHost[];
  pane: RemotePaneState;
  setPane: (updater: (pane: RemotePaneState) => RemotePaneState) => void;
  selectable: boolean;
  draggable?: boolean;
  dragPayload?: DragPayload | null;
  onDragStart?: (paths: string[], pane: RemotePaneState) => void;
  onDragEnd?: () => void;
  onDropPayload?: (destinationPath: string) => void;
  onPaneContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  onEntryContextMenu: (
    event: MouseEvent<HTMLDivElement>,
    entry: BrowserEntry,
  ) => void;
}) {
  const selectedHost = hosts.find((host) => String(host.id) === pane.hostId);
  const acceptsDrop = !!dragPayload && !!pane.sessionId && !!onDropPayload;

  const loadRemotePath = useCallback(
    async (sessionId: string, nextPath: string) => {
      setPane((current) => ({ ...current, loading: true, error: null }));
      try {
        const result = await listSSHFiles(sessionId, nextPath);
        const base = normalizeRemoteDir(result.path || nextPath);
        setPane((current) => ({
          ...current,
          path: base,
          entries: (result.files as BrowserEntry[])
            .filter((entry) => entry.name !== "." && entry.name !== "..")
            .map((entry) => ({
              name: entry.name,
              type: entry.type,
              path: joinRemotePath(base, entry.name),
              size: entry.size,
              modified: entry.modified,
            }))
            .sort((a, b) => {
              if (a.type === "directory" && b.type !== "directory") return -1;
              if (a.type !== "directory" && b.type === "directory") return 1;
              return a.name.localeCompare(b.name);
            }),
          selectedPaths: new Set(),
          loading: false,
        }));
      } catch (error) {
        setPane((current) => ({
          ...current,
          entries: [],
          loading: false,
          error:
            error instanceof Error ? error.message : "Failed to list files",
        }));
      }
    },
    [setPane],
  );

  const connect = useCallback(
    async (host: SSHHost) => {
      setPane((current) => ({
        ...current,
        hostId: String(host.id),
        sessionId: null,
        connectionState: "connecting",
        error: null,
        entries: [],
        selectedPaths: new Set(),
      }));
      const result = await ensureSSHSessionForHost(host);
      if (result.state !== "ready" || !result.sessionId) {
        setPane((current) => ({
          ...current,
          connectionState: result.state,
          error: result.error || null,
          sessionId: result.sessionId || null,
        }));
        return;
      }
      setPane((current) => ({
        ...current,
        connectionState: "ready",
        sessionId: result.sessionId || String(host.id),
        path: host.defaultPath || "/",
      }));
      await loadRemotePath(
        result.sessionId || String(host.id),
        host.defaultPath || "/",
      );
    },
    [loadRemotePath, setPane],
  );

  const toggle = (entryPath: string) => {
    setPane((current) => {
      const next = new Set(current.selectedPaths);
      if (next.has(entryPath)) next.delete(entryPath);
      else next.add(entryPath);
      return { ...current, selectedPaths: next };
    });
  };

  const getDragPaths = (entryPath: string): string[] => {
    if (pane.selectedPaths.has(entryPath) && pane.selectedPaths.size > 0) {
      return [...pane.selectedPaths];
    }
    setPane((current) => ({
      ...current,
      selectedPaths: new Set([entryPath]),
    }));
    return [entryPath];
  };

  return (
    <section
      className={`flex min-h-0 flex-1 flex-col border bg-card transition-colors ${
        acceptsDrop ? "border-accent-brand/50" : "border-border"
      }`}
      onDragOver={(event) => {
        if (!acceptsDrop) return;
        event.preventDefault();
        event.dataTransfer.dropEffect =
          dragPayload?.kind === "remote" ? "copyMove" : "copy";
      }}
      onDrop={(event) => {
        if (!acceptsDrop) return;
        event.preventDefault();
        onDropPayload?.(pane.path);
      }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Server className="size-4 text-accent-brand" />
          <span className="truncate text-xs font-bold uppercase tracking-widest">
            {title}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 rounded-none"
          disabled={!pane.sessionId || pane.loading}
          onClick={() =>
            pane.sessionId && void loadRemotePath(pane.sessionId, pane.path)
          }
        >
          <RefreshCw
            className={`size-3.5 ${pane.loading ? "animate-spin" : ""}`}
          />
        </Button>
      </div>

      <div className="grid gap-2 border-b border-border px-3 py-2">
        <div className="relative">
          <Select2
            value={pane.hostId}
            onChange={(event) => {
              const host = hosts.find(
                (item) => String(item.id) === event.target.value,
              );
              if (host) void connect(host);
            }}
            className="h-8 w-full appearance-none border border-border bg-background px-2 pr-7 text-xs outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="" disabled>
              Select host
            </option>
            {hosts.map((host) => (
              <option key={host.id} value={String(host.id)}>
                {host.name || host.ip}
              </option>
            ))}
          </Select2>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={pane.path}
            onChange={(event) =>
              setPane((current) => ({ ...current, path: event.target.value }))
            }
            onKeyDown={(event) => {
              if (event.key === "Enter" && pane.sessionId) {
                void loadRemotePath(pane.sessionId, pane.path);
              }
            }}
            disabled={!pane.sessionId}
            className="h-8 rounded-none border-border bg-muted/40 font-mono text-xs"
          />
          <Button
            variant="outline"
            className="h-8 rounded-none px-2 text-xs"
            disabled={!pane.sessionId || pane.path === "/"}
            onClick={() =>
              pane.sessionId &&
              void loadRemotePath(pane.sessionId, parentRemotePath(pane.path))
            }
          >
            Up
          </Button>
        </div>
        <div
          className={`text-[10px] font-bold uppercase tracking-widest ${
            pane.connectionState === "ready"
              ? "text-green-500"
              : pane.connectionState === "error"
                ? "text-red-400"
                : "text-muted-foreground"
          }`}
        >
          {selectedHost
            ? connectionLabel(pane.connectionState)
            : "No host selected"}
          {pane.error ? `: ${pane.error}` : ""}
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto"
        onContextMenu={onPaneContextMenu}
      >
        {pane.entries.length === 0 && !pane.loading ? (
          <div className="p-3 text-xs text-muted-foreground">No files</div>
        ) : (
          pane.entries.map((entry) => (
            <FileRow
              key={entry.path}
              entry={entry}
              selected={pane.selectedPaths.has(entry.path)}
              onToggle={() => selectable && toggle(entry.path)}
              draggable={draggable && selectable}
              onDragStart={() => {
                if (!onDragStart) return;
                onDragStart(getDragPaths(entry.path), pane);
              }}
              onDragEnd={onDragEnd}
              acceptsDrop={acceptsDrop}
              onDropPayload={
                entry.type === "directory"
                  ? () => onDropPayload?.(entry.path)
                  : undefined
              }
              onOpen={
                entry.type === "directory" && pane.sessionId
                  ? () => void loadRemotePath(pane.sessionId!, entry.path)
                  : undefined
              }
              onContextMenu={onEntryContextMenu}
            />
          ))
        )}
      </div>
    </section>
  );
}

export function SftpTransferTab() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<TransferMode>("local-server");
  const [hosts, setHosts] = useState<SSHHost[]>([]);
  const [hostsLoading, setHostsLoading] = useState(false);
  const [localPane, setLocalPaneState] = useState(defaultLocalPane);
  const [localSelectedPaths, setLocalSelectedPaths] = useState<Set<string>>(
    new Set(),
  );
  const [sourcePane, setSourcePaneState] = useState(defaultRemotePane);
  const [destPane, setDestPaneState] = useState(defaultRemotePane);
  const [serverMove, setServerMove] = useState(false);
  const [transferLabel, setTransferLabel] = useState<string | null>(null);
  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContextMenuState | null>(
    null,
  );
  const [permissionsTarget, setPermissionsTarget] =
    useState<PermissionsTarget | null>(null);

  const setLocalPane = useCallback(
    (updater: (pane: LocalPaneState) => LocalPaneState) =>
      setLocalPaneState(updater),
    [],
  );

  const setSourcePane = useCallback(
    (updater: (pane: RemotePaneState) => RemotePaneState) =>
      setSourcePaneState(updater),
    [],
  );
  const setDestPane = useCallback(
    (updater: (pane: RemotePaneState) => RemotePaneState) =>
      setDestPaneState(updater),
    [],
  );

  const loadLocalPath = useCallback(
    async (nextPath: string) => {
      const electronApi = window.electronAPI;
      if (!electronApi?.listLocalDirectory) {
        setLocalPane((current) => ({
          ...current,
          error: "Local browsing is available in the Electron app only.",
        }));
        return;
      }
      setLocalPane((current) => ({ ...current, loading: true, error: null }));
      try {
        const result = await electronApi.listLocalDirectory(nextPath);
        if (!result.success) {
          setLocalPane((current) => ({
            ...current,
            path: result.path || nextPath,
            entries: [],
            loading: false,
            error: result.error || "Failed to load local directory",
          }));
          return;
        }
        setLocalPane({
          path: result.path,
          parent: result.parent || result.path,
          entries: result.entries.map((entry: LocalFileEntry) => ({
            ...entry,
            type: entry.type,
          })),
          loading: false,
          error: null,
        });
        setLocalSelectedPaths(new Set());
      } catch (error) {
        setLocalPane((current) => ({
          ...current,
          entries: [],
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to load local directory",
        }));
      }
    },
    [setLocalPane],
  );

  useEffect(() => {
    setHostsLoading(true);
    getSSHHosts({ includeStatus: false })
      .then((data) =>
        setHosts(
          data.filter(
            (host) =>
              host.enableFileManager !== false &&
              host.connectionType !== "rdp" &&
              host.connectionType !== "vnc",
          ),
        ),
      )
      .catch(() => setHosts([]))
      .finally(() => setHostsLoading(false));
  }, []);

  useEffect(() => {
    const electronApi = window.electronAPI;
    if (!electronApi?.getLocalHomeDirectory) {
      void loadLocalPath("");
      return;
    }
    void electronApi.getLocalHomeDirectory().then((home) => loadLocalPath(home));
  }, [loadLocalPath]);

  useEffect(() => {
    setDragPayload(null);
  }, [mode]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", close);
    };
  }, [contextMenu]);

  const localSelectionCount = localSelectedPaths.size;
  const sourceSelectionCount = sourcePane.selectedPaths.size;

  const getRemotePane = (paneId: PaneId): RemotePaneState | null => {
    if (paneId === "source") return sourcePane;
    if (paneId === "dest") return destPane;
    return null;
  };

  const getPaneEntries = (paneId: PaneId): BrowserEntry[] => {
    if (paneId === "local") return localPane.entries;
    return getRemotePane(paneId)?.entries || [];
  };

  const getPaneSelectedPaths = (paneId: PaneId): Set<string> => {
    if (paneId === "local") return localSelectedPaths;
    return getRemotePane(paneId)?.selectedPaths || new Set();
  };

  const getContextPaths = (menu: ContextMenuState): string[] => {
    if (!menu.entry) return [];
    const selectedPaths = getPaneSelectedPaths(menu.paneId);
    if (selectedPaths.has(menu.entry.path) && selectedPaths.size > 0) {
      return [...selectedPaths];
    }
    return [menu.entry.path];
  };

  const getContextEntries = (menu: ContextMenuState): BrowserEntry[] => {
    const paths = new Set(getContextPaths(menu));
    return getPaneEntries(menu.paneId).filter((entry) => paths.has(entry.path));
  };

  const refreshRemotePane = async (paneId: "source" | "dest") => {
    const pane = paneId === "source" ? sourcePane : destPane;
    const setPane = paneId === "source" ? setSourcePane : setDestPane;
    if (!pane.sessionId) return;
    setPane((current) => ({ ...current, loading: true, error: null }));
    try {
      const refreshed = await browseSSHDirectory(pane.sessionId, pane.path);
      if (refreshed.status !== "ok") {
        throw new Error("Failed to refresh directory");
      }
      setPane((current) => ({
        ...current,
        path: normalizeRemoteDir(refreshed.path || pane.path),
        entries: refreshed.files
          .filter((entry) => entry.name !== "." && entry.name !== "..")
          .map((entry) => ({
            ...entry,
            type: entry.type,
            path: joinRemotePath(refreshed.path || pane.path, entry.name),
          })),
        selectedPaths: new Set(),
        loading: false,
      }));
    } catch (error) {
      setPane((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : "Failed to refresh",
      }));
    }
  };

  const openPaneContextMenu = (
    event: MouseEvent<HTMLDivElement>,
    paneId: PaneId,
  ) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, paneId });
  };

  const openEntryContextMenu = (
    event: MouseEvent<HTMLDivElement>,
    paneId: PaneId,
    entry: BrowserEntry,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (!getPaneSelectedPaths(paneId).has(entry.path)) {
      if (paneId === "local") {
        setLocalSelectedPaths(new Set([entry.path]));
      } else {
        const setPane = paneId === "source" ? setSourcePane : setDestPane;
        setPane((current) => ({
          ...current,
          selectedPaths: new Set([entry.path]),
        }));
      }
    }
    setContextMenu({ x: event.clientX, y: event.clientY, paneId, entry });
  };

  const uploadLocalSelection = async (
    paths = [...localSelectedPaths],
    destinationPath = destPane.path,
  ) => {
    if (!destPane.sessionId || paths.length === 0) return;
    if (
      !window.electronAPI?.collectLocalFiles ||
      !window.electronAPI?.readLocalFile
    ) {
      toast.error("Local browsing is available in the Electron app only.");
      return;
    }

    setTransferLabel("Preparing local upload...");
    const collected = await window.electronAPI.collectLocalFiles(paths);
    if (!collected.success) {
      toast.error(collected.error || "Failed to collect local files");
      setTransferLabel(null);
      return;
    }
    if (collected.files.length === 0) {
      toast.error("No local files selected");
      setTransferLabel(null);
      return;
    }

    const targets = buildLocalUploadTargets(
      collected.files as LocalCollectedFile[],
      destinationPath,
    );

    try {
      for (const dir of getRequiredRemoteDirectories(targets)) {
        await createSSHFolder(destPane.sessionId, "/", dir.replace(/^\/+/, ""));
      }

      for (let index = 0; index < targets.length; index++) {
        const target = targets[index];
        setTransferLabel(
          `Uploading ${index + 1} of ${targets.length}: ${target.relativePath}`,
        );
        const read = await window.electronAPI.readLocalFile(target.path);
        if (!read.success || !read.data) {
          throw new Error(read.error || `Failed to read ${target.path}`);
        }
        await uploadSSHFile(
          destPane.sessionId,
          target.remoteDir,
          target.fileName,
          base64ToFile(read.data, target.fileName),
        );
      }

      toast.success(
        `Uploaded ${targets.length} file${targets.length === 1 ? "" : "s"}`,
      );
      if (destPane.sessionId) {
        const refreshed = await browseSSHDirectory(
          destPane.sessionId,
          destPane.path,
        );
        if (refreshed.status === "ok") {
          setDestPane((current) => ({
            ...current,
            entries: refreshed.files.map((entry) => ({
              ...entry,
              type: entry.type,
              path: joinRemotePath(refreshed.path, entry.name),
            })),
          }));
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setTransferLabel(null);
    }
  };

  const transferRemoteSelection = async ({
    paths,
    destinationPath,
    sourceSessionId,
    sourceHostId,
    destinationSessionId,
    destinationHostId,
    move,
    refreshTarget,
  }: {
    paths: string[];
    destinationPath: string;
    sourceSessionId: string | null;
    sourceHostId: string;
    destinationSessionId: string | null;
    destinationHostId: string;
    move: boolean;
    refreshTarget?: "source" | "dest";
  }) => {
    if (!sourceSessionId || !destinationSessionId || paths.length === 0) {
      return;
    }
    if (
      sourceHostId === destinationHostId &&
      hasSameHostTransferConflict(paths, destinationPath)
    ) {
      toast.error("Destination cannot be inside the selected source path.");
      return;
    }

    setTransferLabel("Starting server transfer...");
    try {
      const result = await transferToHost(
        sourceSessionId,
        paths,
        destinationSessionId,
        normalizeRemoteDir(destinationPath),
        move,
        "auto",
        2,
      );
      beginTransferProgressMonitoring(result.transferId, t, {
        onComplete: () => {
          setTransferLabel(null);
          toast.success(move ? "Move completed" : "Copy completed");
          if (refreshTarget) void refreshRemotePane(refreshTarget);
        },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Transfer failed");
      setTransferLabel(null);
    }
  };

  const transferServerSelection = async (
    paths = [...sourcePane.selectedPaths],
    destinationPath = destPane.path,
    sourceSessionId = sourcePane.sessionId,
    sourceHostId = sourcePane.hostId,
  ) => {
    await transferRemoteSelection({
      paths,
      destinationPath,
      sourceSessionId,
      sourceHostId,
      destinationSessionId: destPane.sessionId,
      destinationHostId: destPane.hostId,
      move: serverMove,
      refreshTarget: "dest",
    });
  };

  const startLocalDrag = (paths: string[]) => {
    setDragPayload({ kind: "local", paths });
  };

  const startRemoteDrag = (paths: string[], pane: RemotePaneState) => {
    if (!pane.sessionId) return;
    setDragPayload({
      kind: "remote",
      paths,
      sourceHostId: pane.hostId,
      sourceSessionId: pane.sessionId,
    });
  };

  const handleDestinationDrop = (destinationPath: string) => {
    if (!dragPayload || transferLabel) return;
    const payload = dragPayload;
    setDragPayload(null);

    if (payload.kind === "local") {
      void uploadLocalSelection(payload.paths, destinationPath);
      return;
    }

    void transferServerSelection(
      payload.paths,
      destinationPath,
      payload.sourceSessionId,
      payload.sourceHostId,
    );
  };

  const copyRemoteFilesToLocal = async (
    pane: RemotePaneState,
    entries: BrowserEntry[],
  ) => {
    if (!pane.sessionId || !localPane.path) return;
    if (!window.electronAPI?.writeLocalFile) {
      toast.error("Local writing is available in the Electron app only.");
      return;
    }
    const files = entries.filter((entry) => entry.type === "file");
    if (files.length !== entries.length) {
      toast.error("Remote folder to local copy is not available yet.");
      return;
    }
    if (files.length === 0) return;

    setTransferLabel("Copying remote file to local folder...");
    try {
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        setTransferLabel(`Copying ${index + 1} of ${files.length}: ${file.name}`);
        const read = await readSSHFile(pane.sessionId, file.path);
        const data =
          read.encoding === "base64"
            ? read.content
            : utf8ToBase64(read.content || "");
        const result = await window.electronAPI.writeLocalFile(
          localPane.path,
          file.name,
          data,
        );
        if (!result.success) {
          throw new Error(result.error || `Failed to write ${file.name}`);
        }
      }
      toast.success(
        `Copied ${files.length} file${files.length === 1 ? "" : "s"} to local`,
      );
      await loadLocalPath(localPane.path);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Copy failed");
    } finally {
      setTransferLabel(null);
    }
  };

  const handleCopyToTarget = async (menu: ContextMenuState) => {
    const paths = getContextPaths(menu);
    const entries = getContextEntries(menu);
    setContextMenu(null);
    if (paths.length === 0) return;

    if (menu.paneId === "local") {
      await uploadLocalSelection(paths, destPane.path);
      return;
    }

    if (menu.paneId === "source") {
      await transferRemoteSelection({
        paths,
        destinationPath: destPane.path,
        sourceSessionId: sourcePane.sessionId,
        sourceHostId: sourcePane.hostId,
        destinationSessionId: destPane.sessionId,
        destinationHostId: destPane.hostId,
        move: false,
        refreshTarget: "dest",
      });
      return;
    }

    if (mode === "server-server") {
      await transferRemoteSelection({
        paths,
        destinationPath: sourcePane.path,
        sourceSessionId: destPane.sessionId,
        sourceHostId: destPane.hostId,
        destinationSessionId: sourcePane.sessionId,
        destinationHostId: sourcePane.hostId,
        move: false,
        refreshTarget: "source",
      });
      return;
    }

    await copyRemoteFilesToLocal(destPane, entries);
  };

  const handleRefreshPane = async (paneId: PaneId) => {
    setContextMenu(null);
    if (paneId === "local") {
      await loadLocalPath(localPane.path);
      return;
    }
    await refreshRemotePane(paneId);
  };

  const handleNameDialogSubmit = async () => {
    if (!nameDialog) return;
    const value = nameDialog.value.trim();
    if (!value) return;

    try {
      if (nameDialog.kind === "mkdir") {
        if (nameDialog.paneId === "local") {
          const result = await window.electronAPI?.createLocalFolder?.(
            localPane.path,
            value,
          );
          if (!result?.success) {
            throw new Error(result?.error || "Failed to create folder");
          }
          await loadLocalPath(localPane.path);
        } else {
          const pane = getRemotePane(nameDialog.paneId);
          if (!pane?.sessionId) throw new Error("No remote session connected");
          await createSSHFolder(pane.sessionId, pane.path, value);
          await refreshRemotePane(nameDialog.paneId);
        }
        toast.success("Folder created");
      } else if (nameDialog.entry) {
        if (nameDialog.paneId === "local") {
          const result = await window.electronAPI?.renameLocalPath?.(
            nameDialog.entry.path,
            value,
          );
          if (!result?.success) {
            throw new Error(result?.error || "Failed to rename item");
          }
          await loadLocalPath(localPane.path);
        } else {
          const pane = getRemotePane(nameDialog.paneId);
          if (!pane?.sessionId) throw new Error("No remote session connected");
          await renameSSHItem(pane.sessionId, nameDialog.entry.path, value);
          await refreshRemotePane(nameDialog.paneId);
        }
        toast.success("Item renamed");
      }
      setNameDialog(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed");
    }
  };

  const handleDeleteConfirmed = async () => {
    if (!deleteTarget) return;
    const entries = getContextEntries(deleteTarget);
    const paneId = deleteTarget.paneId;
    setDeleteTarget(null);
    if (entries.length === 0) return;

    try {
      if (paneId === "local") {
        if (!window.electronAPI?.trashLocalPath) {
          throw new Error("Local delete is available in the Electron app only.");
        }
        for (const entry of entries) {
          const result = await window.electronAPI.trashLocalPath(entry.path);
          if (!result.success) {
            throw new Error(result.error || `Failed to delete ${entry.name}`);
          }
        }
        await loadLocalPath(localPane.path);
      } else {
        const pane = getRemotePane(paneId);
        if (!pane?.sessionId) throw new Error("No remote session connected");
        for (const entry of entries) {
          await deleteSSHItem(
            pane.sessionId,
            entry.path,
            entry.type === "directory",
          );
        }
        await refreshRemotePane(paneId);
      }
      toast.success(`Deleted ${entries.length} item${entries.length === 1 ? "" : "s"}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed");
    }
  };

  const handlePermissionsSave = async (
    entry: BrowserEntry,
    permissions: string,
  ) => {
    if (!permissionsTarget) return;
    const paneId = permissionsTarget.paneId;
    if (paneId === "local") {
      const result = await window.electronAPI?.chmodLocalPath?.(
        entry.path,
        permissions,
      );
      if (!result?.success) {
        throw new Error(result?.error || "Failed to update permissions");
      }
      await loadLocalPath(localPane.path);
      toast.success("Permissions updated");
      return;
    }

    const pane = getRemotePane(paneId);
    if (!pane?.sessionId) throw new Error("No remote session connected");
    await changeSSHPermissions(pane.sessionId, entry.path, permissions);
    await refreshRemotePane(paneId);
    toast.success("Permissions updated");
  };

  const canTransfer = useMemo(() => {
    if (mode === "local-server") {
      return (
        localSelectedPaths.size > 0 && destPane.sessionId && !transferLabel
      );
    }
    return (
      sourcePane.selectedPaths.size > 0 &&
      sourcePane.sessionId &&
      destPane.sessionId &&
      !transferLabel
    );
  }, [
    destPane.sessionId,
    localSelectedPaths.size,
    mode,
    sourcePane,
    transferLabel,
  ]);

  const contextEntries = contextMenu ? getContextEntries(contextMenu) : [];
  const contextPaths = contextMenu ? getContextPaths(contextMenu) : [];
  const singleContextEntry =
    contextEntries.length === 1 ? contextEntries[0] : contextMenu?.entry;
  const contextRemotePane = contextMenu
    ? getRemotePane(contextMenu.paneId)
    : null;
  const remoteToLocalHasFolder =
    contextMenu?.paneId === "dest" &&
    mode === "local-server" &&
    contextEntries.some((entry) => entry.type === "directory");
  const canCopyContext =
    !!contextMenu?.entry &&
    contextPaths.length > 0 &&
    !transferLabel &&
    (contextMenu.paneId === "local"
      ? !!destPane.sessionId
      : contextMenu.paneId === "source"
        ? !!sourcePane.sessionId && !!destPane.sessionId
        : mode === "server-server"
          ? !!destPane.sessionId && !!sourcePane.sessionId
          : !!destPane.sessionId &&
            !!localPane.path &&
            !remoteToLocalHasFolder);
  const canMutateContextPane =
    !!contextMenu &&
    (contextMenu.paneId === "local"
      ? !!window.electronAPI?.createLocalFolder
      : !!contextRemotePane?.sessionId);
  const permissionsDialogFile = permissionsTarget
    ? {
        ...permissionsTarget.entry,
        type:
          permissionsTarget.entry.type === "other"
            ? "file"
            : permissionsTarget.entry.type,
      }
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex shrink-0 flex-col gap-3 border-b border-border px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="text-sm font-bold uppercase tracking-widest">SFTP</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Transfer files between this Mac and SSH hosts, or between two SSH
            hosts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden border border-border">
            <button
              type="button"
              className={`px-3 py-1.5 text-xs font-bold uppercase tracking-widest ${
                mode === "local-server"
                  ? "bg-accent-brand/10 text-accent-brand"
                  : "text-muted-foreground hover:bg-muted"
              }`}
              onClick={() => setMode("local-server")}
            >
              Local to Server
            </button>
            <button
              type="button"
              className={`border-l border-border px-3 py-1.5 text-xs font-bold uppercase tracking-widest ${
                mode === "server-server"
                  ? "bg-accent-brand/10 text-accent-brand"
                  : "text-muted-foreground hover:bg-muted"
              }`}
              onClick={() => setMode("server-server")}
            >
              Server to Server
            </button>
          </div>
          {mode === "server-server" && (
            <Label className="flex items-center gap-2 border border-border px-3 py-1.5 text-xs">
              <input
                type="checkbox"
                checked={serverMove}
                onChange={(event) => setServerMove(event.target.checked)}
              />
              Move
            </Label>
          )}
          <Button
            className="h-8 rounded-none"
            disabled={!canTransfer}
            onClick={() =>
              mode === "local-server"
                ? void uploadLocalSelection()
                : void transferServerSelection()
            }
          >
            {mode === "local-server" ? (
              <Upload className="size-4" />
            ) : (
              <ArrowLeftRight className="size-4" />
            )}
            {mode === "local-server" ? "Upload" : serverMove ? "Move" : "Copy"}
          </Button>
        </div>
      </header>

      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2 text-xs text-muted-foreground">
        <span>
          {mode === "local-server"
            ? `${localSelectionCount} local item${localSelectionCount === 1 ? "" : "s"} selected`
            : `${sourceSelectionCount} source item${sourceSelectionCount === 1 ? "" : "s"} selected`}
        </span>
        <span>
          {hostsLoading ? "Loading hosts..." : transferLabel || "Ready"}
        </span>
      </div>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-2">
        {mode === "local-server" ? (
          <LocalPane
            pane={localPane}
            setPane={setLocalPane}
            loadPath={loadLocalPath}
            selectedPaths={localSelectedPaths}
            setSelectedPaths={setLocalSelectedPaths}
            onDragStart={startLocalDrag}
            onDragEnd={() => setDragPayload(null)}
            onPaneContextMenu={(event) => openPaneContextMenu(event, "local")}
            onEntryContextMenu={(event, entry) =>
              openEntryContextMenu(event, "local", entry)
            }
          />
        ) : (
          <RemotePane
            title="Source Server"
            hosts={hosts}
            pane={sourcePane}
            setPane={setSourcePane}
            selectable
            draggable
            onDragStart={startRemoteDrag}
            onDragEnd={() => setDragPayload(null)}
            onPaneContextMenu={(event) => openPaneContextMenu(event, "source")}
            onEntryContextMenu={(event, entry) =>
              openEntryContextMenu(event, "source", entry)
            }
          />
        )}
        <RemotePane
          title="Destination Server"
          hosts={hosts}
          pane={destPane}
          setPane={setDestPane}
          selectable
          dragPayload={dragPayload}
          onDropPayload={handleDestinationDrop}
          onPaneContextMenu={(event) => openPaneContextMenu(event, "dest")}
          onEntryContextMenu={(event, entry) =>
            openEntryContextMenu(event, "dest", entry)
          }
        />
      </main>

      {contextMenu && (
        <div
          className="fixed z-50 min-w-48 border border-border bg-popover py-1 text-popover-foreground shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          {contextMenu.entry ? (
            <>
              <ContextMenuButton
                disabled={!canCopyContext}
                onClick={() => void handleCopyToTarget(contextMenu)}
              >
                Copy to Target Directory
              </ContextMenuButton>
              <ContextMenuButton
                disabled={contextEntries.length !== 1 || !canMutateContextPane}
                onClick={() => {
                  if (!singleContextEntry) return;
                  setContextMenu(null);
                  setNameDialog({
                    kind: "rename",
                    paneId: contextMenu.paneId,
                    entry: singleContextEntry,
                    value: singleContextEntry.name,
                  });
                }}
              >
                Rename
              </ContextMenuButton>
              <ContextMenuButton
                disabled={!canMutateContextPane || contextEntries.length === 0}
                onClick={() => {
                  setDeleteTarget(contextMenu);
                  setContextMenu(null);
                }}
              >
                Delete
              </ContextMenuButton>
              <ContextMenuButton
                disabled={contextEntries.length !== 1 || !canMutateContextPane}
                onClick={() => {
                  if (!singleContextEntry) return;
                  setContextMenu(null);
                  setPermissionsTarget({
                    paneId: contextMenu.paneId,
                    entry: singleContextEntry,
                  });
                }}
              >
                Edit Permissions
              </ContextMenuButton>
            </>
          ) : (
            <>
              <ContextMenuButton
                disabled={contextMenu.paneId !== "local" && !contextRemotePane?.sessionId}
                onClick={() => void handleRefreshPane(contextMenu.paneId)}
              >
                Refresh
              </ContextMenuButton>
              <ContextMenuButton
                disabled={!canMutateContextPane}
                onClick={() => {
                  setNameDialog({
                    kind: "mkdir",
                    paneId: contextMenu.paneId,
                    value: "",
                  });
                  setContextMenu(null);
                }}
              >
                Create New Folder
              </ContextMenuButton>
            </>
          )}
          {remoteToLocalHasFolder && (
            <div className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
              Remote folder to local copy is not available yet.
            </div>
          )}
        </div>
      )}

      <Dialog open={!!nameDialog} onOpenChange={(open) => !open && setNameDialog(null)}>
        <DialogContent className="rounded-none border-border bg-card sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-xs font-bold uppercase tracking-widest">
              {nameDialog?.kind === "mkdir" ? "Create New Folder" : "Rename"}
            </DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={nameDialog?.value || ""}
            onChange={(event) =>
              setNameDialog((current) =>
                current ? { ...current, value: event.target.value } : current,
              )
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleNameDialogSubmit();
            }}
            className="h-9 rounded-none border-border bg-muted/40 text-xs"
          />
          <DialogFooter>
            <Button
              variant="ghost"
              className="rounded-none text-xs"
              onClick={() => setNameDialog(null)}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              className="rounded-none text-xs"
              onClick={() => void handleNameDialogSubmit()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent className="rounded-none border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xs font-bold uppercase tracking-widest">
              Delete Selected Items
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground">
              {deleteTarget
                ? `Delete ${getContextEntries(deleteTarget).length} selected item${getContextEntries(deleteTarget).length === 1 ? "" : "s"}?`
                : "Delete selected items?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-none text-xs">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="rounded-none text-xs"
              onClick={() => void handleDeleteConfirmed()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PermissionsDialog
        file={permissionsDialogFile}
        open={!!permissionsTarget}
        onOpenChange={(open) => !open && setPermissionsTarget(null)}
        onSave={handlePermissionsSave}
      />
    </div>
  );
}
