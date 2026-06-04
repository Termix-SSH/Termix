import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog.tsx";
import { Button } from "@/components/button.tsx";
import { Input } from "@/components/input.tsx";
import { Label } from "@/components/label.tsx";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowRightLeft,
  Bookmark,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Folder,
  Trash2,
} from "lucide-react";
import {
  getSSHStatus,
  getSSHHosts,
  getTransferRecent,
  getFolderShortcuts,
  addFolderShortcut,
  removeFolderShortcut,
  browseSSHDirectory,
  ensureSSHSessionForHost,
  getTransferMethodPreview,
  type TransferDestination,
  type HostConnectionState,
  type TransferMethodPreference,
  type TransferMethodPreview,
} from "@/main-axios.ts";
import type { SSHHost } from "@/types";

interface FileItem {
  name: string;
  type: "file" | "directory" | "link";
  path: string;
}

interface BrowseEntry {
  name: string;
  path: string;
}

interface FolderShortcutEntry {
  id: number;
  name: string;
  path: string;
}

interface TransferToHostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: FileItem[];
  move: boolean;
  sourceHost: SSHHost;
  sourceSessionId: string | null;
  onConfirm: (
    destSessionId: string,
    destHostId: number,
    destPath: string,
    destPathLabel: string,
    methodPreference: TransferMethodPreference,
    parallelSegmentCount: number,
  ) => void;
}

function formatByteSize(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  const formatted =
    size < 10 && unitIndex > 0 ? size.toFixed(1) : Math.round(size).toString();
  return `${formatted} ${units[unitIndex]}`;
}

function formatTruncatedDestination(hostLabel: string, path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  if (normalized === "/") {
    return `${hostLabel} — /`;
  }

  const segments = normalized.split("/").filter(Boolean);
  const pathPart =
    segments.length <= 2
      ? `/${segments.join("/")}`
      : `.../${segments.slice(-2).join("/")}`;

  return `${hostLabel} — ${pathPart}`;
}

function longestCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return "";
  let prefix = strings[0];
  for (let i = 1; i < strings.length; i++) {
    while (!strings[i].startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
      if (!prefix) return "";
    }
  }
  return prefix;
}

function splitPathForCompletion(
  fullPath: string,
  cursorPos: number,
): { dirPath: string; partial: string; replaceStart: number } {
  const beforeCursor = fullPath.slice(0, cursorPos);
  const lastSlash = beforeCursor.lastIndexOf("/");
  if (lastSlash === -1) {
    return { dirPath: "/", partial: beforeCursor, replaceStart: 0 };
  }
  const dirPath = beforeCursor.slice(0, lastSlash) || "/";
  const partial = beforeCursor.slice(lastSlash + 1);
  return { dirPath, partial, replaceStart: lastSlash + 1 };
}

