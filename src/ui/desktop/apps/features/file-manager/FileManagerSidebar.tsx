import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { cn } from "@/lib/utils.ts";
import { Star, Clock, Bookmark, File, Folder } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SSHHost } from "@/types";
import {
  getRecentFiles,
  getPinnedFiles,
  getFolderShortcuts,
  listSSHFiles,
  removeRecentFile,
  removePinnedFile,
  removeFolderShortcut,
} from "@/ui/main-axios.ts";
import { toast } from "sonner";
import FolderTree from "@/components/ui/folder.tsx";

// ─── Interfaces ────────────────────────────────────────────────────────────────

interface RecentFileData {
  id: number;
  name: string;
  path: string;
  lastOpened?: string;
  [key: string]: unknown;
}

interface PinnedFileData {
  id: number;
  name: string;
  path: string;
  [key: string]: unknown;
}

interface ShortcutData {
  id: number;
  name: string;
  path: string;
  [key: string]: unknown;
}

interface DirectoryItemData {
  name: string;
  path: string;
  type: string;
  [key: string]: unknown;
}

export interface SidebarItem {
  id: string;
  name: string;
  path: string;
  type: "recent" | "pinned" | "shortcut" | "folder";
  lastAccessed?: string;
  isExpanded?: boolean;
  children?: SidebarItem[];
}

interface FileManagerSidebarProps {
  currentHost: SSHHost;
  currentPath: string;
  onPathChange: (path: string) => void;
  onFileOpen?: (file: SidebarItem) => void;
  sshSessionId?: string;
  refreshTrigger?: number;
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function FileManagerSidebar({
  currentHost,
  currentPath,
  onPathChange,
  onFileOpen,
  sshSessionId,
  refreshTrigger,
}: FileManagerSidebarProps) {
  const { t } = useTranslation();

  // ── Quick access state (API-backed) ──────────────────────────────────────────
  const [recentItems, setRecentItems] = useState<SidebarItem[]>([]);
  const [pinnedItems, setPinnedItems] = useState<SidebarItem[]>([]);
  const [shortcuts, setShortcuts] = useState<SidebarItem[]>([]);

  // ── Directory tree state ──────────────────────────────────────────────────────
  const [directoryTree, setDirectoryTree] = useState<SidebarItem[]>([]);

  /**
   * Tracks which folder paths have already been lazy-loaded so we don't
   * re-fetch on every re-selection / collapse-reopen.
   */
  const loadedFoldersRef = useRef<Set<string>>(new Set(["/"]));

  // ── Context menu state ────────────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    isVisible: boolean;
    item: SidebarItem | null;
  }>({
    x: 0,
    y: 0,
    isVisible: false,
    item: null,
  });

