import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils.ts";
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
  Terminal,
  Play,
  Star,
  Bookmark,
  FileArchive,
  ArrowRightLeft,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Kbd, KbdKey, KbdSeparator } from "@/components/kbd.tsx";

const VIEWPORT_PADDING = 16;

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
  onExtractArchive?: (file: FileItem) => void;
  onCompress?: (files: FileItem[]) => void;
  onCopyPath?: (files: FileItem[]) => void;
  onTransferToHost?: (files: FileItem[], move: boolean) => void;
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
  onExtractArchive,
  onCompress,
  onCopyPath,
  onTransferToHost,
}: ContextMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState({ x, y });
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    if (!isVisible) {
      setIsMounted(false);
      return;
    }

    setIsMounted(true);

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

  useLayoutEffect(() => {
    if (!isVisible || !menuRef.current) return;
    const menuWidth = menuRef.current.offsetWidth;
    const menuHeight = menuRef.current.offsetHeight;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    let adjustedX = x;
    let adjustedY = y;
    if (x + menuWidth > viewportWidth)
      adjustedX = viewportWidth - menuWidth - 10;
    if (y + menuHeight > viewportHeight)
      adjustedY = Math.max(10, viewportHeight - menuHeight - 10);
    adjustedX = Math.max(8, adjustedX);
    adjustedY = Math.max(8, adjustedY);
    setMenuPosition({ x: adjustedX, y: adjustedY });
  }, [isVisible, x, y, files.length]);

  const isFileContext = files.length > 0;
  const isSingleFile = files.length === 1;
  const isMultipleFiles = files.length > 1;
  const hasFiles = files.some((f) => f.type === "file");
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
        icon: <Terminal className="size-3.5" />,
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
        icon: <Play className="size-3.5" />,
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
        icon: <Eye className="size-3.5" />,
        label: t("fileManager.preview"),
        action: () => onPreview(files[0]),
        disabled: !isSingleFile || files[0].type !== "file",
      });
    }

    if (hasFiles && onDownload) {
      menuItems.push({
        icon: <Download className="size-3.5" />,
        label: isMultipleFiles
          ? t("fileManager.downloadFiles", { count: files.length })
          : t("fileManager.downloadFile"),
        action: () => onDownload(files),
        shortcut: "Ctrl+D",
      });
    }

    if (isFileContext && onTransferToHost) {
      const isOnlyDirectories =
        files.length > 0 && files.every((f) => f.type === "directory");
      menuItems.push({
        icon: <ArrowRightLeft className="size-3.5" />,
        label: isMultipleFiles
          ? t("transfer.copyItemsToHost", { count: files.length })
          : isOnlyDirectories && isSingleFile
            ? t("transfer.copyFolderToHost")
            : t("transfer.copyToHost"),
        action: () => onTransferToHost(files, false),
      });
      menuItems.push({
        icon: <ArrowRightLeft className="size-3.5" />,
        label: isMultipleFiles
          ? t("transfer.moveItemsToHost", { count: files.length })
          : isOnlyDirectories && isSingleFile
            ? t("transfer.moveFolderToHost")
            : t("transfer.moveToHost"),
        action: () => onTransferToHost(files, true),
      });
    }

    if (isSingleFile && files[0].type === "file" && onExtractArchive) {
      const fileName = files[0].name.toLowerCase();
      const isArchive =
        fileName.endsWith(".zip") ||
        fileName.endsWith(".tar") ||
        fileName.endsWith(".tar.gz") ||
        fileName.endsWith(".tgz") ||
        fileName.endsWith(".tar.bz2") ||
        fileName.endsWith(".tbz2") ||
        fileName.endsWith(".tar.xz") ||
        fileName.endsWith(".gz") ||
        fileName.endsWith(".bz2") ||
        fileName.endsWith(".xz") ||
        fileName.endsWith(".7z") ||
        fileName.endsWith(".rar");

      if (isArchive) {
        menuItems.push({
          icon: <FileArchive className="size-3.5" />,
          label: t("fileManager.extractArchive"),
          action: () => onExtractArchive(files[0]),
          shortcut: "Ctrl+E",
        });
      }
    }

    if (isFileContext && onCompress) {
      menuItems.push({
        icon: <FileArchive className="size-3.5" />,
        label: isMultipleFiles
          ? t("fileManager.compressFiles")
          : t("fileManager.compressFile"),
        action: () => onCompress(files),
        shortcut: "Ctrl+Shift+C",
      });
    }

    if (isSingleFile && files[0].type === "file") {
      const isCurrentlyPinned = isPinned ? isPinned(files[0]) : false;

      if (isCurrentlyPinned && onUnpinFile) {
        menuItems.push({
          icon: (
            <Star className="size-3.5 fill-accent-brand text-accent-brand" />
          ),
          label: t("fileManager.unpinFile"),
          action: () => onUnpinFile(files[0]),
        });
      } else if (!isCurrentlyPinned && onPinFile) {
        menuItems.push({
          icon: <Star className="size-3.5" />,
          label: t("fileManager.pinFile"),
          action: () => onPinFile(files[0]),
        });
      }
    }

    if (isSingleFile && files[0].type === "directory" && onAddShortcut) {
      menuItems.push({
        icon: <Bookmark className="size-3.5" />,
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
        icon: <Edit3 className="size-3.5" />,
        label: t("fileManager.rename"),
        action: () => onRename(files[0]),
        shortcut: "F6",
      });
    }

    if (onCopy) {
      menuItems.push({
        icon: <Copy className="size-3.5" />,
        label: isMultipleFiles
          ? t("fileManager.copyFiles", { count: files.length })
          : t("fileManager.copy"),
        action: () => onCopy(files),
        shortcut: "Ctrl+C",
      });
    }

    if (onCut) {
      menuItems.push({
        icon: <Scissors className="size-3.5" />,
        label: isMultipleFiles
          ? t("fileManager.cutFiles", { count: files.length })
          : t("fileManager.cut"),
        action: () => onCut(files),
        shortcut: "Ctrl+X",
      });
    }

    if (onCopyPath) {
      menuItems.push({
        icon: <Clipboard className="size-3.5" />,
        label: isMultipleFiles
          ? t("fileManager.copyPaths")
          : t("fileManager.copyPath"),
        action: () => onCopyPath(files),
        shortcut: "Ctrl+Shift+P",
      });
    }

    if ((isSingleFile && onRename) || onCopy || onCut || onCopyPath) {
      menuItems.push({ separator: true } as MenuItem);
    }

    if (isSingleFile && onProperties) {
      menuItems.push({
        icon: <Info className="size-3.5" />,
        label: t("fileManager.properties"),
        action: () => onProperties(files[0]),
      });
    }

    if ((isSingleFile && onProperties) || onDelete) {
      menuItems.push({ separator: true } as MenuItem);
    }

    if (onDelete) {
      menuItems.push({
        icon: <Trash2 className="size-3.5" />,
        label: isMultipleFiles
          ? t("fileManager.deleteFiles", { count: files.length })
          : t("fileManager.delete"),
        action: () => onDelete(files),
        shortcut: "Delete",
        danger: true,
      });
    }
  } else {
    if (onOpenTerminal && currentPath) {
      menuItems.push({
        icon: <Terminal className="size-3.5" />,
        label: t("fileManager.openTerminalHere"),
        action: () => onOpenTerminal(currentPath),
        shortcut: "Ctrl+Shift+T",
      });
    }

    if (onUpload) {
      menuItems.push({
        icon: <Upload className="size-3.5" />,
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
        icon: <FolderPlus className="size-3.5" />,
        label: t("fileManager.newFolder"),
        action: onNewFolder,
        shortcut: "Ctrl+Shift+N",
      });
    }

    if (onNewFile) {
      menuItems.push({
        icon: <FilePlus className="size-3.5" />,
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
        icon: <RefreshCw className="size-3.5" />,
        label: t("fileManager.refresh"),
        action: onRefresh,
        shortcut: "Ctrl+Y",
      });
    }

    if (hasClipboard && onPaste) {
      menuItems.push({
        icon: <Clipboard className="size-3.5" />,
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

  const renderShortcut = (shortcut: string) => {
    const keys = shortcut.split("+");
    if (keys.length === 1) {
      return <Kbd>{keys[0]}</Kbd>;
    }
    return (
      <Kbd>
        {keys.map((key, index) => (
          <>
            <KbdKey key={`key-${index}`}>{key}</KbdKey>
            {index < keys.length - 1 && <KbdSeparator key={`sep-${index}`} />}
          </>
        ))}
      </Kbd>
    );
  };

  if (!isVisible && !isMounted) return null;

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-[99990] transition-opacity duration-150",
          !isMounted && "opacity-0",
        )}
      />

      <div
        ref={menuRef}
        data-context-menu
        className={cn(
          "fixed bg-card border border-border rounded-none shadow-md min-w-[220px] max-w-[300px] z-[99995] overflow-x-hidden overflow-y-auto py-1",
        )}
        style={{
          left: menuPosition.x,
          top: menuPosition.y,
          maxHeight: `calc(100vh - ${VIEWPORT_PADDING * 2}px)`,
        }}
      >
        {finalMenuItems.map((item, index) => {
          if (item.separator) {
            return (
              <div
                key={`separator-${index}`}
                className="my-1 border-t border-border"
              />
            );
          }

          return (
            <button
              key={index}
              className={cn(
                "w-full px-3 min-h-8 py-1.5 text-left text-xs font-semibold flex items-center justify-between gap-3 rounded-none transition-colors cursor-pointer",
                "hover:bg-accent-brand/10 hover:text-accent-brand",
                item.disabled &&
                  "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-current",
                item.danger &&
                  "text-destructive hover:bg-destructive/10 hover:text-destructive",
              )}
              onClick={() => {
                if (!item.disabled) {
                  item.action();
                  onClose();
                }
              }}
              disabled={item.disabled}
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="flex-shrink-0 text-muted-foreground">
                  {item.icon}
                </div>
                <span className="flex-1 leading-tight">{item.label}</span>
              </div>
              {item.shortcut && (
                <div className="ml-auto flex-shrink-0 opacity-50">
                  {renderShortcut(item.shortcut)}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}
