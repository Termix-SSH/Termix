import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  ArrowLeftRight,
  File as FileIcon,
  Folder,
  RefreshCw,
  Server,
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
  addTransferRecent,
  browseSSHDirectory,
  changeSSHPermissions,
  createSSHFolder,
  deleteSSHItem,
  ensureSSHSessionForHost,
  getSSHHosts,
  renameSSHItem,
  transferToHost,
  type HostConnectionState,
  type TransferProgressResponse,
} from "@/main-axios";
import type { SSHHost } from "@/types";
import { PermissionsDialog } from "@/features/file-manager/components/PermissionsDialog";
import { formatFileSize } from "@/features/file-manager/file-manager-utils";
import { beginTransferProgressMonitoring } from "@/features/file-manager/transferProgressMonitor";
import { createFormatTransferMetrics } from "@/features/file-manager/transferMetricsFormat";
import {
  hasSameHostTransferConflict,
  joinRemotePath,
  normalizeRemoteDir,
} from "./sftp-transfer-utils";
import { Select2 } from "@/components/select2";

type EntryType = "file" | "directory" | "link" | "other";
type PaneId = "source" | "dest";

interface BrowserEntry {
  name: string;
  path: string;
  type: EntryType;
  size?: number;
  modified?: string;
  modifiedTimestamp?: number;
  permissions?: string;
  owner?: string;
  group?: string;
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

function formatModified(entry: BrowserEntry): string {
  if (entry.modifiedTimestamp !== undefined) {
    const date = new Date(entry.modifiedTimestamp * 1000);
    if (!Number.isNaN(date.getTime())) {
      const pad = (part: number) => String(part).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }
  }
  if (entry.modified) {
    const date = new Date(entry.modified);
    if (!Number.isNaN(date.getTime())) {
      const pad = (part: number) => String(part).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }
  }
  return "-";
}

function parentRemotePath(remotePath: string): string {
  const normalized = normalizeRemoteDir(remotePath);
  if (normalized === "/") return "/";
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "/" : normalized.slice(0, index);
}

function connectionLabel(state: HostConnectionState, t: TFunction): string {
  switch (state) {
    case "ready":
      return t("transfer.hostReady");
    case "connecting":
      return t("transfer.hostConnecting");
    case "auth_required":
      return t("transfer.hostAuthRequired");
    case "error":
      return t("transfer.hostConnectionFailed");
    default:
      return t("transfer.hostDisconnected");
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
  t,
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
  t: TFunction;
}) {
  const Icon = entry.type === "directory" ? Folder : FileIcon;
  const canDrop = entry.type === "directory" && !!onDropPayload && acceptsDrop;
  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_8.5rem_5rem] items-center border-b border-border/70 text-xs ${
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
      <div
        className="px-3 py-2 text-[10px] tabular-nums text-muted-foreground"
        title={entry.modified || undefined}
      >
        {formatModified(entry)}
      </div>
      <div className="flex items-center justify-end gap-2 px-3 py-2 text-[10px] text-muted-foreground">
        {entry.type === "directory" && onOpen ? (
          <button
            type="button"
            className="font-bold uppercase tracking-widest hover:text-accent-brand"
            onClick={onOpen}
          >
            {t("sftpTransfer.open")}
          </button>
        ) : (
          <span>{formatFileSize(entry.size)}</span>
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

function RemotePane({
  title,
  hosts,
  pane,
  setPane,
  dragActive,
  onDragStart,
  onDragEnd,
  onDropPayload,
  onPaneContextMenu,
  onEntryContextMenu,
  t,
}: {
  title: string;
  hosts: SSHHost[];
  pane: RemotePaneState;
  setPane: (updater: (pane: RemotePaneState) => RemotePaneState) => void;
  dragActive: boolean;
  onDragStart: (paths: string[], pane: RemotePaneState) => void;
  onDragEnd: () => void;
  onDropPayload?: (destinationPath: string) => void;
  onPaneContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  onEntryContextMenu: (
    event: MouseEvent<HTMLDivElement>,
    entry: BrowserEntry,
  ) => void;
  t: TFunction;
}) {
  const selectedHost = hosts.find((host) => String(host.id) === pane.hostId);
  const acceptsDrop = dragActive && !!pane.sessionId && !!onDropPayload;

  const loadRemotePath = useCallback(
    async (sessionId: string, nextPath: string) => {
      setPane((current) => ({ ...current, loading: true, error: null }));
      const result = await browseSSHDirectory(sessionId, nextPath);
      if (result.status !== "ok") {
        setPane((current) => ({
          ...current,
          entries: [],
          loading: false,
          error: t("sftpTransfer.failedToListFiles"),
        }));
        return;
      }
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
            modifiedTimestamp: entry.modifiedTimestamp,
          }))
          .sort((a, b) => {
            if (a.type === "directory" && b.type !== "directory") return -1;
            if (a.type !== "directory" && b.type === "directory") return 1;
            return a.name.localeCompare(b.name);
          }),
        selectedPaths: new Set(),
        loading: false,
      }));
    },
    [setPane, t],
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
        event.dataTransfer.dropEffect = "copy";
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
        <Select2
          value={pane.hostId}
          onChange={(event) => {
            const host = hosts.find(
              (item) => String(item.id) === event.target.value,
            );
            if (host) void connect(host);
          }}
          className="h-8 w-full rounded-none border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="" disabled>
            {t("sftpTransfer.selectHost")}
          </option>
          {hosts.map((host) => (
            <option key={host.id} value={String(host.id)}>
              {host.name || host.ip}
            </option>
          ))}
        </Select2>
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
            {t("sftpTransfer.up")}
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
            ? connectionLabel(pane.connectionState, t)
            : t("sftpTransfer.noHostSelected")}
          {pane.error ? `: ${pane.error}` : ""}
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto"
        onContextMenu={onPaneContextMenu}
      >
        <div className="grid grid-cols-[minmax(0,1fr)_8.5rem_5rem] border-b border-border/70 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          <span>{t("sftpTransfer.name")}</span>
          <span>{t("sftpTransfer.modified")}</span>
          <span className="text-right">{t("sftpTransfer.size")}</span>
        </div>
        {pane.entries.length === 0 && !pane.loading ? (
          <div className="p-3 text-xs text-muted-foreground">
            {t("sftpTransfer.noFiles")}
          </div>
        ) : (
          pane.entries.map((entry) => (
            <FileRow
              key={entry.path}
              entry={entry}
              selected={pane.selectedPaths.has(entry.path)}
              onToggle={() => toggle(entry.path)}
              draggable
              onDragStart={() => onDragStart(getDragPaths(entry.path), pane)}
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
              t={t}
            />
          ))
        )}
      </div>
    </section>
  );
}

