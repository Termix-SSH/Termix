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
  Play
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
  currentPath
}: ContextMenuProps) {
  const { t } = useTranslation();
  const [menuPosition, setMenuPosition] = useState({ x, y });

  useEffect(() => {
    if (!isVisible) return;

    // 调整菜单位置避免超出屏幕
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

    // 延迟添加事件监听器，避免捕获到触发菜单的那次点击
    let cleanupFn: (() => void) | null = null;

    const timeoutId = setTimeout(() => {
      // 点击外部关闭菜单
      const handleClickOutside = (event: MouseEvent) => {
        // 检查点击是否在菜单内部
        const target = event.target as Element;
        const menuElement = document.querySelector('[data-context-menu]');

        if (!menuElement?.contains(target)) {
          onClose();
        }
      };

      // 右键点击关闭菜单（Windows行为）
      const handleRightClick = (event: MouseEvent) => {
        event.preventDefault();
        onClose();
      };

      // 键盘支持
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      };

      // 窗口失焦关闭菜单
      const handleBlur = () => {
        onClose();
      };

      // 滚动时关闭菜单（Windows行为）
      const handleScroll = () => {
        onClose();
      };

      document.addEventListener('mousedown', handleClickOutside, true);
      document.addEventListener('contextmenu', handleRightClick);
      document.addEventListener('keydown', handleKeyDown);
      window.addEventListener('blur', handleBlur);
      window.addEventListener('scroll', handleScroll, true);

      // 设置清理函数
      cleanupFn = () => {
        document.removeEventListener('mousedown', handleClickOutside, true);
        document.removeEventListener('contextmenu', handleRightClick);
        document.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('blur', handleBlur);
        window.removeEventListener('scroll', handleScroll, true);
      };
    }, 50); // 50ms延迟，确保不会捕获到触发菜单的点击

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
  const hasFiles = files.some(f => f.type === 'file');
  const hasDirectories = files.some(f => f.type === 'directory');
  const hasExecutableFiles = files.some(f => f.type === 'file' && f.executable);

  // 构建菜单项
  const menuItems: MenuItem[] = [];

  if (isFileContext) {
    // 文件/文件夹选中时的菜单

    // 打开终端功能 - 支持文件和文件夹
    if (onOpenTerminal) {
      const targetPath = isSingleFile
        ? (files[0].type === 'directory' ? files[0].path : files[0].path.substring(0, files[0].path.lastIndexOf('/')))
        : files[0].path.substring(0, files[0].path.lastIndexOf('/'));

      menuItems.push({
        icon: <Terminal className="w-4 h-4" />,
        label: files[0].type === 'directory' ? t("fileManager.openTerminalInFolder") : t("fileManager.openTerminalInFileLocation"),
        action: () => onOpenTerminal(targetPath),
        shortcut: "Ctrl+T"
      });
    }

    // 运行可执行文件功能 - 仅对单个可执行文件显示
    if (isSingleFile && hasExecutableFiles && onRunExecutable) {
      menuItems.push({
        icon: <Play className="w-4 h-4" />,
        label: t("fileManager.run"),
        action: () => onRunExecutable(files[0]),
        shortcut: "Enter"
      });
    }

    if ((onOpenTerminal || (isSingleFile && hasExecutableFiles && onRunExecutable))) {
      menuItems.push({ separator: true } as MenuItem);
    }

    if (hasFiles && onPreview) {
      menuItems.push({
        icon: <Eye className="w-4 h-4" />,
        label: t("fileManager.preview"),
        action: () => onPreview(files[0]),
        disabled: !isSingleFile || files[0].type !== 'file'
      });
    }

    if (hasFiles && onDownload) {
      menuItems.push({
        icon: <Download className="w-4 h-4" />,
        label: isMultipleFiles
          ? t("fileManager.downloadFiles", { count: files.length })
          : t("fileManager.downloadFile"),
        action: () => onDownload(files),
        shortcut: "Ctrl+D"
      });
    }

    // 拖拽到桌面菜单项（支持浏览器和桌面应用）
    if (hasFiles && onDragToDesktop) {
      const isModernBrowser = 'showSaveFilePicker' in window;
      menuItems.push({
        icon: <ExternalLink className="w-4 h-4" />,
        label: isMultipleFiles
          ? `保存 ${files.length} 个文件到系统`
          : "保存到系统",
        action: () => onDragToDesktop(),
        shortcut: isModernBrowser ? "选择位置保存" : "下载到默认位置"
      });
    }

    menuItems.push({ separator: true } as MenuItem);

    if (isSingleFile && onRename) {
      menuItems.push({
        icon: <Edit3 className="w-4 h-4" />,
        label: t("fileManager.rename"),
        action: () => onRename(files[0]),
        shortcut: "F2"
      });
    }

    if (onCopy) {
      menuItems.push({
        icon: <Copy className="w-4 h-4" />,
        label: isMultipleFiles
          ? t("fileManager.copyFiles", { count: files.length })
          : t("fileManager.copy"),
        action: () => onCopy(files),
        shortcut: "Ctrl+C"
      });
    }

    if (onCut) {
      menuItems.push({
        icon: <Scissors className="w-4 h-4" />,
        label: isMultipleFiles
          ? t("fileManager.cutFiles", { count: files.length })
          : t("fileManager.cut"),
        action: () => onCut(files),
        shortcut: "Ctrl+X"
      });
    }

    menuItems.push({ separator: true } as MenuItem);

    if (onDelete) {
      menuItems.push({
        icon: <Trash2 className="w-4 h-4" />,
        label: isMultipleFiles
          ? t("fileManager.deleteFiles", { count: files.length })
          : t("fileManager.delete"),
        action: () => onDelete(files),
        shortcut: "Delete",
        danger: true
      });
    }

    menuItems.push({ separator: true } as MenuItem);

    if (isSingleFile && onProperties) {
      menuItems.push({
        icon: <Info className="w-4 h-4" />,
        label: t("fileManager.properties"),
        action: () => onProperties(files[0])
      });
    }
  } else {
    // 空白区域右键菜单

    // 在当前目录打开终端
    if (onOpenTerminal && currentPath) {
      menuItems.push({
        icon: <Terminal className="w-4 h-4" />,
        label: t("fileManager.openTerminalHere"),
        action: () => onOpenTerminal(currentPath),
        shortcut: "Ctrl+T"
      });

      menuItems.push({ separator: true } as MenuItem);
    }

    if (onUpload) {
      menuItems.push({
        icon: <Upload className="w-4 h-4" />,
        label: t("fileManager.uploadFile"),
        action: onUpload,
        shortcut: "Ctrl+U"
      });
    }

    menuItems.push({ separator: true } as MenuItem);

    if (onNewFolder) {
      menuItems.push({
        icon: <FolderPlus className="w-4 h-4" />,
        label: t("fileManager.newFolder"),
        action: onNewFolder,
        shortcut: "Ctrl+Shift+N"
      });
    }

    if (onNewFile) {
      menuItems.push({
        icon: <FilePlus className="w-4 h-4" />,
        label: t("fileManager.newFile"),
        action: onNewFile,
        shortcut: "Ctrl+N"
      });
    }

    menuItems.push({ separator: true } as MenuItem);

    if (onRefresh) {
      menuItems.push({
        icon: <RefreshCw className="w-4 h-4" />,
        label: t("fileManager.refresh"),
        action: onRefresh,
        shortcut: "F5"
      });
    }

    if (hasClipboard && onPaste) {
      menuItems.push({
        icon: <Clipboard className="w-4 h-4" />,
        label: t("fileManager.paste"),
        action: onPaste,
        shortcut: "Ctrl+V"
      });
    }
  }

  return (
    <>
      {/* 透明遮罩层用于捕获点击事件 */}
      <div className="fixed inset-0 z-40" />

      {/* 菜单本体 */}
      <div
        data-context-menu
        className="fixed bg-dark-bg border border-dark-border rounded-lg shadow-xl py-1 min-w-[180px] max-w-[250px] z-50"
        style={{
          left: menuPosition.x,
          top: menuPosition.y
        }}
      >
        {menuItems.map((item, index) => {
          if (item.separator) {
            return (
              <div
                key={`separator-${index}`}
                className="border-t border-dark-border my-1"
              />
            );
          }

          return (
            <button
              key={index}
              className={cn(
                "w-full px-3 py-2 text-left text-sm flex items-center justify-between",
                "hover:bg-dark-hover transition-colors",
                item.disabled && "opacity-50 cursor-not-allowed",
                item.danger && "text-red-400 hover:bg-red-500/10"
              )}
              onClick={() => {
                if (!item.disabled) {
                  item.action();
                  onClose();
                }
              }}
              disabled={item.disabled}
            >
              <div className="flex items-center gap-3">
                {item.icon}
                <span>{item.label}</span>
              </div>
              {item.shortcut && (
                <span className="text-xs text-muted-foreground">
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