function connectionLabel(
  state: HostConnectionState,
  t: (key: string) => string,
): string {
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

export function TransferToHostDialog({
  open,
  onOpenChange,
  files,
  move,
  sourceHost,
  sourceSessionId,
  onConfirm,
}: TransferToHostDialogProps) {
  const { t } = useTranslation();

  const [availableHosts, setAvailableHosts] = useState<SSHHost[]>([]);
  const [loadingHosts, setLoadingHosts] = useState(false);
  const [selectedHostId, setSelectedHostId] = useState<string>("");
  const [connectionStates, setConnectionStates] = useState<
    Record<number, HostConnectionState>
  >({});
  const [connectionErrors, setConnectionErrors] = useState<
    Record<number, string>
  >({});
  const [destPath, setDestPath] = useState("");
  const [shortcuts, setShortcuts] = useState<FolderShortcutEntry[]>([]);
  const [recents, setRecents] = useState<TransferDestination[]>([]);
  const [browsePath, setBrowsePath] = useState("/");
  const [browseEntries, setBrowseEntries] = useState<BrowseEntry[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseStatus, setBrowseStatus] = useState<
    "ok" | "not_found" | "error" | "idle"
  >("idle");
  const skipDestBrowseSyncRef = useRef(false);
  const destPathDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pendingBrowsePathRef = useRef<string | null>(null);
  const lastBrowseHostIdRef = useRef<number | null>(null);
  const destPathInputRef = useRef<HTMLInputElement>(null);
  const [methodPreference, setMethodPreference] =
    useState<TransferMethodPreference>("auto");
  const [parallelSegmentCount, setParallelSegmentCount] = useState("2");
  const [methodPreview, setMethodPreview] =
    useState<TransferMethodPreview | null>(null);
  const [methodPreviewLoading, setMethodPreviewLoading] = useState(false);
  const [methodPreviewError, setMethodPreviewError] = useState<string | null>(
    null,
  );
  const [recentsCollapsed, setRecentsCollapsed] = useState(true);
  const methodPreviewLockKeyRef = useRef<string | null>(null);
  const archiveSourcePathsKey = useMemo(
    () => files.map((f) => f.path).join("\0"),
    [files],
  );

  const isSingleFile = files.length === 1 && files[0].type === "file";
  const isArchiveTransfer = !isSingleFile;

  const sourceLabel = useMemo(() => {
    if (files.length === 1) {
      return `${sourceHost.name || sourceHost.ip}:${files[0].path}`;
    }
    return `${sourceHost.name || sourceHost.ip}: ${t("transfer.itemsSummary", { count: files.length })}`;
  }, [files, sourceHost, t]);

  const selectedHost = availableHosts.find(
    (h) => h.id.toString() === selectedHostId,
  );

  const selectedConnectionState = selectedHost
    ? (connectionStates[selectedHost.id] ?? "disconnected")
    : "disconnected";

  const isHostReady = selectedConnectionState === "ready";

  const loadAvailableHosts = useCallback(async () => {
    setLoadingHosts(true);
    try {
      const hosts = await getSSHHosts();
      const candidates = hosts.filter(
        (h) =>
          h.id !== sourceHost.id &&
          h.enableFileManager !== false &&
          h.connectionType !== "rdp" &&
          h.connectionType !== "vnc",
      );
      setAvailableHosts(candidates);

      const initialStates: Record<number, HostConnectionState> = {};
      await Promise.all(
        candidates.map(async (host) => {
          try {
            const status = await getSSHStatus(host.id.toString());
            initialStates[host.id] = status?.connected
              ? "ready"
              : "disconnected";
          } catch {
            initialStates[host.id] = "disconnected";
          }
        }),
      );
      setConnectionStates(initialStates);
    } catch {
      setAvailableHosts([]);
    } finally {
      setLoadingHosts(false);
    }
  }, [sourceHost.id]);

  const ensureHostConnection = useCallback(async (host: SSHHost) => {
    setConnectionStates((prev) => ({ ...prev, [host.id]: "connecting" }));
    setConnectionErrors((prev) => {
      const next = { ...prev };
      delete next[host.id];
      return next;
    });

    const result = await ensureSSHSessionForHost(host);
    setConnectionStates((prev) => ({ ...prev, [host.id]: result.state }));
    if (result.error) {
      setConnectionErrors((prev) => ({
        ...prev,
        [host.id]: result.error!,
      }));
    }
  }, []);

  const loadRecents = useCallback(async () => {
    if (!sourceHost.id) return;
    try {
      const recentData = await getTransferRecent(sourceHost.id);
      setRecents(recentData);
    } catch {
      setRecents([]);
    }
  }, [sourceHost.id]);

  const loadShortcutsForHost = useCallback(async (hostId: number) => {
    try {
      const data = await getFolderShortcuts(hostId);
      setShortcuts((Array.isArray(data) ? data : []) as FolderShortcutEntry[]);
    } catch {
      setShortcuts([]);
    }
  }, []);

  const syncDestPathFromBrowse = useCallback((path: string) => {
    skipDestBrowseSyncRef.current = true;
    setDestPath(path);
  }, []);

  const loadBrowseDirectory = useCallback(
    async (sessionId: string, path: string, syncDest = true) => {
      setBrowseLoading(true);
      try {
        const result = await browseSSHDirectory(sessionId, path);

        if (result.status === "ok") {
          const dirs = result.files
            .filter(
              (entry) =>
                entry.type === "directory" &&
                entry.name !== "." &&
                entry.name !== "..",
            )
            .map((entry) => {
              const base = result.path.endsWith("/")
                ? result.path.slice(0, -1)
                : result.path;
              const childPath =
                base === "/" ? `/${entry.name}` : `${base}/${entry.name}`;
              return { name: entry.name, path: childPath };
            })
            .sort((a, b) => a.name.localeCompare(b.name));

          setBrowsePath(result.path);
          setBrowseEntries(dirs);
          setBrowseStatus("ok");
          if (syncDest) {
            syncDestPathFromBrowse(result.path);
          }
        } else if (result.status === "not_found") {
          setBrowsePath(result.path);
          setBrowseEntries([]);
          setBrowseStatus("not_found");
          if (syncDest) {
            syncDestPathFromBrowse(result.path);
          }
        } else {
          setBrowseEntries([]);
          setBrowseStatus("error");
        }
      } catch {
        setBrowseEntries([]);
        setBrowseStatus("error");
      } finally {
        setBrowseLoading(false);
      }
    },
    [syncDestPathFromBrowse],
  );

  useEffect(() => {
    if (open) {
      void loadAvailableHosts();
      void loadRecents();
      setSelectedHostId("");
      setDestPath("");
      setShortcuts([]);
      setBrowsePath("/");
      setBrowseEntries([]);
      setBrowseStatus("idle");
      setConnectionErrors({});
      setMethodPreference("auto");
      setParallelSegmentCount("2");
      setMethodPreview(null);
      setMethodPreviewError(null);
      methodPreviewLockKeyRef.current = null;
      setRecentsCollapsed(true);
      pendingBrowsePathRef.current = null;
      lastBrowseHostIdRef.current = null;
    }
  }, [open, loadAvailableHosts, loadRecents]);

  useEffect(() => {
    if (!open || !selectedHost?.id) {
      setShortcuts([]);
      return;
    }
    void loadShortcutsForHost(selectedHost.id);
  }, [open, selectedHost?.id, loadShortcutsForHost]);

  useEffect(() => {
    if (!selectedHost || !isHostReady) return;

    const hostId = selectedHost.id;
    if (lastBrowseHostIdRef.current === hostId) return;

    const path = pendingBrowsePathRef.current ?? (destPath.trim() || "/");
    pendingBrowsePathRef.current = null;
    lastBrowseHostIdRef.current = hostId;
    void loadBrowseDirectory(hostId.toString(), path);
  }, [selectedHost, isHostReady, destPath, loadBrowseDirectory]);

  useEffect(() => {
    if (selectedHost && selectedConnectionState === "disconnected") {
      void ensureHostConnection(selectedHost);
    }
  }, [selectedHost, selectedConnectionState, ensureHostConnection]);

  useEffect(() => {
    if (!selectedHost || !isHostReady || !open) return;

    if (skipDestBrowseSyncRef.current) {
      skipDestBrowseSyncRef.current = false;
      return;
    }

    const typed = destPath.trim();
    if (!typed) return;

    if (destPathDebounceRef.current) {
      clearTimeout(destPathDebounceRef.current);
    }

    destPathDebounceRef.current = setTimeout(() => {
      void loadBrowseDirectory(selectedHost.id.toString(), typed, false);
    }, 400);

    return () => {
      if (destPathDebounceRef.current) {
        clearTimeout(destPathDebounceRef.current);
      }
    };
  }, [destPath, selectedHost, isHostReady, open, loadBrowseDirectory]);

  const hostName = (hostId: number) =>
    availableHosts.find((h) => h.id === hostId)?.name ||
    availableHosts.find((h) => h.id === hostId)?.ip ||
    hostId.toString();

  const handleSelectDestination = (destHostId: number, path: string) => {
    pendingBrowsePathRef.current = path;
    setSelectedHostId(destHostId.toString());
    setDestPath(path);
    const host = availableHosts.find((h) => h.id === destHostId);
    if (host && connectionStates[host.id] === "ready") {
      lastBrowseHostIdRef.current = host.id;
      void loadBrowseDirectory(host.id.toString(), path);
    } else {
      lastBrowseHostIdRef.current = null;
    }
  };

  useEffect(() => {
    if (!open || !isArchiveTransfer || !sourceSessionId) {
      if (!open || !isArchiveTransfer) {
        setMethodPreview(null);
        setMethodPreviewError(null);
        methodPreviewLockKeyRef.current = null;
      }
      return;
    }

    const lockKey = `${archiveSourcePathsKey}|${methodPreference}|${selectedHost?.id}|${destPath.trim() || browsePath}`;
    if (methodPreviewLockKeyRef.current === lockKey) {
      return;
    }

    if (!selectedHost || !isHostReady) {
      return;
    }

    const sourcePaths = files.map((f) => f.path);
    const previewPath =
      (destPath.trim() || browsePath || "/").replace(/\/+$/, "") || "/";

    let cancelled = false;
    setMethodPreviewLoading(true);
    setMethodPreviewError(null);

    void getTransferMethodPreview(
      sourceSessionId,
      sourcePaths,
      selectedHost.id.toString(),
      previewPath,
      methodPreference,
    )
      .then((preview) => {
        if (!cancelled) {
          setMethodPreview(preview);
          methodPreviewLockKeyRef.current = lockKey;
        }
      })
      .catch((err: { message?: string }) => {
        if (!cancelled) {
          setMethodPreview(null);
          setMethodPreviewError(err.message ?? "Preview failed");
        }
      })
      .finally(() => {
        if (!cancelled) setMethodPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    open,
    isArchiveTransfer,
    sourceSessionId,
    selectedHost,
    isHostReady,
    archiveSourcePathsKey,
    methodPreference,
    destPath,
    browsePath,
    files,
  ]);

  const handleHostChange = (hostId: string) => {
    setSelectedHostId(hostId);
    setBrowsePath("/");
    setDestPath("");
    setShortcuts([]);
    setMethodPreview(null);
    setMethodPreviewError(null);
    methodPreviewLockKeyRef.current = null;
    pendingBrowsePathRef.current = null;
    lastBrowseHostIdRef.current = null;
  };

  const handleBrowseInto = (path: string) => {
    if (!selectedHost || !isHostReady) return;
    void loadBrowseDirectory(selectedHost.id.toString(), path, true);
  };

  const handleBrowseUp = () => {
    if (!selectedHost || !isHostReady || browsePath === "/") return;
    const trimmed = browsePath.replace(/\/+$/, "");
    const idx = trimmed.lastIndexOf("/");
    const parent = idx <= 0 ? "/" : trimmed.substring(0, idx);
    void loadBrowseDirectory(selectedHost.id.toString(), parent, true);
  };

  const formatBrowsePathLabel = (path: string): string => {
    const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
    if (normalized === "/") return "/";
    const segments = normalized.split("/").filter(Boolean);
    if (segments.length <= 3) return normalized;
    return `.../${segments.slice(-2).join("/")}`;
  };

  const handleAddShortcut = async () => {
    if (!selectedHost || !destPath.trim()) {
      return;
    }

    const trimmedPath = destPath.trim();
    if (shortcuts.some((entry) => entry.path === trimmedPath)) {
      return;
    }

    const folderName = trimmedPath.split("/").pop() || trimmedPath;
    try {
      await addFolderShortcut(selectedHost.id, trimmedPath, folderName);
      await loadShortcutsForHost(selectedHost.id);
      toast.success(
        t("fileManager.shortcutAddedSuccessfully", { name: folderName }),
      );
    } catch {
      /* toast handled by API */
    }
  };

  const handleRemoveShortcut = async (path: string) => {
    if (!selectedHost) return;
    try {
      await removeFolderShortcut(selectedHost.id, path);
      await loadShortcutsForHost(selectedHost.id);
      const folderName = path.split("/").pop() || path;
      toast.success(t("fileManager.removedShortcut", { name: folderName }));
    } catch {
      /* toast handled by API */
    }
  };

  const handleDestPathKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (
      event.key !== "Tab" ||
      event.shiftKey ||
      !selectedHost ||
      !isHostReady
    ) {
      return;
    }

    event.preventDefault();
    const input = destPathInputRef.current;
    if (!input) return;

    const currentPath = input.value;
    const cursorPos = input.selectionStart ?? currentPath.length;
    const { dirPath, partial, replaceStart } = splitPathForCompletion(
      currentPath,
      cursorPos,
    );
    if (!partial) return;

    void browseSSHDirectory(selectedHost.id.toString(), dirPath).then(
      (result) => {
        if (result.status !== "ok") return;

        const dirNames = result.files
          .filter(
            (entry) =>
              entry.type === "directory" &&
              entry.name !== "." &&
              entry.name !== "..",
          )
          .map((entry) => entry.name);

        const matches = dirNames.filter((name) => name.startsWith(partial));
        if (matches.length === 0) return;

        let completedName: string;
        let appendSlash = false;
        if (matches.length === 1) {
          completedName = matches[0];
          appendSlash = true;
        } else {
          completedName = longestCommonPrefix(matches);
          if (completedName.length <= partial.length) return;
          appendSlash = matches.every((name) => name === completedName);
        }

        const suffix = currentPath.slice(cursorPos);
        const newPath =
          currentPath.slice(0, replaceStart) +
          completedName +
          (appendSlash ? "/" : "") +
          suffix;
        const newCursor =
          replaceStart + completedName.length + (appendSlash ? 1 : 0);

        skipDestBrowseSyncRef.current = true;
        setDestPath(newPath);
        requestAnimationFrame(() => {
          input.setSelectionRange(newCursor, newCursor);
        });
      },
    );
  };

  const buildDestPath = (): string => {
    const base = destPath.replace(/\/+$/, "") || "/";
    if (isSingleFile) {
      return base.endsWith("/")
        ? `${base}${files[0].name}`
        : `${base}/${files[0].name}`;
    }
    return base;
  };

  const handleConfirm = () => {
    if (!selectedHost || !destPath.trim() || !isHostReady) return;
    const fullPath = buildDestPath();
    onConfirm(
      selectedHost.id.toString(),
      selectedHost.id,
      fullPath,
      destPath.trim(),
      methodPreference,
      Math.max(1, Math.min(8, parseInt(parallelSegmentCount, 10) || 2)),
    );
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg rounded-none border-border bg-card">
        <DialogHeader>
          <DialogTitle className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
            <ArrowRightLeft className="size-4 text-accent-brand" />
            {move
              ? files.length > 1
                ? t("transfer.moveItemsToHost", { count: files.length })
                : t("transfer.moveToHost")
              : files.length > 1
                ? t("transfer.copyItemsToHost", { count: files.length })
                : t("transfer.copyToHost")}
          </DialogTitle>
          <DialogDescription
            className="text-[10px] font-bold uppercase tracking-tight text-muted-foreground font-mono truncate"
            title={sourceLabel}
          >
            {sourceLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2 max-h-[min(60vh,28rem)] overflow-y-auto overflow-x-hidden">
          {loadingHosts ? (
            <p className="text-xs text-muted-foreground">
              {t("fileManager.connecting")}
            </p>
          ) : availableHosts.length === 0 ? (
            <div className="border border-border bg-muted/10 p-3">
              <p className="text-xs font-semibold">
                {t("transfer.noHostsConnected")}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {t("transfer.noHostsConnectedHint")}
              </p>
            </div>
          ) : (
            <>
              {/* Destination host */}
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  {t("transfer.selectDestinationHost")}
                </Label>
                <div className="relative">
                  <select
                    value={selectedHostId}
                    onChange={(e) => handleHostChange(e.target.value)}
                    className="w-full appearance-none px-2.5 py-1.5 text-xs bg-background border border-border text-foreground outline-none focus:ring-1 focus:ring-ring pr-7"
                  >
                    <option value="" disabled>
                      {t("transfer.selectDestinationHost")}
                    </option>
                    {availableHosts.map((host) => (
                      <option key={host.id} value={host.id.toString()}>
                        {host.name || host.ip}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground pointer-events-none" />
                </div>
                {selectedHost && (
                  <p
                    className={`text-[10px] font-bold uppercase tracking-widest ${
                      isHostReady
                        ? "text-green-500"
                        : selectedConnectionState === "error"
                          ? "text-red-400"
                          : "text-muted-foreground"
                    }`}
                  >
                    {connectionLabel(selectedConnectionState, t)}
                    {connectionErrors[selectedHost.id]
                      ? `: ${connectionErrors[selectedHost.id]}`
                      : ""}
                  </p>
                )}
              </div>

              {/* Shortcuts */}
              {selectedHost && shortcuts.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                    <Bookmark className="size-3" />
                    {t("fileManager.folderShortcuts")}
                  </Label>
                  <div className="border border-border">
                    {shortcuts.map((entry, i) => (
                      <div
                        key={entry.id}
                        className={`flex min-w-0 items-stretch ${i < shortcuts.length - 1 ? "border-b border-border" : ""}`}
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left px-3 py-2 hover:bg-accent-brand/10 hover:text-accent-brand transition-colors"
                          onClick={() =>
                            handleSelectDestination(selectedHost.id, entry.path)
                          }
                        >
                          <span className="block truncate text-xs font-semibold">
                            {entry.name}
                          </span>
                          <span
                            className="block truncate text-[10px] text-muted-foreground font-mono"
                            title={entry.path}
                          >
                            {formatTruncatedDestination(
                              selectedHost.name || selectedHost.ip,
                              entry.path,
                            )}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="shrink-0 px-3 text-muted-foreground hover:text-red-400 border-l border-border transition-colors"
                          title={t("fileManager.removeShortcut")}
                          aria-label={t("fileManager.removeShortcut")}
                          onClick={() => void handleRemoveShortcut(entry.path)}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent destinations */}
              {recents.length > 0 && (
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setRecentsCollapsed((prev) => !prev)}
                    aria-expanded={!recentsCollapsed}
                  >
                    {recentsCollapsed ? (
                      <ChevronRight className="size-3 shrink-0" />
                    ) : (
                      <ChevronDown className="size-3 shrink-0" />
                    )}
                    <Clock className="size-3 shrink-0" />
                    {t("transfer.recentDestinations")}
                    <span className="font-normal normal-case tracking-normal">
                      ({recents.length})
                    </span>
                  </button>
                  {!recentsCollapsed && (
                    <div className="border border-border">
                      {recents.map((recent, i) => (
                        <button
                          key={recent.id}
                          type="button"
                          className={`w-full min-w-0 text-left px-3 py-2 hover:bg-accent-brand/10 hover:text-accent-brand transition-colors ${i < recents.length - 1 ? "border-b border-border" : ""}`}
                          title={`${hostName(recent.destHostId)}:${recent.destPathLabel || recent.destPath}`}
                          onClick={() =>
                            handleSelectDestination(
                              recent.destHostId,
                              recent.destPath,
                            )
                          }
                        >
                          <span className="block truncate text-xs font-semibold">
                            {formatTruncatedDestination(
                              hostName(recent.destHostId),
                              recent.destPathLabel || recent.destPath,
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Folder browser */}
              {selectedHost && isHostReady && (
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    {t("transfer.browseFolders")}
                  </Label>
                  <div className="border border-border">
                    <div className="flex min-w-0 items-center gap-2 border-b border-border px-2 py-1.5 bg-muted/30">
                      <button
                        type="button"
                        className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                        disabled={browsePath === "/"}
                        onClick={handleBrowseUp}
                      >
                        <ChevronUp className="size-3.5" />
                        {t("transfer.goUp")}
                      </button>
                      <span
                        className="min-w-0 flex-1 truncate text-[10px] font-mono text-muted-foreground"
                        title={browsePath}
                      >
                        {formatBrowsePathLabel(browsePath)}
                      </span>
                    </div>
                    <div className="max-h-36 overflow-y-auto overflow-x-hidden">
                      {browseLoading ? (
                        <p className="text-[10px] text-muted-foreground px-3 py-2">
                          {t("fileManager.connecting")}
                        </p>
                      ) : browseStatus === "not_found" ? (
                        <p className="text-[10px] text-muted-foreground px-3 py-2">
                          {t("transfer.browsePathWillBeCreated")}
                        </p>
                      ) : browseStatus === "error" ? (
                        <p className="text-[10px] text-amber-500 px-3 py-2">
                          {t("transfer.browsePathError")}
                        </p>
                      ) : browseEntries.length === 0 ? (
                        <p className="text-[10px] text-muted-foreground px-3 py-2">
                          {t("fileManager.emptyFolder")}
                        </p>
                      ) : (
                        browseEntries.map((entry, i) => (
                          <button
                            key={entry.path}
                            type="button"
                            className={`flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-accent-brand/10 hover:text-accent-brand transition-colors ${i < browseEntries.length - 1 ? "border-b border-border" : ""}`}
                            onClick={() => handleBrowseInto(entry.path)}
                          >
                            <Folder className="size-3.5 shrink-0 text-yellow-500" />
                            <span className="truncate">{entry.name}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Destination path input */}
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  {t("transfer.destinationPath")}
                </Label>
                <Input
                  ref={destPathInputRef}
                  value={destPath}
                  onChange={(e) => setDestPath(e.target.value)}
                  onKeyDown={handleDestPathKeyDown}
                  placeholder="/home/user"
                  disabled={!selectedHost}
                  className="rounded-none bg-muted/50 border-border font-mono text-xs"
                />
                {isArchiveTransfer && (
                  <p className="text-[10px] text-muted-foreground">
                    {t("transfer.destMustBeDirectory")}
                  </p>
                )}
              </div>

              {/* Bookmark button */}
              {selectedHost && destPath.trim() && (
                <button
                  type="button"
                  className="flex items-center gap-1.5 self-start text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-accent-brand transition-colors border border-border px-2.5 py-1.5 hover:border-accent-brand/40 hover:bg-accent-brand/10"
                  onClick={() => void handleAddShortcut()}
                >
                  <Bookmark className="size-3" />
                  {t("fileManager.addToShortcuts")}
                </button>
              )}

              {/* Transfer method + parallel lanes (archive transfers only) */}
              {isArchiveTransfer && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                      {t("transfer.methodLabel")}
                    </Label>
                    <div className="relative">
                      <select
                        value={methodPreference}
                        onChange={(e) =>
                          setMethodPreference(
                            e.target.value as TransferMethodPreference,
                          )
                        }
                        className="w-full appearance-none px-2.5 py-1.5 text-xs bg-background border border-border text-foreground outline-none focus:ring-1 focus:ring-ring pr-7"
                      >
                        <option value="auto">{t("transfer.methodAuto")}</option>
                        <option value="tar">{t("transfer.methodTar")}</option>
                        <option value="item_sftp">
                          {t("transfer.methodItemSftp")}
                        </option>
                      </select>
                      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground pointer-events-none" />
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {methodPreference === "auto"
                        ? t("transfer.methodAutoHint")
                        : methodPreference === "tar"
                          ? t("transfer.methodTarHint")
                          : t("transfer.methodItemSftpHint")}
                    </p>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                      {t("transfer.parallelSegmentsLabel")}
                    </Label>
                    <div className="relative">
                      <select
                        value={parallelSegmentCount}
                        onChange={(e) =>
                          setParallelSegmentCount(e.target.value)
                        }
                        className="w-full appearance-none px-2.5 py-1.5 text-xs bg-background border border-border text-foreground outline-none focus:ring-1 focus:ring-ring pr-7"
                      >
                        {[1, 2, 3, 4].map((n) => (
                          <option key={n} value={n.toString()}>
                            {t("transfer.parallelSegmentsOption", { count: n })}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground pointer-events-none" />
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {t("transfer.parallelSegmentsHint")}
                    </p>
                  </div>

                  {methodPreviewLoading && (
                    <p className="text-[10px] text-muted-foreground">
                      {t("transfer.methodPreviewLoading")}
                    </p>
                  )}
                  {methodPreviewError && (
                    <p className="text-[10px] text-amber-500">
                      {t("transfer.methodPreviewError")}
                    </p>
                  )}
                  {methodPreview && !methodPreviewLoading && (
                    <div className="border border-border bg-muted/10 px-3 py-2 flex flex-col gap-1">
                      <p className="text-[10px] font-bold uppercase tracking-widest">
                        {methodPreview.resolvedMethod === "tar"
                          ? t("transfer.methodPreviewWillUseTar")
                          : t("transfer.methodPreviewWillUseItemSftp")}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {t(`transfer.methodReason.${methodPreview.reasonKey}`, {
                          fileCount: methodPreview.summary.fileCount,
                          totalSize: formatByteSize(
                            methodPreview.summary.totalBytes,
                          ),
                          largestSize: formatByteSize(
                            methodPreview.summary.largestFileBytes,
                          ),
                        })}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {t("transfer.methodPreviewScanSummary", {
                          fileCount: methodPreview.summary.fileCount,
                          totalSize: formatByteSize(
                            methodPreview.summary.totalBytes,
                          ),
                        })}
                      </p>
                      {methodPreview.resolvedMethod === "item_sftp" && (
                        <p className="text-[10px] text-muted-foreground">
                          {t("transfer.methodItemSftpLimitation")}
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}

              <p className="text-[10px] text-muted-foreground">
                {t("transfer.jumpHostLimitation")}
              </p>
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="rounded-none text-[10px] font-bold uppercase tracking-widest"
          >
            {t("transfer.cancel")}
          </Button>
          <Button
            variant="outline"
            onClick={handleConfirm}
            disabled={
              !selectedHost ||
              !destPath.trim() ||
              !isHostReady ||
              availableHosts.length === 0
            }
            className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 rounded-none text-[10px] font-bold uppercase tracking-widest"
          >
            <ArrowRightLeft className="size-3.5 mr-1" />
            {move ? t("transfer.confirmMove") : t("transfer.confirmCopy")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
