import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  CornerLeftUp,
  Download,
  Eye,
  EyeOff,
  File,
  Folder,
  FolderOpen,
  FolderPlus,
  Home,
  Link2,
  RefreshCw,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { Button } from "@/components/button.tsx";
import { Input } from "@/components/input.tsx";
import type { LocalFileEntry } from "@/types/electron";
import {
  createLocalFile,
  createLocalFolder,
  getLocalHome,
  listLocalDirectory,
  openLocalPath,
  renameLocalEntry,
  revealLocalPath,
  trashLocalPaths,
} from "@/lib/local-files.ts";
import { copyToClipboard } from "@/lib/clipboard.ts";
import { useConfirmation } from "@/hooks/use-confirmation.ts";
import { LocalFileContextMenu } from "./LocalFileContextMenu.tsx";
import {
  useResizableColumns,
  type ResizableColumnSpec,
} from "./hooks/useResizableColumns.ts";
import { ColumnResizeHandle } from "./components/ColumnResizeHandle.tsx";
import { ColumnVisibilityMenu } from "./components/ColumnVisibilityMenu.tsx";
import { formatFileSize } from "./file-manager-utils.ts";
import {
  LOCAL_FILES_DRAG_MIME,
  type LocalSortField,
  describeLocalKind,
  formatLocalModified,
  isRemoteFilesDrag,
  parseInternalFilesDragPayload,
  serializeLocalFilesDragPayload,
  sortLocalEntries,
} from "./local-transfer-utils.ts";

const LAST_PATH_STORAGE_KEY = "termix:file-manager:local-pane:path";
const SHOW_HIDDEN_STORAGE_KEY = "termix:file-manager:local-pane:hidden";
const ROW_HEIGHT = 34;
const COLUMNS_STORAGE_KEY = "termix:file-manager:columns:local";
const LOCAL_COLUMNS: ResizableColumnSpec[] = [
  {
    key: "modified",
    labelKey: "fileManager.modified",
    defaultWidth: 130,
    minWidth: 70,
  },
  { key: "size", labelKey: "fileManager.size", defaultWidth: 72, minWidth: 56 },
  { key: "kind", labelKey: "fileManager.kind", defaultWidth: 64, minWidth: 48 },
];

export interface LocalFilePaneProps {
  /** Bump to force a re-read of the current directory. */
  refreshToken?: number;
  onClose?: () => void;
  /**
   * Remote grid items were dropped on this pane (or on one of its folders).
   * `remotePaths` are the dragged remote paths; `localDir` is where they go.
   */
  onRemoteItemsDropped: (remotePaths: string[], localDir: string) => void;
  /**
   * "Upload to server" from the context menu: sends the given local paths to
   * the remote pane's current folder. Omit to hide the action.
   */
  onUploadToRemote?: (localPaths: string[]) => void;
  onPathChange?: (localPath: string) => void;
}

function readStoredPath(): string | null {
  try {
    return localStorage.getItem(LAST_PATH_STORAGE_KEY);
  } catch {
    return null;
  }
}