  // ─── Effects ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    loadQuickAccessData();
  }, [currentHost, refreshTrigger]);

  useEffect(() => {
    if (sshSessionId) {
      loadedFoldersRef.current = new Set(["/"]);
      loadDirectoryTree();
    }
  }, [sshSessionId]);

  // When currentPath changes externally (grid navigation), ensure the parent
  // directory is loaded in the tree so the selection highlight can appear.
  useEffect(() => {
    if (!sshSessionId || currentPath === "/") return;

    const parentPath =
      currentPath.substring(0, currentPath.lastIndexOf("/")) || "/";

    const findByPath = (items: SidebarItem[]): SidebarItem | null => {
      for (const item of items) {
        if (item.path === parentPath) return item;
        if (item.children) {
          const found = findByPath(item.children);
          if (found) return found;
        }
      }
      return null;
    };

    const parent = findByPath(directoryTree);
    if (parent && !loadedFoldersRef.current.has(parent.path)) {
      loadedFoldersRef.current.add(parent.path);
      loadSubdirectory(parent.id, parent.path);
    }
  }, [currentPath, sshSessionId]);

  // ─── API: Quick access ────────────────────────────────────────────────────────

  const loadQuickAccessData = async () => {
    if (!currentHost?.id) return;

    try {
      const recentData = await getRecentFiles(currentHost.id);
      const recentItems = (recentData as RecentFileData[])
        .slice(0, 5)
        .map((item: RecentFileData) => ({
          id: `recent-${item.id}`,
          name: item.name,
          path: item.path,
          type: "recent" as const,
          lastAccessed: item.lastOpened,
        }));
      setRecentItems(recentItems);

      const pinnedData = await getPinnedFiles(currentHost.id);
      const pinnedItems = (pinnedData as PinnedFileData[]).map(
        (item: PinnedFileData) => ({
          id: `pinned-${item.id}`,
          name: item.name,
          path: item.path,
          type: "pinned" as const,
        }),
      );
      setPinnedItems(pinnedItems);

      const shortcutData = await getFolderShortcuts(currentHost.id);
      const shortcutItems = (shortcutData as ShortcutData[]).map(
        (item: ShortcutData) => ({
          id: `shortcut-${item.id}`,
          name: item.name,
          path: item.path,
          type: "shortcut" as const,
        }),
      );
      setShortcuts(shortcutItems);
    } catch (error) {
      console.error("Failed to load quick access data:", error);
      setRecentItems([]);
      setPinnedItems([]);
      setShortcuts([]);
    }
  };

  // ─── API: Directory tree ──────────────────────────────────────────────────────

  const loadDirectoryTree = async (attempt = 0) => {
    if (!sshSessionId) return;

    try {
      const response = await listSSHFiles(sshSessionId, "/");
      const rootFiles = (response.files || []) as DirectoryItemData[];
      const rootFolders = rootFiles.filter(
        (item: DirectoryItemData) => item.type === "directory",
      );

      const rootTreeItems = rootFolders.map((folder: DirectoryItemData) => ({
        id: `folder-${folder.name}`,
        name: folder.name,
        path: folder.path,
        type: "folder" as const,
        isExpanded: false,
        children: [],
      }));

      setDirectoryTree([
        {
          id: "root",
          name: "/",
          path: "/",
          type: "folder" as const,
          isExpanded: true,
          children: rootTreeItems,
        },
      ]);
    } catch (error: unknown) {
      const status =
        (error as { status?: number })?.status ||
        (error as { response?: { status?: number } })?.response?.status;
      if (status === 409 && attempt < 3) {
        // Another request was already listing "/" — retry after a short delay
        setTimeout(() => loadDirectoryTree(attempt + 1), 600);
        return;
      }
      console.error("Failed to load directory tree:", error);
      setDirectoryTree([
        {
          id: "root",
          name: "/",
          path: "/",
          type: "folder" as const,
          isExpanded: false,
          children: [],
        },
      ]);
    }
  };

  /**
   * Lazily fetches subdirectory contents and patches them into the tree state.
   * Called the first time a folder is expanded via FolderTree's onSelect.
   */
  const loadSubdirectory = useCallback(
    async (folderId: string, folderPath: string) => {
      if (!sshSessionId) return;

      try {
        const subResponse = await listSSHFiles(sshSessionId, folderPath);
        const subFiles = (subResponse.files || []) as DirectoryItemData[];
        const subFolders = subFiles.filter(
          (item: DirectoryItemData) => item.type === "directory",
        );

        const subTreeItems = subFolders.map((folder: DirectoryItemData) => ({
          id: `folder-${folder.path.replace(/\//g, "-")}`,
          name: folder.name,
          path: folder.path,
          type: "folder" as const,
          isExpanded: false,
          children: [],
        }));

        setDirectoryTree((prevTree) => {
          const updateChildren = (items: SidebarItem[]): SidebarItem[] =>
            items.map((item) => {
              if (item.id === folderId) {
                return { ...item, children: subTreeItems };
              }
              if (item.children) {
                return { ...item, children: updateChildren(item.children) };
              }
              return item;
            });
          return updateChildren(prevTree);
        });
      } catch (error: unknown) {
        const status =
          (error as { status?: number })?.status ||
          (error as { response?: { status?: number } })?.response?.status;
        if (status === 409) {
          // Another request was listing this path — retry after the lock clears
          setTimeout(() => loadSubdirectory(folderId, folderPath), 600);
          return;
        }
        console.error("Failed to load subdirectory:", error);
      }
    },
    [sshSessionId],
  );

  // ─── Quick-access mutation handlers ──────────────────────────────────────────

  const handleRemoveRecentFile = async (item: SidebarItem) => {
    if (!currentHost?.id) return;
    try {
      await removeRecentFile(currentHost.id, item.path);
      loadQuickAccessData();
      toast.success(
        t("fileManager.removedFromRecentFiles", { name: item.name }),
      );
    } catch (error) {
      console.error("Failed to remove recent file:", error);
      toast.error(t("fileManager.removeFailed"));
    }
  };

  const handleUnpinFile = async (item: SidebarItem) => {
    if (!currentHost?.id) return;
    try {
      await removePinnedFile(currentHost.id, item.path);
      loadQuickAccessData();
      toast.success(t("fileManager.unpinnedSuccessfully", { name: item.name }));
    } catch (error) {
      console.error("Failed to unpin file:", error);
      toast.error(t("fileManager.unpinFailed"));
    }
  };

  const handleRemoveShortcut = async (item: SidebarItem) => {
    if (!currentHost?.id) return;
    try {
      await removeFolderShortcut(currentHost.id, item.path);
      loadQuickAccessData();
      toast.success(t("fileManager.removedShortcut", { name: item.name }));
    } catch (error) {
      console.error("Failed to remove shortcut:", error);
      toast.error(t("fileManager.removeShortcutFailed"));
    }
  };

  const handleClearAllRecent = async () => {
    if (!currentHost?.id || recentItems.length === 0) return;
    try {
      await Promise.all(
        recentItems.map((item) => removeRecentFile(currentHost.id, item.path)),
      );
      loadQuickAccessData();
      toast.success(t("fileManager.clearedAllRecentFiles"));
    } catch (error) {
      console.error("Failed to clear recent files:", error);
      toast.error(t("fileManager.clearFailed"));
    }
  };

  // ─── Quick-access item click ──────────────────────────────────────────────────

  const handleQuickAccessClick = (item: SidebarItem) => {
    if (item.type === "recent" || item.type === "pinned") {
      if (onFileOpen) {
        onFileOpen(item);
      } else {
        const directory =
          item.path.substring(0, item.path.lastIndexOf("/")) || "/";
        onPathChange(directory);
      }
    } else if (item.type === "shortcut") {
      onPathChange(item.path);
    }
  };

  // ─── FolderTree directory selection (onSelect callback) ──────────────────────

  /**
   * Called by FolderTree whenever the user selects (clicks) a tree item.
   * We navigate to the folder and lazily load children on first visit.
   */
  const handleDirectorySelect = useCallback(
    async (id: string) => {
      // Walk the tree to find the item by id
      const findItem = (items: SidebarItem[]): SidebarItem | null => {
        for (const item of items) {
          if (item.id === id) return item;
          if (item.children) {
            const found = findItem(item.children);
            if (found) return found;
          }
        }
        return null;
      };

      const item = findItem(directoryTree);
      if (!item) return;

      // Navigate to path
      onPathChange(item.path);

      // Lazy-load children the first time this folder is expanded
      if (
        sshSessionId &&
        item.path !== "/" &&
        !loadedFoldersRef.current.has(item.path)
      ) {
        loadedFoldersRef.current.add(item.path);
        await loadSubdirectory(id, item.path);
      }
    },
    [directoryTree, onPathChange, sshSessionId, loadSubdirectory],
  );

  // ─── Context menu ─────────────────────────────────────────────────────────────

  const handleContextMenu = (e: React.MouseEvent, item: SidebarItem) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, isVisible: true, item });
  };

  const closeContextMenu = () => {
    setContextMenu((prev) => ({ ...prev, isVisible: false, item: null }));
  };

  useEffect(() => {
    if (!contextMenu.isVisible) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      const menuElement = document.querySelector("[data-sidebar-context-menu]");
      if (!menuElement?.contains(target)) closeContextMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeContextMenu();
    };

    const timeoutId = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }, 50);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu.isVisible]);

  // ─── Derive selected tree node + ancestors from currentPath ──────────────────

  const { selectedTreeId, ancestorIds } = useMemo(() => {
    if (currentPath === "/")
      return { selectedTreeId: "root", ancestorIds: new Set<string>() };

    const ancestors: string[] = [];
    const findByPath = (
      items: SidebarItem[],
      path: string[],
    ): string | null => {
      for (const item of items) {
        if (item.path === currentPath) {
          ancestors.push(...path, "root");
          return item.id;
        }
        if (item.children) {
          const found = findByPath(item.children, [...path, item.id]);
          if (found) return found;
        }
      }
      return null;
    };

    const id = findByPath(directoryTree, []);
    return { selectedTreeId: id, ancestorIds: new Set(ancestors) };
  }, [currentPath, directoryTree]);

  // ─── Render helpers ───────────────────────────────────────────────────────────

  /**
   * Recursively renders directory tree items using FolderTree.Item + Content.
   *
   * FolderTree.Item detects "has children" via React.Children.count > 0.
   * By always wrapping children in <FolderTree.Content> (even when the
   * children array is empty), every directory shows the expand chevron.
   * FolderTree.Content internally shows nothing when its own children are
   * absent, so an unloaded folder simply expands to an empty state while
   * the async fetch fills it in.
   */
  const renderFolderTreeItem = (item: SidebarItem): React.ReactNode => (
    <FolderTree.Item key={item.id} id={item.id} label={item.name}>
      <FolderTree.Content>
        {item.children?.map((child) => renderFolderTreeItem(child))}
      </FolderTree.Content>
    </FolderTree.Item>
  );

  /**
   * Styled quick-access row (recent / pinned / shortcut).
   * Mirrors FolderTree.Item's visual language but adds onContextMenu support.
   */
  const renderQuickAccessItem = (item: SidebarItem, icon: React.ReactNode) => {
    const dirPath =
      item.type === "shortcut"
        ? item.path
        : item.path.substring(0, item.path.lastIndexOf("/")) || "/";
    const isActive = currentPath === dirPath;

    return (
      <div
        key={item.id}
        className={cn(
          "flex items-center gap-2 py-1.5 pl-8 pr-3 text-sm cursor-pointer select-none transition-colors",
          isActive
            ? "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 border-r-2 border-blue-600"
            : "hover:bg-gray-100 dark:hover:bg-slate-700/50 text-foreground",
        )}
        onClick={() => handleQuickAccessClick(item)}
        onContextMenu={(e) => handleContextMenu(e, item)}
        title={item.path}
      >
        {/* indent spacer matching FolderTree level-1 padding */}
        <span className="w-3 shrink-0" aria-hidden="true" />
        {icon}
        <span className="flex-1 truncate">{item.name}</span>
      </div>
    );
  };

  /**
   * Section header + items list.
   * Returns null when items is empty so empty sections are hidden.
   */
  const renderSection = (
    title: string,
    headerIcon: React.ReactNode,
    items: SidebarItem[],
    renderItem: (item: SidebarItem) => React.ReactNode,
  ) => {
    if (items.length === 0) return null;
    return (
      <div className="mb-4">
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {headerIcon}
          {title}
        </div>
        <div className="mt-0.5">{items.map((item) => renderItem(item))}</div>
      </div>
    );
  };

  const hasQuickAccessItems =
    recentItems.length > 0 || pinnedItems.length > 0 || shortcuts.length > 0;

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="h-full flex flex-col bg-canvas border-r border-edge">
        <div className="flex-1 relative overflow-hidden">
          <div className="absolute inset-1.5 overflow-y-auto thin-scrollbar space-y-1">
            {/* ── Recent files ──────────────────────────────────────── */}
            {renderSection(
              t("fileManager.recent"),
              <Clock className="w-3 h-3" />,
              recentItems,
              (item) =>
                renderQuickAccessItem(
                  item,
                  <File
                    size={15}
                    className={cn(
                      "shrink-0",
                      currentPath ===
                        (item.path.substring(0, item.path.lastIndexOf("/")) ||
                          "/")
                        ? "text-blue-600 dark:text-blue-400"
                        : "text-gray-500 dark:text-gray-400",
                    )}
                  />,
                ),
            )}

            {/* ── Pinned files ───────────────────────────────────────── */}
            {renderSection(
              t("fileManager.pinned"),
              <Star className="w-3 h-3" />,
              pinnedItems,
              (item) =>
                renderQuickAccessItem(
                  item,
                  <File
                    size={15}
                    className={cn(
                      "shrink-0",
                      currentPath ===
                        (item.path.substring(0, item.path.lastIndexOf("/")) ||
                          "/")
                        ? "text-blue-600 dark:text-blue-400"
                        : "text-gray-500 dark:text-gray-400",
                    )}
                  />,
                ),
            )}

            {/* ── Folder shortcuts ───────────────────────────────────── */}
            {renderSection(
              t("fileManager.folderShortcuts"),
              <Bookmark className="w-3 h-3" />,
              shortcuts,
              (item) =>
                renderQuickAccessItem(
                  item,
                  <Folder
                    size={15}
                    className={cn(
                      "shrink-0",
                      currentPath === item.path
                        ? "text-blue-600 dark:text-blue-400"
                        : "text-blue-500 dark:text-blue-400",
                    )}
                  />,
                ),
            )}

            {/* ── Directory tree ─────────────────────────────────────── */}
            <div
              className={cn(hasQuickAccessItems && "pt-3 border-t border-edge")}
            >
              <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <Folder className="w-3 h-3" />
                {t("fileManager.directories")}
              </div>

              <div className="mt-1">
                {/*
                 * FolderTree.Root manages its own expansion state internally.
                 * We pass `onSelect` to be notified of clicks so we can:
                 *   1. Navigate to the selected path (onPathChange)
                 *   2. Lazy-load subdirectory children on first expand
                 *
                 * The root "/" folder is pre-expanded via defaultExpanded.
                 *
                 * className overrides strip the default card styling so the
                 * tree blends seamlessly into the sidebar panel.
                 */}
                <FolderTree.Root
                  id="sidebar-directory-tree"
                  defaultExpanded={["root"]}
                  selectedId={selectedTreeId}
                  expandedIds={ancestorIds}
                  onSelect={(id) => handleDirectorySelect(id)}
                  className="bg-transparent border-0 rounded-none shadow-none"
                >
                  {directoryTree.map((item) => renderFolderTreeItem(item))}
                </FolderTree.Root>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Context menu ─────────────────────────────────────────────── */}
      {contextMenu.isVisible && contextMenu.item && (
        <>
          {/* Transparent backdrop to capture outside clicks */}
          <div className="fixed inset-0 z-40" />

          <div
            data-sidebar-context-menu
            className="fixed bg-canvas border border-edge rounded-lg shadow-xl min-w-[160px] z-50 overflow-hidden"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {/* Recent item actions */}
            {contextMenu.item.type === "recent" && (
              <>
                <button
                  className="w-full px-3 py-2 text-left text-sm flex items-center gap-3 hover:bg-hover text-foreground first:rounded-t-lg last:rounded-b-lg"
                  onClick={() => {
                    handleRemoveRecentFile(contextMenu.item!);
                    closeContextMenu();
                  }}
                >
                  <Clock className="w-4 h-4 shrink-0" />
                  <span className="flex-1">
                    {t("fileManager.removeFromRecentFiles")}
                  </span>
                </button>

                {recentItems.length > 1 && (
                  <>
                    <div className="border-t border-edge" />
                    <button
                      className="w-full px-3 py-2 text-left text-sm flex items-center gap-3 hover:bg-red-500/10 text-red-400 first:rounded-t-lg last:rounded-b-lg"
                      onClick={() => {
                        handleClearAllRecent();
                        closeContextMenu();
                      }}
                    >
                      <Clock className="w-4 h-4 shrink-0" />
                      <span className="flex-1">
                        {t("fileManager.clearAllRecentFiles")}
                      </span>
                    </button>
                  </>
                )}
              </>
            )}

            {/* Pinned item actions */}
            {contextMenu.item.type === "pinned" && (
              <button
                className="w-full px-3 py-2 text-left text-sm flex items-center gap-3 hover:bg-hover text-foreground first:rounded-t-lg last:rounded-b-lg"
                onClick={() => {
                  handleUnpinFile(contextMenu.item!);
                  closeContextMenu();
                }}
              >
                <Star className="w-4 h-4 shrink-0" />
                <span className="flex-1">{t("fileManager.unpinFile")}</span>
              </button>
            )}

            {/* Shortcut item actions */}
            {contextMenu.item.type === "shortcut" && (
              <button
                className="w-full px-3 py-2 text-left text-sm flex items-center gap-3 hover:bg-hover text-foreground first:rounded-t-lg last:rounded-b-lg"
                onClick={() => {
                  handleRemoveShortcut(contextMenu.item!);
                  closeContextMenu();
                }}
              >
                <Bookmark className="w-4 h-4 shrink-0" />
                <span className="flex-1">
                  {t("fileManager.removeShortcut")}
                </span>
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}
