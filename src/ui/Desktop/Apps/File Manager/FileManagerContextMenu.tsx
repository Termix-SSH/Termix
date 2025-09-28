import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Download,
  Edit3,
  Copy,
  Scissors,
  Trash2,
  Info,
  Upload,
  FolderPlus,
  FilePlus,
  RefreshCw,
  Clipboard,
  Eye,
  Share,
  ExternalLink,
  Terminal,
  Play,
  Star,
  Bookmark,
} from "lucide-react";
import { useTranslation } from "react-i18next";

interface FileItem {
  name: string;
  type: "file" | "directory" | "link";
  path: string;
  size?: number;
  modified?: string;
  permissions?: string;
  owner?: string;
  group?: string;
  executable?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  files: FileItem[];
  isVisible: boolean;
  onClose: () => void;
  onDownload?: (files: FileItem[]) => void;
  onRename?: (file: FileItem) => void;
  onCopy?: (files: FileItem[]) => void;
  onCut?: (files: FileItem[]) => void;
  onDelete?: (files: FileItem[]) => void;
  onProperties?: (file: FileItem) => void;
  onUpload?: () => void;
  onNewFolder?: () => void;
  onNewFile?: () => void;
  onRefresh?: () => void;
  onPaste?: () => void;
  onPreview?: (file: FileItem) => void;
  hasClipboard?: boolean;
  onDragToDesktop?: () => void;
  onOpenTerminal?: (path: string) => void;
  onRunExecutable?: (file: FileItem) => void;
  onPinFile?: (file: FileItem) => void;
  onUnpinFile?: (file: FileItem) => void;
  onAddShortcut?: (path: string) => void;
  isPinned?: (file: FileItem) => boolean;
  currentPath?: string;
}

interface MenuItem {
  icon: React.ReactNode;
  label: string;
  action: () => void;
  shortcut?: string;
  separator?: boolean;
  disabled?: boolean;
  danger?: boolean;
}

