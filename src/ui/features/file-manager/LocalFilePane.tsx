import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
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
  createLocalFolder,
  getLocalHome,
  listLocalDirectory,
  openLocalPath,
  revealLocalPath,
} from "@/lib/local-files.ts";
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

export interface LocalFilePaneProps {
  /** Bump to force a re-read of the current directory. */
  refreshToken?: number;
  onClose?: () => void;
  /**
   * Remote grid items were dropped on this pane (or on one of its folders).
   * `remotePaths` are the dragged remote paths; `localDir` is where they go.
   */
  onRemoteItemsDropped: (remotePaths: string[], localDir: string) => void;
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
  onPathChange,
}: LocalFilePaneProps) {
  const { t } = useTranslation();
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
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [dropTarget, setDropTarget] = useState<
    { kind: "pane" } | { kind: "folder"; path: string } | null
  >(null);
  const dragCounter = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const currentPathRef = useRef<string | null>(null);
  currentPathRef.current = currentPath;

  const visibleEntries = useMemo(() => {
    const filtered = showHidden
      ? entries
      : entries.filter((entry) => !entry.hidden);
    return sortLocalEntries(filtered, sortBy, sortOrder);
  }, [entries, showHidden, sortBy, sortOrder]);

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
    if (creatingFolder) newFolderInputRef.current?.focus();
  }, [creatingFolder]);

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
      if (entry.type === "directory") {
        void navigateTo(entry.path);
      } else {
        void openLocalPath(entry.path).catch(() => {
          void revealLocalPath(entry.path);
        });
      }
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

  const submitNewFolder = async () => {
    const name = newFolderName.trim();
    setCreatingFolder(false);
    setNewFolderName("");
    if (!name || !currentPath) return;
    try {
      await createLocalFolder(currentPath, name);
      await load(currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const showPaneOverlay = dropTarget?.kind === "pane";

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
            onClick={() => setCreatingFolder(true)}
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
      <div className="grid grid-cols-[1fr_130px_72px_64px] gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-b border-border bg-card select-none">
        <button
          type="button"
          className="flex items-center gap-1 hover:text-accent-brand transition-colors text-left"
          onClick={() => toggleSort("name")}
        >
          {t("fileManager.name")}
          {sortIndicator("name")}
        </button>
        <button
          type="button"
          className="flex items-center gap-1 hover:text-accent-brand transition-colors text-left"
          onClick={() => toggleSort("modified")}
        >
          {t("fileManager.modified")}
          {sortIndicator("modified")}
        </button>
        <button
          type="button"
          className="flex items-center gap-1 justify-end hover:text-accent-brand transition-colors"
          onClick={() => toggleSort("size")}
        >
          {t("fileManager.size")}
          {sortIndicator("size")}
        </button>
        <button
          type="button"
          className="flex items-center gap-1 hover:text-accent-brand transition-colors text-left"
          onClick={() => toggleSort("kind")}
        >
          {t("fileManager.kind")}
          {sortIndicator("kind")}
        </button>
      </div>

      {/* Body */}
      <div
        ref={scrollRef}
        className={cn(
          "flex-1 min-h-0 overflow-y-auto thin-scrollbar relative",
          showPaneOverlay && "bg-muted/20",
        )}
        onClick={() => {
          setSelected(new Set());
          setAnchorPath(null);
        }}
      >
        {creatingFolder && (
          <div className="grid grid-cols-[1fr_130px_72px_64px] gap-2 px-3 items-center text-xs border-b border-border h-[34px]">
            <div className="flex items-center gap-2.5">
              <Folder className="size-4 text-accent-brand shrink-0" />
              <input
                ref={newFolderInputRef}
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitNewFolder();
                  if (e.key === "Escape") {
                    setCreatingFolder(false);
                    setNewFolderName("");
                  }
                }}
                onBlur={() => void submitNewFolder()}
                onClick={(e) => e.stopPropagation()}
                placeholder={t("fileManager.newFolder")}
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
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-10 gap-4 select-none pointer-events-none">
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
                    className={cn(
                      "grid grid-cols-[1fr_130px_72px_64px] gap-2 px-3 items-center text-xs cursor-default border-b border-border hover:bg-muted/50 rounded-none select-none transition-colors h-[34px]",
                      isSelected && "bg-accent-brand/10",
                      isFolderTarget &&
                        "bg-accent-brand/20 outline outline-1 outline-dashed outline-accent-brand",
                      entry.hidden && "opacity-60",
                    )}
                    onClick={(e) => handleRowClick(entry, e)}
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
                      <span className="font-bold truncate tracking-tight">
                        {entry.name}
                        {entry.type === "link" && entry.linkTarget && (
                          <span className="text-accent-brand ml-1 font-normal">
                            → {entry.linkTarget}
                          </span>
                        )}
                      </span>
                    </div>
                    <span className="text-muted-foreground truncate pointer-events-none tabular-nums">
                      {formatLocalModified(entry.modifiedTimestamp)}
                    </span>
                    <span className="text-muted-foreground text-right pointer-events-none tabular-nums">
                      {entry.type === "directory"
                        ? "--"
                        : formatFileSize(entry.size)}
                    </span>
                    <span className="text-muted-foreground truncate pointer-events-none">
                      {describeLocalKind(entry)}
                    </span>
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