export function SftpTransferTab() {
  const { t } = useTranslation();
  const formatTransferMetrics = useMemo(
    () => createFormatTransferMetrics(t),
    [t],
  );
  const [hosts, setHosts] = useState<SSHHost[]>([]);
  const [hostsLoading, setHostsLoading] = useState(false);
  const [sourcePane, setSourcePaneState] = useState(defaultRemotePane);
  const [destPane, setDestPaneState] = useState(defaultRemotePane);
  const [move, setMove] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContextMenuState | null>(
    null,
  );
  const [permissionsTarget, setPermissionsTarget] =
    useState<PermissionsTarget | null>(null);

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
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", close);
    };
  }, [contextMenu]);

  const sourceSelectionCount = sourcePane.selectedPaths.size;

  const getPane = (paneId: PaneId): RemotePaneState =>
    paneId === "source" ? sourcePane : destPane;

  const getContextPaths = (menu: ContextMenuState): string[] => {
    if (!menu.entry) return [];
    const selectedPaths = getPane(menu.paneId).selectedPaths;
    if (selectedPaths.has(menu.entry.path) && selectedPaths.size > 0) {
      return [...selectedPaths];
    }
    return [menu.entry.path];
  };

  const getContextEntries = (menu: ContextMenuState): BrowserEntry[] => {
    const paths = new Set(getContextPaths(menu));
    return getPane(menu.paneId).entries.filter((entry) =>
      paths.has(entry.path),
    );
  };

  const refreshRemotePane = async (paneId: PaneId) => {
    const pane = getPane(paneId);
    const setPane = paneId === "source" ? setSourcePane : setDestPane;
    if (!pane.sessionId) return;
    setPane((current) => ({ ...current, loading: true, error: null }));
    const refreshed = await browseSSHDirectory(pane.sessionId, pane.path);
    if (refreshed.status !== "ok") {
      setPane((current) => ({
        ...current,
        loading: false,
        error: t("sftpTransfer.failedToRefresh"),
      }));
      return;
    }
    const base = normalizeRemoteDir(refreshed.path || pane.path);
    setPane((current) => ({
      ...current,
      path: base,
      entries: refreshed.files
        .filter((entry) => entry.name !== "." && entry.name !== "..")
        .map((entry) => ({
          ...entry,
          type: entry.type,
          modified: entry.modified,
          modifiedTimestamp: entry.modifiedTimestamp,
          path: joinRemotePath(base, entry.name),
        })),
      selectedPaths: new Set(),
      loading: false,
    }));
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
    if (!getPane(paneId).selectedPaths.has(entry.path)) {
      const setPane = paneId === "source" ? setSourcePane : setDestPane;
      setPane((current) => ({
        ...current,
        selectedPaths: new Set([entry.path]),
      }));
    }
    setContextMenu({ x: event.clientX, y: event.clientY, paneId, entry });
  };

  const runTransfer = async ({
    paths,
    destinationPath,
    sourceSessionId,
    sourceHostId,
    destinationSessionId,
    destinationHostId,
    move: moveFiles,
    refreshTarget,
    sourceRefreshTarget,
  }: {
    paths: string[];
    destinationPath: string;
    sourceSessionId: string | null;
    sourceHostId: string;
    destinationSessionId: string | null;
    destinationHostId: string;
    move: boolean;
    refreshTarget?: PaneId;
    sourceRefreshTarget?: PaneId;
  }) => {
    if (!sourceSessionId || !destinationSessionId || paths.length === 0) {
      return;
    }
    const destDir = normalizeRemoteDir(destinationPath);
    if (
      sourceHostId === destinationHostId &&
      hasSameHostTransferConflict(paths, destDir)
    ) {
      toast.error(t("sftpTransfer.destinationInsideSource"));
      return;
    }

    setTransferring(true);
    try {
      const { transferId } = await transferToHost(
        sourceSessionId,
        paths,
        destinationSessionId,
        destDir,
        moveFiles,
        "auto",
      );
      const monitorHandle = beginTransferProgressMonitoring(transferId, t, {
        formatTransferMetrics,
      });
      if (!monitorHandle) return;

      const finalStatus: TransferProgressResponse =
        await monitorHandle.waitForCompletion;

      if (
        finalStatus.status === "success" ||
        finalStatus.status === "partial"
      ) {
        void addTransferRecent(
          Number(sourceHostId),
          Number(destinationHostId),
          destDir,
          destDir,
        );
        if (refreshTarget) void refreshRemotePane(refreshTarget);
        if (moveFiles && sourceRefreshTarget) {
          void refreshRemotePane(sourceRefreshTarget);
        }
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("transfer.transferError"),
      );
    } finally {
      setTransferring(false);
    }
  };

  const transferSelection = async (
    paths = [...sourcePane.selectedPaths],
    destinationPath = destPane.path,
    sourceSessionId = sourcePane.sessionId,
    sourceHostId = sourcePane.hostId,
  ) => {
    await runTransfer({
      paths,
      destinationPath,
      sourceSessionId,
      sourceHostId,
      destinationSessionId: destPane.sessionId,
      destinationHostId: destPane.hostId,
      move,
      refreshTarget: "dest",
      sourceRefreshTarget: "source",
    });
  };

  const dragSourceRef = useRef<{
    paths: string[];
    hostId: string;
    sessionId: string;
    paneId: PaneId;
  }>({ paths: [], hostId: "", sessionId: "", paneId: "source" });

  const startRemoteDrag = (
    paneId: PaneId,
    paths: string[],
    pane: RemotePaneState,
  ) => {
    if (!pane.sessionId) return;
    setDragActive(true);
    dragSourceRef.current = {
      paths,
      hostId: pane.hostId,
      sessionId: pane.sessionId,
      paneId,
    };
  };

  const handleDestinationDrop = (destinationPath: string) => {
    if (!dragActive || transferring) return;
    setDragActive(false);
    const { paths, hostId, sessionId, paneId } = dragSourceRef.current;
    void runTransfer({
      paths,
      destinationPath,
      sourceSessionId: sessionId,
      sourceHostId: hostId,
      destinationSessionId: destPane.sessionId,
      destinationHostId: destPane.hostId,
      move,
      refreshTarget: "dest",
      sourceRefreshTarget: paneId,
    });
  };

  const handleCopyToTarget = async (menu: ContextMenuState) => {
    const paths = getContextPaths(menu);
    setContextMenu(null);
    if (paths.length === 0) return;

    if (menu.paneId === "source") {
      await runTransfer({
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

    await runTransfer({
      paths,
      destinationPath: sourcePane.path,
      sourceSessionId: destPane.sessionId,
      sourceHostId: destPane.hostId,
      destinationSessionId: sourcePane.sessionId,
      destinationHostId: sourcePane.hostId,
      move: false,
      refreshTarget: "source",
    });
  };

  const handleRefreshPane = async (paneId: PaneId) => {
    setContextMenu(null);
    await refreshRemotePane(paneId);
  };

  const handleNameDialogSubmit = async () => {
    if (!nameDialog) return;
    const value = nameDialog.value.trim();
    if (!value) return;

    const pane = getPane(nameDialog.paneId);
    if (!pane.sessionId) return;

    try {
      if (nameDialog.kind === "mkdir") {
        await createSSHFolder(pane.sessionId, pane.path, value);
        await refreshRemotePane(nameDialog.paneId);
        toast.success(t("sftpTransfer.folderCreated"));
      } else if (nameDialog.entry) {
        await renameSSHItem(pane.sessionId, nameDialog.entry.path, value);
        await refreshRemotePane(nameDialog.paneId);
        toast.success(t("sftpTransfer.itemRenamed"));
      }
      setNameDialog(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("sftpTransfer.actionFailed"),
      );
    }
  };

  const handleDeleteConfirmed = async () => {
    if (!deleteTarget) return;
    const entries = getContextEntries(deleteTarget);
    const paneId = deleteTarget.paneId;
    setDeleteTarget(null);
    if (entries.length === 0) return;

    const pane = getPane(paneId);
    if (!pane.sessionId) return;

    try {
      for (const entry of entries) {
        await deleteSSHItem(
          pane.sessionId,
          entry.path,
          entry.type === "directory",
        );
      }
      await refreshRemotePane(paneId);
      toast.success(t("sftpTransfer.itemsDeleted", { count: entries.length }));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("sftpTransfer.deleteFailed"),
      );
    }
  };

  const handlePermissionsSave = async (
    entry: BrowserEntry,
    permissions: string,
  ) => {
    if (!permissionsTarget) return;
    const pane = getPane(permissionsTarget.paneId);
    if (!pane.sessionId)
      throw new Error(t("sftpTransfer.noRemoteSessionConnected"));
    await changeSSHPermissions(pane.sessionId, entry.path, permissions);
    await refreshRemotePane(permissionsTarget.paneId);
    toast.success(t("sftpTransfer.permissionsUpdated"));
  };

  const canTransfer =
    sourcePane.selectedPaths.size > 0 &&
    !!sourcePane.sessionId &&
    !!destPane.sessionId &&
    !transferring;

  const contextEntries = contextMenu ? getContextEntries(contextMenu) : [];
  const contextPaths = contextMenu ? getContextPaths(contextMenu) : [];
  const singleContextEntry =
    contextEntries.length === 1 ? contextEntries[0] : contextMenu?.entry;
  const contextPane = contextMenu ? getPane(contextMenu.paneId) : null;
  const otherPane = contextMenu
    ? getPane(contextMenu.paneId === "source" ? "dest" : "source")
    : null;
  const canCopyContext =
    !!contextMenu?.entry &&
    contextPaths.length > 0 &&
    !transferring &&
    !!contextPane?.sessionId &&
    !!otherPane?.sessionId;
  const canMutateContextPane = !!contextPane?.sessionId;
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
          <h1 className="text-sm font-bold uppercase tracking-widest">
            {t("sftpTransfer.title")}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("sftpTransfer.description")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Label className="flex items-center gap-2 border border-border px-3 py-1.5 text-xs">
            <input
              type="checkbox"
              checked={move}
              onChange={(event) => setMove(event.target.checked)}
            />
            {t("sftpTransfer.move")}
          </Label>
          <Button
            className="h-8 rounded-none"
            disabled={!canTransfer}
            onClick={() => void transferSelection()}
          >
            <ArrowLeftRight className="size-4" />
            {move ? t("sftpTransfer.move") : t("sftpTransfer.copy")}
          </Button>
        </div>
      </header>

      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-4 py-2 text-xs text-muted-foreground">
        <span>
          {t("sftpTransfer.itemsSelected", { count: sourceSelectionCount })}
        </span>
        <span>
          {hostsLoading
            ? t("sftpTransfer.loadingHosts")
            : t("sftpTransfer.ready")}
        </span>
      </div>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-2">
        <RemotePane
          title={t("sftpTransfer.sourceServer")}
          hosts={hosts}
          pane={sourcePane}
          setPane={setSourcePane}
          dragActive={false}
          onDragStart={(paths, pane) => startRemoteDrag("source", paths, pane)}
          onDragEnd={() => setDragActive(false)}
          onPaneContextMenu={(event) => openPaneContextMenu(event, "source")}
          onEntryContextMenu={(event, entry) =>
            openEntryContextMenu(event, "source", entry)
          }
          t={t}
        />
        <RemotePane
          title={t("sftpTransfer.destinationServer")}
          hosts={hosts}
          pane={destPane}
          setPane={setDestPane}
          dragActive={dragActive}
          onDragStart={(paths, pane) => startRemoteDrag("dest", paths, pane)}
          onDragEnd={() => setDragActive(false)}
          onDropPayload={handleDestinationDrop}
          onPaneContextMenu={(event) => openPaneContextMenu(event, "dest")}
          onEntryContextMenu={(event, entry) =>
            openEntryContextMenu(event, "dest", entry)
          }
          t={t}
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
                {t("sftpTransfer.copyToTarget")}
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
                {t("sftpTransfer.rename")}
              </ContextMenuButton>
              <ContextMenuButton
                disabled={!canMutateContextPane || contextEntries.length === 0}
                onClick={() => {
                  setDeleteTarget(contextMenu);
                  setContextMenu(null);
                }}
              >
                {t("sftpTransfer.delete")}
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
                {t("sftpTransfer.editPermissions")}
              </ContextMenuButton>
            </>
          ) : (
            <>
              <ContextMenuButton
                disabled={!contextPane?.sessionId}
                onClick={() => void handleRefreshPane(contextMenu.paneId)}
              >
                {t("sftpTransfer.refresh")}
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
                {t("sftpTransfer.createNewFolder")}
              </ContextMenuButton>
            </>
          )}
        </div>
      )}

      <Dialog
        open={!!nameDialog}
        onOpenChange={(open) => !open && setNameDialog(null)}
      >
        <DialogContent className="rounded-none border-border bg-card sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-xs font-bold uppercase tracking-widest">
              {nameDialog?.kind === "mkdir"
                ? t("sftpTransfer.createNewFolder")
                : t("sftpTransfer.rename")}
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
              {t("sftpTransfer.cancel")}
            </Button>
            <Button
              variant="outline"
              className="rounded-none text-xs"
              onClick={() => void handleNameDialogSubmit()}
            >
              {t("sftpTransfer.save")}
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
              {t("sftpTransfer.deleteSelectedItems")}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground">
              {t("sftpTransfer.deleteConfirm", {
                count: deleteTarget
                  ? getContextEntries(deleteTarget).length
                  : 0,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-none text-xs">
              {t("sftpTransfer.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="rounded-none text-xs"
              onClick={() => void handleDeleteConfirmed()}
            >
              {t("sftpTransfer.delete")}
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
