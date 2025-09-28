import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  File,
  Star,
  Clock,
  Bookmark,
  FolderOpen,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SSHHost } from "@/types/index";
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
  onLoadDirectory?: (path: string) => void;
  onFileOpen?: (file: SidebarItem) => void;
  sshSessionId?: string;
  refreshTrigger?: number;
}

export function FileManagerSidebar({
  currentHost,
  currentPath,
  onPathChange,
  onLoadDirectory,
  onFileOpen,
  sshSessionId,
  refreshTrigger,
}: FileManagerSidebarProps) {
  const { t } = useTranslation();
  const [recentItems, setRecentItems] = useState<SidebarItem[]>([]);
  const [pinnedItems, setPinnedItems] = useState<SidebarItem[]>([]);
  const [shortcuts, setShortcuts] = useState<SidebarItem[]>([]);
  const [directoryTree, setDirectoryTree] = useState<SidebarItem[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(["root"]),
  );

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

  useEffect(() => {
    loadQuickAccessData();
  }, [currentHost, refreshTrigger]);

  useEffect(() => {
    if (sshSessionId) {
      loadDirectoryTree();
    }
  }, [sshSessionId]);

  const loadQuickAccessData = async () => {
    if (!currentHost?.id) return;

    try {
      const recentData = await getRecentFiles(currentHost.id);
      const recentItems = recentData.slice(0, 5).map((item: any) => ({
        id: `recent-${item.id}`,
        name: item.name,
        path: item.path,
        type: "recent" as const,
        lastAccessed: item.lastOpened,
      }));
      setRecentItems(recentItems);

      const pinnedData = await getPinnedFiles(currentHost.id);
      const pinnedItems = pinnedData.map((item: any) => ({
        id: `pinned-${item.id}`,
        name: item.name,
        path: item.path,
        type: "pinned" as const,
      }));
      setPinnedItems(pinnedItems);

      const shortcutData = await getFolderShortcuts(currentHost.id);
      const shortcutItems = shortcutData.map((item: any) => ({
        id: `shortcut-${item.id}`,
        name: item.name,
        path: item.path,
        type: "shortcut" as const,
      }));
      setShortcuts(shortcutItems);
    } catch (error) {
      console.error("Failed to load quick access data:", error);
      setRecentItems([]);
      setPinnedItems([]);
      setShortcuts([]);
    }
  };

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

  const handleContextMenu = (e: React.MouseEvent, item: SidebarItem) => {
    e.preventDefault();
    e.stopPropagation();

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      isVisible: true,
      item,
    });
  };

  const closeContextMenu = () => {
    setContextMenu((prev) => ({ ...prev, isVisible: false, item: null }));
  };

  useEffect(() => {
    if (!contextMenu.isVisible) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      const menuElement = document.querySelector("[data-sidebar-context-menu]");

      if (!menuElement?.contains(target)) {
        closeContextMenu();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeContextMenu();
      }
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

  const loadDirectoryTree = async () => {
    if (!sshSessionId) return;

    try {
      const response = await listSSHFiles(sshSessionId, "/");

      const rootFiles = response.files || [];
      const rootFolders = rootFiles.filter(
        (item: any) => item.type === "directory",
      );

      const rootTreeItems = rootFolders.map((folder: any) => ({
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
    } catch (error) {
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

  const handleItemClick = (item: SidebarItem) => {
    if (item.type === "folder") {
      toggleFolder(item.id, item.path);
      onPathChange(item.path);
    } else if (item.type === "recent" || item.type === "pinned") {
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

  const toggleFolder = async (folderId: string, folderPath?: string) => {
    const newExpanded = new Set(expandedFolders);

    if (newExpanded.has(folderId)) {
      newExpanded.delete(folderId);
    } else {
      newExpanded.add(folderId);

      if (sshSessionId && folderPath && folderPath !== "/") {
        try {
          const subResponse = await listSSHFiles(sshSessionId, folderPath);

          const subFiles = subResponse.files || [];
          const subFolders = subFiles.filter(
            (item: any) => item.type === "directory",
          );

          const subTreeItems = subFolders.map((folder: any) => ({
            id: `folder-${folder.path.replace(/\//g, "-")}`,
            name: folder.name,
            path: folder.path,
            type: "folder" as const,
            isExpanded: false,
            children: [],
          }));

          setDirectoryTree((prevTree) => {
            const updateChildren = (items: SidebarItem[]): SidebarItem[] => {
              return items.map((item) => {
                if (item.id === folderId) {
                  return { ...item, children: subTreeItems };
                } else if (item.children) {
                  return { ...item, children: updateChildren(item.children) };
                }
                return item;
              });
            };
            return updateChildren(prevTree);
          });
        } catch (error) {
          console.error("Failed to load subdirectory:", error);
        }
      }
    }

    setExpandedFolders(newExpanded);
  };

  const renderSidebarItem = (item: SidebarItem, level: number = 0) => {
    const isExpanded = expandedFolders.has(item.id);
    const isActive = currentPath === item.path;

    return (
      <div key={item.id}>
        <div
          className={cn(
            "flex items-center gap-2 py-1.5 text-sm cursor-pointer hover:bg-dark-hover rounded",
            isActive && "bg-primary/20 text-primary",
            "text-white",
          )}
          style={{ paddingLeft: `${12 + level * 16}px`, paddingRight: "12px" }}
          onClick={() => handleItemClick(item)}
          onContextMenu={(e) => {
            if (
              item.type === "recent" ||
              item.type === "pinned" ||
              item.type === "shortcut"
            ) {
              handleContextMenu(e, item);
            }
          }}
        >
          {item.type === "folder" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleFolder(item.id, item.path);
              }}
              className="p-0.5 hover:bg-dark-hover rounded"
            >
              {isExpanded ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
            </button>
          )}

          {item.type === "folder" ? (
            isExpanded ? (
              <FolderOpen className="w-4 h-4" />
            ) : (
              <Folder className="w-4 h-4" />
            )
          ) : (
            <File className="w-4 h-4" />
          )}

          <span className="truncate">{item.name}</span>
        </div>

        {item.type === "folder" && isExpanded && item.children && (
          <div>
            {item.children.map((child) => renderSidebarItem(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  const renderSection = (
    title: string,
    icon: React.ReactNode,
    items: SidebarItem[],
  ) => {
    if (items.length === 0) return null;

    return (
      <div className="mb-5">
        <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {icon}
          {title}
        </div>
        <div className="space-y-0.5">
          {items.map((item) => renderSidebarItem(item))}
        </div>
      </div>
    );
  };

  const hasQuickAccessItems =
    recentItems.length > 0 || pinnedItems.length > 0 || shortcuts.length > 0;

  return (
    <>
      <div className="h-full flex flex-col bg-dark-bg border-r border-dark-border">
        <div className="flex-1 relative overflow-hidden">
          <div className="absolute inset-1.5 overflow-y-auto thin-scrollbar space-y-4">
            {renderSection(
              t("fileManager.recent"),
              <Clock className="w-3 h-3" />,
              recentItems,
            )}
            {renderSection(
              t("fileManager.pinned"),
              <Star className="w-3 h-3" />,
              pinnedItems,
            )}
            {renderSection(
              t("fileManager.folderShortcuts"),
              <Bookmark className="w-3 h-3" />,
              shortcuts,
            )}

            <div
              className={cn(
                hasQuickAccessItems && "pt-4 border-t border-dark-border",
              )}
            >
              <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                <Folder className="w-3 h-3" />
                {t("fileManager.directories")}
              </div>
              <div className="mt-2">
                {directoryTree.map((item) => renderSidebarItem(item))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {contextMenu.isVisible && contextMenu.item && (
        <>
          <div className="fixed inset-0 z-40" />
          <div
            data-sidebar-context-menu
            className="fixed bg-dark-bg border border-dark-border rounded-lg shadow-xl min-w-[160px] z-50 overflow-hidden"
            style={{
              left: contextMenu.x,
              top: contextMenu.y,
            }}
          >
            {contextMenu.item.type === "recent" && (
              <>
                <button
                  className="w-full px-3 py-2 text-left text-sm flex items-center gap-3 hover:bg-dark-hover text-white first:rounded-t-lg last:rounded-b-lg"
                  onClick={() => {
                    handleRemoveRecentFile(contextMenu.item!);
                    closeContextMenu();
                  }}
                >
                  <div className="flex-shrink-0">
                    <Clock className="w-4 h-4" />
                  </div>
                  <span className="flex-1">
                    {t("fileManager.removeFromRecentFiles")}
                  </span>
                </button>
                {recentItems.length > 1 && (
                  <>
                    <div className="border-t border-dark-border" />
                    <button
                      className="w-full px-3 py-2 text-left text-sm flex items-center gap-3 hover:bg-dark-hover text-red-400 hover:bg-red-500/10 first:rounded-t-lg last:rounded-b-lg"
                      onClick={() => {
                        handleClearAllRecent();
                        closeContextMenu();
                      }}
                    >
                      <div className="flex-shrink-0">
                        <Clock className="w-4 h-4" />
                      </div>
                      <span className="flex-1">
                        {t("fileManager.clearAllRecentFiles")}
                      </span>
                    </button>
                  </>
                )}
              </>
            )}

            {contextMenu.item.type === "pinned" && (
              <button
                className="w-full px-3 py-2 text-left text-sm flex items-center gap-3 hover:bg-dark-hover text-white first:rounded-t-lg last:rounded-b-lg"
                onClick={() => {
                  handleUnpinFile(contextMenu.item!);
                  closeContextMenu();
                }}
              >
                <div className="flex-shrink-0">
                  <Star className="w-4 h-4" />
                </div>
                <span className="flex-1">{t("fileManager.unpinFile")}</span>
              </button>
            )}

            {contextMenu.item.type === "shortcut" && (
              <button
                className="w-full px-3 py-2 text-left text-sm flex items-center gap-3 hover:bg-dark-hover text-white first:rounded-t-lg last:rounded-b-lg"
                onClick={() => {
                  handleRemoveShortcut(contextMenu.item!);
                  closeContextMenu();
                }}
              >
                <div className="flex-shrink-0">
                  <Bookmark className="w-4 h-4" />
                </div>
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