function readStoredShowHidden(): boolean {
  try {
    return localStorage.getItem(SHOW_HIDDEN_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function LocalEntryIcon({ entry }: { entry: LocalFileEntry }) {
  if (entry.type === "directory") {
    return <Folder className="size-4 text-accent-brand fill-accent-brand/20" />;
  }
  if (entry.type === "link") {
    return <Link2 className="size-4 text-muted-foreground" />;
  }
  return <File className="size-4 text-muted-foreground" />;
}

export function LocalFilePane({
  refreshToken,
  onClose,
  onRemoteItemsDropped,
  onUploadToRemote,
  onPathChange,
}: LocalFilePaneProps) {
  const { t } = useTranslation();
  const { confirmWithToast } = useConfirmation();
  const [homePath, setHomePath] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<LocalFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [showHidden, setShowHidden] = useState(readStoredShowHidden);
  const [sortBy, setSortBy] = useState<LocalSortField>("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchorPath, setAnchorPath] = useState<string | null>(null);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const [nav, setNav] = useState({ canBack: false, canForward: false });
  const [creating, setCreating] = useState<"folder" | "file" | null>(null);
  const [newEntryName, setNewEntryName] = useState("");
  const [renaming, setRenaming] = useState<{
    path: string;
    name: string;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entries: LocalFileEntry[];
    visible: boolean;
  }>({ x: 0, y: 0, entries: [], visible: false });
  const [dropTarget, setDropTarget] = useState<
    { kind: "pane" } | { kind: "folder"; path: string } | null
  >(null);
  const dragCounter = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const newEntryInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const currentPathRef = useRef<string | null>(null);
  currentPathRef.current = currentPath;

  const visibleEntries = useMemo(() => {
    const filtered = showHidden
      ? entries
      : entries.filter((entry) => !entry.hidden);
    return sortLocalEntries(filtered, sortBy, sortOrder);
  }, [entries, showHidden, sortBy, sortOrder]);

  const columns = useResizableColumns({
    storageKey: COLUMNS_STORAGE_KEY,
    columns: LOCAL_COLUMNS,
  });
  const rowStyle = { gridTemplateColumns: columns.gridTemplateColumns };
  const [columnMenu, setColumnMenu] = useState<{
    x: number;
    y: number;
    visible: boolean;
  }>({ x: 0, y: 0, visible: false });
  const closeColumnMenu = useCallback(
    () => setColumnMenu((prev) => ({ ...prev, visible: false })),
    [],
  );

  const virtualizer = useVirtualizer({
    count: visibleEntries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const load = useCallback(
    async (dirPath: string) => {
      setLoading(true);
      setError(null);
      try {
        const listing = await listLocalDirectory(dirPath);
        setCurrentPath(listing.path);
        setParentPath(listing.parent);
        setEntries(listing.entries);
        setPathInput(listing.path);
        setSelected(new Set());
        setAnchorPath(null);
        try {
          localStorage.setItem(LAST_PATH_STORAGE_KEY, listing.path);
        } catch {
          // storage unavailable
        }
        onPathChange?.(listing.path);
        return listing.path;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [onPathChange],
  );

  const syncNav = useCallback(() => {
    setNav({
      canBack: historyIndexRef.current > 0,
      canForward: historyIndexRef.current < historyRef.current.length - 1,
    });
  }, []);

  const navigateTo = useCallback(
    async (dirPath: string, { record = true }: { record?: boolean } = {}) => {
      const resolved = await load(dirPath);
      if (resolved && record) {
        const kept = historyRef.current.slice(0, historyIndexRef.current + 1);
        if (kept[kept.length - 1] !== resolved) kept.push(resolved);
        historyRef.current = kept;
        historyIndexRef.current = kept.length - 1;
        syncNav();
      }
    },
    [load, syncNav],
  );

  // Initial load: last visited folder, falling back to the home directory.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await getLocalHome();
        if (cancelled) return;
        setHomePath(info.home);
        const start = readStoredPath() || info.home;
        let resolved = await load(start);
        if (!resolved && start !== info.home) {
          resolved = await load(info.home);
        }
        historyRef.current = [resolved || info.home];
        historyIndexRef.current = 0;
        syncNav();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External refresh requests (e.g. after a download finished).
  const lastRefreshToken = useRef(refreshToken);
  useEffect(() => {
    if (refreshToken === lastRefreshToken.current) return;
    lastRefreshToken.current = refreshToken;
    if (currentPathRef.current) void load(currentPathRef.current);
  }, [refreshToken, load]);

  useEffect(() => {
    try {
      localStorage.setItem(SHOW_HIDDEN_STORAGE_KEY, String(showHidden));
    } catch {
      // storage unavailable
    }
  }, [showHidden]);

  useEffect(() => {
    if (creating) newEntryInputRef.current?.focus();
  }, [creating]);

  useEffect(() => {
    if (!renaming) return;
    const input = renameInputRef.current;
    if (!input) return;
    input.focus();
    // Select the stem so typing replaces the name but keeps the extension.
    const dot = renaming.name.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 ? dot : renaming.name.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renaming?.path]);

  const goBack = () => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    syncNav();
    void navigateTo(historyRef.current[historyIndexRef.current], {
      record: false,
    });
  };

  const goForward = () => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    syncNav();
    void navigateTo(historyRef.current[historyIndexRef.current], {
      record: false,
    });
  };

  const goUp = () => {
    if (parentPath) void navigateTo(parentPath);
  };

  const goHome = () => {
    if (homePath) void navigateTo(homePath);
  };

  const refresh = () => {
    if (currentPath) void load(currentPath);
  };

  const submitPathInput = () => {
    const trimmed = pathInput.trim();
    if (!trimmed || trimmed === currentPath) return;
    void navigateTo(trimmed);
  };

  const toggleSort = (field: LocalSortField) => {
    if (field === sortBy) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortOrder("asc");
    }
  };

  const handleRowClick = (entry: LocalFileEntry, event: React.MouseEvent) => {
    event.stopPropagation();
    if (event.detail === 2) {
      openEntry(entry);
      return;
    }

    if (event.shiftKey && anchorPath) {
      const paths = visibleEntries.map((e) => e.path);
      const a = paths.indexOf(anchorPath);
      const b = paths.indexOf(entry.path);
      if (a !== -1 && b !== -1) {
        const [from, to] = a < b ? [a, b] : [b, a];
        setSelected(new Set(paths.slice(from, to + 1)));
        return;
      }
    }

    if (event.metaKey || event.ctrlKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(entry.path)) next.delete(entry.path);
        else next.add(entry.path);
        return next;
      });
      setAnchorPath(entry.path);
      return;
    }

    setSelected(new Set([entry.path]));
    setAnchorPath(entry.path);
  };

  const handleRowDragStart = (
    event: React.DragEvent,
    entry: LocalFileEntry,
  ) => {
    const paths = selected.has(entry.path)
      ? Array.from(selected)
      : [entry.path];
    if (!selected.has(entry.path)) {
      setSelected(new Set([entry.path]));
      setAnchorPath(entry.path);
    }
    const payload = serializeLocalFilesDragPayload(paths);
    event.dataTransfer.setData(LOCAL_FILES_DRAG_MIME, payload);
    event.dataTransfer.setData("text/plain", payload);
    event.dataTransfer.effectAllowed = "copy";
  };

  // ---- Drop target handling (remote grid -> local) ----

  const handlePaneDragEnter = (event: React.DragEvent) => {
    if (!isRemoteFilesDrag(event.dataTransfer)) return;
    event.preventDefault();
    dragCounter.current += 1;
    setDropTarget((prev) => prev ?? { kind: "pane" });
  };

  const handlePaneDragOver = (event: React.DragEvent) => {
    if (!isRemoteFilesDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handlePaneDragLeave = (event: React.DragEvent) => {
    if (!isRemoteFilesDrag(event.dataTransfer)) return;
    event.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDropTarget(null);
  };

  const finishDrop = (event: React.DragEvent, localDir: string | null) => {
    const remotePaths = parseInternalFilesDragPayload(
      event.dataTransfer.getData("text/plain"),
    );
    dragCounter.current = 0;
    setDropTarget(null);
    if (!remotePaths || !localDir) return;
    onRemoteItemsDropped(remotePaths, localDir);
  };

  const handlePaneDrop = (event: React.DragEvent) => {
    if (!isRemoteFilesDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    finishDrop(event, currentPath);
  };

  const handleFolderDragOver = (
    event: React.DragEvent,
    entry: LocalFileEntry,
  ) => {
    if (entry.type !== "directory" || !isRemoteFilesDrag(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setDropTarget((prev) =>
      prev?.kind === "folder" && prev.path === entry.path
        ? prev
        : { kind: "folder", path: entry.path },
    );
  };

  const handleFolderDragLeave = (
    event: React.DragEvent,
    entry: LocalFileEntry,
  ) => {
    if (entry.type !== "directory" || !isRemoteFilesDrag(event.dataTransfer)) {
      return;
    }
    event.stopPropagation();
    setDropTarget((prev) =>
      prev?.kind === "folder" && prev.path === entry.path
        ? { kind: "pane" }
        : prev,
    );
  };

  const handleFolderDrop = (event: React.DragEvent, entry: LocalFileEntry) => {
    if (entry.type !== "directory" || !isRemoteFilesDrag(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    finishDrop(event, entry.path);
  };

  const reportError = (err: unknown, fallbackKey: string) => {
    const message = err instanceof Error ? err.message : String(err ?? "");
    toast.error(t(fallbackKey), message ? { description: message } : undefined);
  };

  const submitNewEntry = async () => {
    const kind = creating;
    const name = newEntryName.trim();
    setCreating(null);
    setNewEntryName("");
    if (!kind || !name || !currentPath) return;
    try {
      if (kind === "folder") await createLocalFolder(currentPath, name);
      else await createLocalFile(currentPath, name);
      await load(currentPath);
    } catch (err) {
      reportError(err, "fileManager.localCreateFailed");
    }
  };

  const startRename = (entry: LocalFileEntry) => {
    setRenaming({ path: entry.path, name: entry.name });
  };

  const submitRename = async () => {
    const current = renaming;
    setRenaming(null);
    if (!current || !currentPath) return;
    const nextName = current.name.trim();
    const entry = entries.find((e) => e.path === current.path);
    if (!entry || !nextName || nextName === entry.name) return;
    try {
      await renameLocalEntry(entry.path, nextName);
      await load(currentPath);
    } catch (err) {
      reportError(err, "fileManager.localRenameFailed");
    }
  };

  const openEntry = (entry: LocalFileEntry) => {
    if (entry.type === "directory") {
      void navigateTo(entry.path);
    } else {
      void openLocalPath(entry.path).catch(() => {
        void revealLocalPath(entry.path);
      });
    }
  };

  const copyEntryPaths = (targets: LocalFileEntry[]) => {
    if (targets.length === 0) return;
    void copyToClipboard(targets.map((e) => e.path).join("\n")).then((ok) => {
      if (ok) {
        toast.success(
          targets.length === 1
            ? t("fileManager.pathCopiedToClipboard")
            : t("fileManager.pathsCopiedToClipboard", {
                count: targets.length,
              }),
        );
      } else {
        toast.error(t("fileManager.failedToCopyPath"));
      }
    });
  };

  const trashEntries = (targets: LocalFileEntry[]) => {
    if (targets.length === 0 || !currentPath) return;
    const hasDirectory = targets.some((e) => e.type === "directory");
    const message =
      targets.length === 1
        ? t(
            hasDirectory
              ? "fileManager.localTrashConfirmFolder"
              : "fileManager.localTrashConfirmSingle",
            { name: targets[0].name },
          )
        : t("fileManager.localTrashConfirmMany", { count: targets.length });

    void confirmWithToast(
      message,
      async () => {
        try {
          const result = await trashLocalPaths(targets.map((e) => e.path));
          if (result.failed.length === 0) {
            toast.success(
              t("fileManager.localTrashed", { count: result.trashed }),
            );
          } else {
            toast.error(t("fileManager.localTrashFailed"), {
              description: result.failed
                .map((f) => `${f.path}: ${f.error}`)
                .join("\n"),
            });
          }
        } catch (err) {
          reportError(err, "fileManager.localTrashFailed");
        }
        await load(currentPath);
      },
      "destructive",
    );
  };

  const selectedEntries = () =>
    visibleEntries.filter((e) => selected.has(e.path));

  const openContextMenu = (event: React.MouseEvent, entry?: LocalFileEntry) => {
    event.preventDefault();
    event.stopPropagation();
    let targets: LocalFileEntry[] = [];
    if (entry) {
      if (selected.has(entry.path)) {
        targets = selectedEntries();
      } else {
        setSelected(new Set([entry.path]));
        setAnchorPath(entry.path);
        targets = [entry];
      }
    }
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      entries: targets,
      visible: true,
    });
  };

  const closeContextMenu = useCallback(
    () => setContextMenu((prev) => ({ ...prev, visible: false })),
    [],
  );

  const handleKeyDown = (event: React.KeyboardEvent) => {
    // Inline editors handle their own keys.
    if ((event.target as HTMLElement).tagName === "INPUT") return;
    const targets = selectedEntries();
    if (event.key === "Enter" && targets.length === 1) {
      event.preventDefault();
      openEntry(targets[0]);
    } else if (event.key === "F2" && targets.length === 1) {
      event.preventDefault();
      startRename(targets[0]);
    } else if (
      (event.key === "Delete" ||
        (event.key === "Backspace" && (event.metaKey || event.ctrlKey))) &&
      targets.length > 0
    ) {
      event.preventDefault();
      trashEntries(targets);
    } else if (event.key === "F5") {
      event.preventDefault();
      refresh();
    } else if (event.key === "Escape") {
      setSelected(new Set());
      setAnchorPath(null);
    } else if (
      event.key === "a" &&
      (event.metaKey || event.ctrlKey) &&
      visibleEntries.length > 0
    ) {
      event.preventDefault();
      setSelected(new Set(visibleEntries.map((e) => e.path)));
    }
  };

  const showPaneOverlay = dropTarget?.kind === "pane";

  // Pinned ".." entry (Termius-style): double-click goes up, and remote
  // items dropped on it download into the parent folder.
  const parentEntry: LocalFileEntry | null = parentPath
    ? {
        name: "..",
        path: parentPath,
        type: "directory",
        size: 0,
        hidden: false,
      }
    : null;
  const isParentDropTarget =
    !!parentEntry &&
    dropTarget?.kind === "folder" &&
    dropTarget.path === parentEntry.path;

  const sortIndicator = (field: LocalSortField) =>
    sortBy === field ? (
      sortOrder === "asc" ? (
        <ArrowUp className="size-3" />
      ) : (
        <ArrowDown className="size-3" />
      )
    ) : null;

  return (
    <div
      className="h-full flex flex-col bg-card overflow-hidden relative"
      data-testid="local-file-pane"
      onDragEnter={handlePaneDragEnter}
      onDragOver={handlePaneDragOver}
      onDragLeave={handlePaneDragLeave}
      onDrop={handlePaneDrop}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border">
        <span className="hidden lg:inline text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1">
          {t("fileManager.localFiles")}
        </span>
        <div className="flex items-center border border-border rounded-none overflow-hidden">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-none"
            onClick={goBack}
            disabled={!nav.canBack}
            title={t("fileManager.back")}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-none border-l border-border"
            onClick={goForward}
            disabled={!nav.canForward}
            title={t("fileManager.forward")}
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-none border-l border-border"
            onClick={goUp}
            disabled={!parentPath}
            title={t("fileManager.up")}
          >
            <ArrowUp className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-none border-l border-border"
            onClick={goHome}
            disabled={!homePath}
            title={t("fileManager.localHome")}
          >
            <Home className="size-4" />
          </Button>
        </div>

        <Input
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitPathInput();
            if (e.key === "Escape" && currentPath) setPathInput(currentPath);
          }}
          onBlur={() => currentPath && setPathInput(currentPath)}
          spellCheck={false}
          className="h-7 flex-1 min-w-0 text-xs font-mono bg-muted/50 border-border rounded-none focus:ring-1 focus:ring-accent-brand/50"
          placeholder={t("fileManager.localPathPlaceholder")}
        />

        <div className="flex items-center border border-border rounded-none overflow-hidden">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-none"
            onClick={refresh}
            disabled={!currentPath || loading}
            title={t("fileManager.refresh")}
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-none border-l border-border"
            onClick={() => setCreating("folder")}
            disabled={!currentPath}
            title={t("fileManager.newFolder")}
          >
            <FolderPlus className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-none border-l border-border"
            onClick={() => setShowHidden((prev) => !prev)}
            title={
              showHidden
                ? t("fileManager.localHideHidden")
                : t("fileManager.localShowHidden")
            }
          >
            {showHidden ? (
              <Eye className="size-4" />
            ) : (
              <EyeOff className="size-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-none border-l border-border"
            onClick={() => currentPath && void revealLocalPath(currentPath)}
            disabled={!currentPath}
            title={t("fileManager.localRevealInFileManager")}
          >
            <FolderOpen className="size-4" />
          </Button>
        </div>

        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-none"
            onClick={onClose}
            title={t("fileManager.hideLocalFiles")}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>

      {/* Column headers */}
      <div
        className="grid gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-b border-border bg-card select-none"
        style={rowStyle}
        title={t("fileManager.columnsHint")}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setColumnMenu({ x: e.clientX, y: e.clientY, visible: true });
        }}
      >
        <button
          type="button"
          className="flex items-center gap-1 hover:text-accent-brand transition-colors text-left min-w-0"
          onClick={() => toggleSort("name")}
        >
          <span className="truncate">{t("fileManager.name")}</span>
          {sortIndicator("name")}
        </button>
        {columns.isVisible("modified") && (
          <div className="relative flex min-w-0">
            <ColumnResizeHandle {...columns.getHandleProps("modified")} />
            <button
              type="button"
              className="flex items-center gap-1 hover:text-accent-brand transition-colors text-left min-w-0 flex-1"
              onClick={() => toggleSort("modified")}
            >
              <span className="truncate">{t("fileManager.modified")}</span>
              {sortIndicator("modified")}
            </button>
          </div>
        )}
        {columns.isVisible("size") && (
          <div className="relative flex min-w-0">
            <ColumnResizeHandle {...columns.getHandleProps("size")} />
            <button
              type="button"
              className="flex items-center gap-1 justify-end hover:text-accent-brand transition-colors min-w-0 flex-1"
              onClick={() => toggleSort("size")}
            >
              <span className="truncate">{t("fileManager.size")}</span>
              {sortIndicator("size")}
            </button>
          </div>
        )}
        {columns.isVisible("kind") && (
          <div className="relative flex min-w-0">
            <ColumnResizeHandle {...columns.getHandleProps("kind")} />
            <button
              type="button"
              className="flex items-center gap-1 hover:text-accent-brand transition-colors text-left min-w-0 flex-1"
              onClick={() => toggleSort("kind")}
            >
              <span className="truncate">{t("fileManager.kind")}</span>
              {sortIndicator("kind")}
            </button>
          </div>
        )}
      </div>

      <ColumnVisibilityMenu
        x={columnMenu.x}
        y={columnMenu.y}
        isVisible={columnMenu.visible}
        columns={columns}
        onClose={closeColumnMenu}
      />

      {/* Body */}
      <div
        ref={scrollRef}
        className={cn(
          "flex-1 min-h-0 overflow-y-auto thin-scrollbar relative",
          showPaneOverlay && "bg-muted/20",
        )}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onClick={() => {
          setSelected(new Set());
          setAnchorPath(null);
        }}
        onContextMenu={(e) => openContextMenu(e)}
      >
        {parentEntry && (
          <div
            data-parent-entry
            title={t("fileManager.goToParentFolder")}
            style={rowStyle}
            className={cn(
              "grid gap-2 px-3 items-center text-xs cursor-default border-b border-border hover:bg-muted/50 rounded-none select-none transition-colors h-[34px]",
              isParentDropTarget &&
                "bg-accent-brand/20 outline outline-1 outline-dashed outline-accent-brand",
            )}
            onClick={(e) => {
              e.stopPropagation();
              if (e.detail === 2) goUp();
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDragOver={(e) => handleFolderDragOver(e, parentEntry)}
            onDragLeave={(e) => handleFolderDragLeave(e, parentEntry)}
            onDrop={(e) => handleFolderDrop(e, parentEntry)}
          >
            <div className="flex items-center gap-2.5 overflow-hidden pointer-events-none">
              <span className="shrink-0">
                <CornerLeftUp className="size-4 text-muted-foreground" />
              </span>
              <span className="font-bold tracking-tight text-muted-foreground">
                ..
              </span>
            </div>
          </div>
        )}

        {creating && (
          <div
            className="grid gap-2 px-3 items-center text-xs border-b border-border h-[34px]"
            style={rowStyle}
          >
            <div className="flex items-center gap-2.5">
              {creating === "folder" ? (
                <Folder className="size-4 text-accent-brand shrink-0" />
              ) : (
                <File className="size-4 text-muted-foreground shrink-0" />
              )}
              <input
                ref={newEntryInputRef}
                value={newEntryName}
                onChange={(e) => setNewEntryName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitNewEntry();
                  if (e.key === "Escape") {
                    setCreating(null);
                    setNewEntryName("");
                  }
                }}
                onBlur={() => void submitNewEntry()}
                onClick={(e) => e.stopPropagation()}
                placeholder={
                  creating === "folder"
                    ? t("fileManager.newFolder")
                    : t("fileManager.newFile")
                }
                className="flex-1 min-w-0 border border-accent-brand/60 bg-card px-2 py-0.5 text-xs rounded-none outline-none focus:ring-1 focus:ring-accent-brand/50"
              />
            </div>
          </div>
        )}

        {error ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
            <p className="font-bold uppercase tracking-widest text-[10px]">
              {t("fileManager.localCannotOpenFolder")}
            </p>
            <p className="font-mono break-all opacity-80">{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="rounded-none mt-2 text-[10px] font-bold uppercase tracking-widest"
              onClick={goHome}
            >
              {t("fileManager.localHome")}
            </Button>
          </div>
        ) : visibleEntries.length === 0 && !loading ? (
          <div className="flex-1 min-h-[200px] flex flex-col items-center justify-center text-muted-foreground opacity-10 gap-4 select-none pointer-events-none">
            <Folder className="size-24" strokeWidth={1} />
            <span className="text-xl font-black uppercase tracking-[0.2em]">
              {t("fileManager.emptyFolder")}
            </span>
          </div>
        ) : (
          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((vItem) => {
              const entry = visibleEntries[vItem.index];
              if (!entry) return null;
              const isSelected = selected.has(entry.path);
              const isFolderTarget =
                dropTarget?.kind === "folder" && dropTarget.path === entry.path;
              return (
                <div
                  key={entry.path}
                  data-index={vItem.index}
                  ref={virtualizer.measureElement}
                  className="absolute top-0 left-0 w-full"
                  style={{ transform: `translateY(${vItem.start}px)` }}
                >
                  <div
                    data-local-path={entry.path}
                    draggable
                    style={rowStyle}
                    className={cn(
                      "grid gap-2 px-3 items-center text-xs cursor-default border-b border-border hover:bg-muted/50 rounded-none select-none transition-colors h-[34px]",
                      isSelected && "bg-accent-brand/10",
                      isFolderTarget &&
                        "bg-accent-brand/20 outline outline-1 outline-dashed outline-accent-brand",
                      entry.hidden && "opacity-60",
                    )}
                    onClick={(e) => handleRowClick(entry, e)}
                    onContextMenu={(e) => openContextMenu(e, entry)}
                    onDragStart={(e) => handleRowDragStart(e, entry)}
                    onDragOver={(e) => handleFolderDragOver(e, entry)}
                    onDragLeave={(e) => handleFolderDragLeave(e, entry)}
                    onDrop={(e) => handleFolderDrop(e, entry)}
                    title={entry.path}
                  >
                    <div className="flex items-center gap-2.5 overflow-hidden pointer-events-none">
                      <span className="shrink-0">
                        <LocalEntryIcon entry={entry} />
                      </span>
                      {renaming?.path === entry.path ? (
                        <input
                          ref={renameInputRef}
                          value={renaming.name}
                          onChange={(e) =>
                            setRenaming({
                              path: entry.path,
                              name: e.target.value,
                            })
                          }
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") void submitRename();
                            if (e.key === "Escape") setRenaming(null);
                          }}
                          onBlur={() => void submitRename()}
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                          draggable={false}
                          onDragStart={(e) => e.preventDefault()}
                          className="flex-1 min-w-0 border border-accent-brand/60 bg-card px-2 py-0.5 text-xs rounded-none outline-none focus:ring-1 focus:ring-accent-brand/50 pointer-events-auto"
                        />
                      ) : (
                        <span className="font-bold truncate tracking-tight">
                          {entry.name}
                          {entry.type === "link" && entry.linkTarget && (
                            <span className="text-accent-brand ml-1 font-normal">
                              → {entry.linkTarget}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                    {columns.isVisible("modified") && (
                      <span className="text-muted-foreground truncate pointer-events-none tabular-nums">
                        {formatLocalModified(entry.modifiedTimestamp)}
                      </span>
                    )}
                    {columns.isVisible("size") && (
                      <span className="text-muted-foreground text-right pointer-events-none tabular-nums">
                        {entry.type === "directory"
                          ? "--"
                          : formatFileSize(entry.size)}
                      </span>
                    )}
                    {columns.isVisible("kind") && (
                      <span className="text-muted-foreground truncate pointer-events-none">
                        {describeLocalKind(entry)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {showPaneOverlay && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10 pointer-events-none">
            <div className="text-center p-6 bg-card/95 border border-accent-brand/40 flex flex-col items-center gap-3">
              <Download className="size-10 text-accent-brand" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-accent-brand">
                {t("fileManager.dropToDownloadHere")}
              </p>
            </div>
          </div>
        )}
      </div>

      <LocalFileContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        entries={contextMenu.entries}
        isVisible={contextMenu.visible}
        showHidden={showHidden}
        canUpload={!!onUploadToRemote}
        onClose={closeContextMenu}
        onOpen={openEntry}
        onUploadToRemote={(targets) =>
          onUploadToRemote?.(targets.map((e) => e.path))
        }
        onReveal={(entry) => {
          const target = entry?.path ?? currentPath;
          if (target) void revealLocalPath(target);
        }}
        onRename={startRename}
        onCopyPath={copyEntryPaths}
        onNewFolder={() => setCreating("folder")}
        onNewFile={() => setCreating("file")}
        onRefresh={refresh}
        onToggleHidden={() => setShowHidden((prev) => !prev)}
        onDelete={trashEntries}
      />

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-1 border-t border-border text-[10px] text-muted-foreground">
        <span>
          {t("fileManager.localItemCount", { count: visibleEntries.length })}
        </span>
        {selected.size > 0 && (
          <span>
            {t("fileManager.localSelectedCount", { count: selected.size })}
          </span>
        )}
      </div>
    </div>
  );
}
