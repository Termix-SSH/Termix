import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils.ts";
import {
  Clipboard,
  Edit3,
  Eye,
  EyeOff,
  ExternalLink,
  FilePlus,
  FolderOpen,
  FolderPlus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Kbd, KbdKey, KbdSeparator } from "@/components/kbd.tsx";
import type { LocalFileEntry } from "@/types/electron";

const VIEWPORT_PADDING = 16;

export interface LocalFileContextMenuProps {
  x: number;
  y: number;
  /** Entries the menu acts on; empty means the pane background was clicked. */
  entries: LocalFileEntry[];
  isVisible: boolean;
  showHidden: boolean;
  canUpload: boolean;
  onClose: () => void;
  onOpen: (entry: LocalFileEntry) => void;
  onUploadToRemote: (entries: LocalFileEntry[]) => void;
  onReveal: (entry?: LocalFileEntry) => void;
  onRename: (entry: LocalFileEntry) => void;
  onCopyPath: (entries: LocalFileEntry[]) => void;
  onNewFolder: () => void;
  onNewFile: () => void;
  onRefresh: () => void;
  onToggleHidden: () => void;
  onDelete: (entries: LocalFileEntry[]) => void;
}

interface MenuItem {
  icon?: React.ReactNode;
  label?: string;
  action?: () => void;
  shortcut?: string;
  separator?: boolean;
  disabled?: boolean;
  danger?: boolean;
}

/**
 * Right-click menu for the local pane. Same chrome and dismissal rules as
 * FileManagerContextMenu, with the subset of actions that make sense for the
 * user's own disk.
 */
export function LocalFileContextMenu({
  x,
  y,
  entries,
  isVisible,
  showHidden,
  canUpload,
  onClose,
  onOpen,
  onUploadToRemote,
  onReveal,
  onRename,
  onCopyPath,
  onNewFolder,
  onNewFile,
  onRefresh,
  onToggleHidden,
  onDelete,
}: LocalFileContextMenuProps) {
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
        if (!menuRef.current?.contains(event.target as Node)) onClose();
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
      const handleBlur = () => onClose();
      const handleScroll = () => onClose();

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
      cleanupFn?.();
    };
  }, [isVisible, x, y, onClose]);

  useLayoutEffect(() => {
    if (!isVisible || !menuRef.current) return;
    const menuWidth = menuRef.current.offsetWidth;
    const menuHeight = menuRef.current.offsetHeight;
    let adjustedX = x;
    let adjustedY = y;
    if (x + menuWidth > window.innerWidth) {
      adjustedX = window.innerWidth - menuWidth - 10;
    }
    if (y + menuHeight > window.innerHeight) {
      adjustedY = Math.max(10, window.innerHeight - menuHeight - 10);
    }
    setMenuPosition({ x: Math.max(8, adjustedX), y: Math.max(8, adjustedY) });
  }, [isVisible, x, y, entries.length]);

  const isEntryContext = entries.length > 0;
  const isSingle = entries.length === 1;
  const single = isSingle ? entries[0] : null;

  const menuItems: MenuItem[] = [];

  if (isEntryContext) {
    if (single) {
      menuItems.push({
        icon: <ExternalLink className="size-3.5" />,
        label:
          single.type === "directory"
            ? t("fileManager.localOpenFolder")
            : t("fileManager.localOpen"),
        action: () => onOpen(single),
        shortcut: "Enter",
      });
    }

    menuItems.push({
      icon: <Upload className="size-3.5" />,
      label: isSingle
        ? t("fileManager.localUploadToRemote")
        : t("fileManager.localUploadToRemoteMany", { count: entries.length }),
      action: () => onUploadToRemote(entries),
      disabled: !canUpload,
    });

    menuItems.push({
      icon: <FolderOpen className="size-3.5" />,
      label: t("fileManager.localRevealInFileManager"),
      action: () => onReveal(entries[0]),
    });

    menuItems.push({ separator: true });

    if (single) {
      menuItems.push({
        icon: <Edit3 className="size-3.5" />,
        label: t("fileManager.rename"),
        action: () => onRename(single),
        shortcut: "F2",
      });
    }

    menuItems.push({
      icon: <Clipboard className="size-3.5" />,
      label: isSingle ? t("fileManager.copyPath") : t("fileManager.copyPaths"),
      action: () => onCopyPath(entries),
    });

    menuItems.push({ separator: true });

    menuItems.push({
      icon: <Trash2 className="size-3.5" />,
      label: isSingle
        ? t("fileManager.localMoveToTrash")
        : t("fileManager.localMoveToTrashMany", { count: entries.length }),
      action: () => onDelete(entries),
      shortcut: "Del",
      danger: true,
    });
  } else {
    menuItems.push({
      icon: <FolderPlus className="size-3.5" />,
      label: t("fileManager.newFolder"),
      action: onNewFolder,
    });
    menuItems.push({
      icon: <FilePlus className="size-3.5" />,
      label: t("fileManager.newFile"),
      action: onNewFile,
    });
    menuItems.push({ separator: true });
    menuItems.push({
      icon: <FolderOpen className="size-3.5" />,
      label: t("fileManager.localRevealInFileManager"),
      action: () => onReveal(),
    });
    menuItems.push({
      icon: showHidden ? (
        <EyeOff className="size-3.5" />
      ) : (
        <Eye className="size-3.5" />
      ),
      label: showHidden
        ? t("fileManager.localHideHidden")
        : t("fileManager.localShowHidden"),
      action: onToggleHidden,
    });
    menuItems.push({
      icon: <RefreshCw className="size-3.5" />,
      label: t("fileManager.refresh"),
      action: onRefresh,
      shortcut: "F5",
    });
  }

  const renderShortcut = (shortcut: string) => {
    const keys = shortcut.split("+");
    if (keys.length === 1) return <Kbd>{keys[0]}</Kbd>;
    return (
      <Kbd>
        {keys.map((key, index) => (
          <React.Fragment key={`${key}-${index}`}>
            <KbdKey>{key}</KbdKey>
            {index < keys.length - 1 && <KbdSeparator />}
          </React.Fragment>
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
        data-testid="local-file-context-menu"
        className="fixed bg-card border border-border rounded-none shadow-md min-w-[220px] max-w-[300px] z-[99995] overflow-x-hidden overflow-y-auto py-1"
        style={{
          left: menuPosition.x,
          top: menuPosition.y,
          maxHeight: `calc(100vh - ${VIEWPORT_PADDING * 2}px)`,
        }}
      >
        {menuItems.map((item, index) => {
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
              key={`${item.label}-${index}`}
              type="button"
              className={cn(
                "w-full px-3 min-h-8 py-1.5 text-left text-xs font-semibold flex items-center justify-between gap-3 rounded-none transition-colors cursor-pointer",
                "hover:bg-accent-brand/10 hover:text-accent-brand",
                item.disabled &&
                  "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-current",
                item.danger &&
                  "text-destructive hover:bg-destructive/10 hover:text-destructive",
              )}
              onClick={() => {
                if (item.disabled) return;
                item.action?.();
                onClose();
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