export function FileManagerContextMenu({
  x,
  y,
  files,
  isVisible,
  onClose,
  onDownload,
  onRename,
  onCopy,
  onCut,
  onDelete,
  onProperties,
  onUpload,
  onNewFolder,
  onNewFile,
  onRefresh,
  onPaste,
  onPreview,
  hasClipboard = false,
  onDragToDesktop,
  onOpenTerminal,
  onRunExecutable,
  onPinFile,
  onUnpinFile,
  onAddShortcut,
  isPinned,
  currentPath,
}: ContextMenuProps) {
  const { t } = useTranslation();
  const [menuPosition, setMenuPosition] = useState({ x, y });

  useEffect(() => {
    if (!isVisible) return;

    const adjustPosition = () => {
      const menuWidth = 200;
      const menuHeight = 300;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let adjustedX = x;
      let adjustedY = y;

      if (x + menuWidth > viewportWidth) {
        adjustedX = viewportWidth - menuWidth - 10;
      }

      if (y + menuHeight > viewportHeight) {
        adjustedY = viewportHeight - menuHeight - 10;
      }

      setMenuPosition({ x: adjustedX, y: adjustedY });
    };

    adjustPosition();

    let cleanupFn: (() => void) | null = null;

    const timeoutId = setTimeout(() => {
      const handleClickOutside = (event: MouseEvent) => {
        const target = event.target as Element;
        const menuElement = document.querySelector("[data-context-menu]");

        if (!menuElement?.contains(target)) {
          onClose();
        }
      };

      const handleRightClick = (event: MouseEvent) => {
        event.preventDefault();
        onClose();
      };

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      };

      const handleBlur = () => {
        onClose();
      };

      const handleScroll = () => {
        onClose();
      };

      document.addEventListener("mousedown", handleClickOutside, true);
      document.addEventListener("contextmenu", handleRightClick);
      document.addEventListener("keydown", handleKeyDown);
      window.addEventListener("blur", handleBlur);
      window.addEventListener("scroll", handleScroll, true);

      cleanupFn = () => {
        document.removeEventListener("mousedown", handleClickOutside, true);
        document.removeEventListener("contextmenu", handleRightClick);
        document.removeEventListener("keydown", handleKeyDown);
        window.removeEventListener("blur", handleBlur);
        window.removeEventListener("scroll", handleScroll, true);
      };
    }, 50);

    return () => {
      clearTimeout(timeoutId);
      if (cleanupFn) {
        cleanupFn();
      }
    };
  }, [isVisible, x, y, onClose]);

  if (!isVisible) return null;

  const isFileContext = files.length > 0;
  const isSingleFile = files.length === 1;
  const isMultipleFiles = files.length > 1;
  const hasFiles = files.some((f) => f.type === "file");
  const hasDirectories = files.some((f) => f.type === "directory");
  const hasExecutableFiles = files.some(
    (f) => f.type === "file" && f.executable,
  );

  const menuItems: MenuItem[] = [];

  if (isFileContext) {
    if (onOpenTerminal) {
      const targetPath = isSingleFile
        ? files[0].type === "directory"
          ? files[0].path
          : files[0].path.substring(0, files[0].path.lastIndexOf("/"))
        : files[0].path.substring(0, files[0].path.lastIndexOf("/"));

      menuItems.push({
        icon: <Terminal className="w-4 h-4" />,
        label:
          files[0].type === "directory"
            ? t("fileManager.openTerminalInFolder")
            : t("fileManager.openTerminalInFileLocation"),
        action: () => onOpenTerminal(targetPath),
        shortcut: "Ctrl+Shift+T",
      });
    }

    if (isSingleFile && hasExecutableFiles && onRunExecutable) {
      menuItems.push({
        icon: <Play className="w-4 h-4" />,
        label: t("fileManager.run"),
        action: () => onRunExecutable(files[0]),
        shortcut: "Enter",
      });
    }

    if (
      onOpenTerminal ||
      (isSingleFile && hasExecutableFiles && onRunExecutable)
    ) {
      menuItems.push({ separator: true } as MenuItem);
    }

    if (hasFiles && onPreview) {
      menuItems.push({
        icon: <Eye className="w-4 h-4" />,
        label: t("fileManager.preview"),
        action: () => onPreview(files[0]),
        disabled: !isSingleFile || files[0].type !== "file",
      });
    }

    if (hasFiles && onDownload) {
      menuItems.push({
        icon: <Download className="w-4 h-4" />,
        label: isMultipleFiles
          ? t("fileManager.downloadFiles", { count: files.length })
          : t("fileManager.downloadFile"),
        action: () => onDownload(files),
        shortcut: "Ctrl+D",
      });
    }

    if (isSingleFile && files[0].type === "file") {
      const isCurrentlyPinned = isPinned ? isPinned(files[0]) : false;

      if (isCurrentlyPinned && onUnpinFile) {
        menuItems.push({
          icon: <Star className="w-4 h-4 fill-yellow-400" />,
          label: t("fileManager.unpinFile"),
          action: () => onUnpinFile(files[0]),
        });
      } else if (!isCurrentlyPinned && onPinFile) {
        menuItems.push({
          icon: <Star className="w-4 h-4" />,
          label: t("fileManager.pinFile"),
          action: () => onPinFile(files[0]),
        });
      }
    }

    if (isSingleFile && files[0].type === "directory" && onAddShortcut) {
      menuItems.push({
        icon: <Bookmark className="w-4 h-4" />,
        label: t("fileManager.addToShortcuts"),
        action: () => onAddShortcut(files[0].path),
      });
    }

    if (
      (hasFiles && (onPreview || onDragToDesktop)) ||
      (isSingleFile &&
        files[0].type === "file" &&
        (onPinFile || onUnpinFile)) ||
      (isSingleFile && files[0].type === "directory" && onAddShortcut)
    ) {
      menuItems.push({ separator: true } as MenuItem);
    }

    if (isSingleFile && onRename) {
      menuItems.push({
        icon: <Edit3 className="w-4 h-4" />,
        label: t("fileManager.rename"),
        action: () => onRename(files[0]),
        shortcut: "F6",
      });
    }

    if (onCopy) {
      menuItems.push({
        icon: <Copy className="w-4 h-4" />,
        label: isMultipleFiles
          ? t("fileManager.copyFiles", { count: files.length })
          : t("fileManager.copy"),
        action: () => onCopy(files),
        shortcut: "Ctrl+C",
      });
    }

    if (onCut) {
      menuItems.push({
        icon: <Scissors className="w-4 h-4" />,
        label: isMultipleFiles
          ? t("fileManager.cutFiles", { count: files.length })
          : t("fileManager.cut"),
        action: () => onCut(files),
        shortcut: "Ctrl+X",
      });
    }

    if ((isSingleFile && onRename) || onCopy || onCut) {
      menuItems.push({ separator: true } as MenuItem);
    }

    if (onDelete) {
      menuItems.push({
        icon: <Trash2 className="w-4 h-4" />,
        label: isMultipleFiles
          ? t("fileManager.deleteFiles", { count: files.length })
          : t("fileManager.delete"),
        action: () => onDelete(files),
        shortcut: "Delete",
        danger: true,
      });
    }

    if (onDelete) {
      menuItems.push({ separator: true } as MenuItem);
    }

    if (isSingleFile && onProperties) {
      menuItems.push({
        icon: <Info className="w-4 h-4" />,
        label: t("fileManager.properties"),
        action: () => onProperties(files[0]),
      });
    }
  } else {
    if (onOpenTerminal && currentPath) {
      menuItems.push({
        icon: <Terminal className="w-4 h-4" />,
        label: t("fileManager.openTerminalHere"),
        action: () => onOpenTerminal(currentPath),
        shortcut: "Ctrl+Shift+T",
      });
    }

    if (onUpload) {
      menuItems.push({
        icon: <Upload className="w-4 h-4" />,
        label: t("fileManager.uploadFile"),
        action: onUpload,
        shortcut: "Ctrl+U",
      });
    }

    if ((onOpenTerminal && currentPath) || onUpload) {
      menuItems.push({ separator: true } as MenuItem);
    }

    if (onNewFolder) {
      menuItems.push({
        icon: <FolderPlus className="w-4 h-4" />,
        label: t("fileManager.newFolder"),
        action: onNewFolder,
        shortcut: "Ctrl+Shift+N",
      });
    }

    if (onNewFile) {
      menuItems.push({
        icon: <FilePlus className="w-4 h-4" />,
        label: t("fileManager.newFile"),
        action: onNewFile,
        shortcut: "Ctrl+N",
      });
    }

    if (onNewFolder || onNewFile) {
      menuItems.push({ separator: true } as MenuItem);
    }

    if (onRefresh) {
      menuItems.push({
        icon: <RefreshCw className="w-4 h-4" />,
        label: t("fileManager.refresh"),
        action: onRefresh,
        shortcut: "Ctrl+Y",
      });
    }

    if (hasClipboard && onPaste) {
      menuItems.push({
        icon: <Clipboard className="w-4 h-4" />,
        label: t("fileManager.paste"),
        action: onPaste,
        shortcut: "Ctrl+V",
      });
    }
  }

  const filteredMenuItems = menuItems.filter((item, index) => {
    if (!item.separator) return true;

    const prevItem = index > 0 ? menuItems[index - 1] : null;
    const nextItem = index < menuItems.length - 1 ? menuItems[index + 1] : null;

    if (prevItem?.separator || nextItem?.separator) {
      return false;
    }

    return true;
  });

  const finalMenuItems = filteredMenuItems.filter((item, index) => {
    if (!item.separator) return true;
    return index > 0 && index < filteredMenuItems.length - 1;
  });

  return (
    <>
      <div className="fixed inset-0 z-[99990]" />

      <div
        data-context-menu
        className="fixed bg-dark-bg border border-dark-border rounded-lg shadow-xl min-w-[180px] max-w-[250px] z-[99995] overflow-hidden"
        style={{
          left: menuPosition.x,
          top: menuPosition.y,
        }}
      >
        {finalMenuItems.map((item, index) => {
          if (item.separator) {
            return (
              <div
                key={`separator-${index}`}
                className="border-t border-dark-border"
              />
            );
          }

          return (
            <button
              key={index}
              className={cn(
                "w-full px-3 py-2 text-left text-sm flex items-center justify-between",
                "hover:bg-dark-hover transition-colors",
                "first:rounded-t-lg last:rounded-b-lg",
                item.disabled && "opacity-50 cursor-not-allowed",
                item.danger && "text-red-400 hover:bg-red-500/10",
              )}
              onClick={() => {
                if (!item.disabled) {
                  item.action();
                  onClose();
                }
              }}
              disabled={item.disabled}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="flex-shrink-0">{item.icon}</div>
                <span className="flex-1">{item.label}</span>
              </div>
              {item.shortcut && (
                <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">
                  {item.shortcut}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}
