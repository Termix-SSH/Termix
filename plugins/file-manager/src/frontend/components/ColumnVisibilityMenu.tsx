import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils.ts";
import type { ResizableColumns } from "../hooks/useResizableColumns.ts";

interface ColumnVisibilityMenuProps {
  x: number;
  y: number;
  isVisible: boolean;
  columns: ResizableColumns;
  onClose: () => void;
}

/**
 * Right-click menu for a list-view header: tick/untick which optional
 * columns are shown. The name column is always on and not listed.
 */
export function ColumnVisibilityMenu({
  x,
  y,
  isVisible,
  columns,
  onClose,
}: ColumnVisibilityMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  useEffect(() => {
    if (!isVisible) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const timeout = setTimeout(() => {
      document.addEventListener("mousedown", handleMouseDown, true);
      document.addEventListener("keydown", handleKeyDown);
      window.addEventListener("blur", onClose);
    }, 50);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener("mousedown", handleMouseDown, true);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", onClose);
    };
  }, [isVisible, onClose]);

  useLayoutEffect(() => {
    if (!isVisible || !menuRef.current) return;
    const { offsetWidth, offsetHeight } = menuRef.current;
    setPosition({
      x: Math.max(8, Math.min(x, window.innerWidth - offsetWidth - 10)),
      y: Math.max(8, Math.min(y, window.innerHeight - offsetHeight - 10)),
    });
  }, [isVisible, x, y]);

  if (!isVisible) return null;

  const onlyOneVisible = columns.visibleColumns.length <= 1;

  return (
    <div
      ref={menuRef}
      data-context-menu
      data-testid="column-visibility-menu"
      className="fixed bg-card border border-border rounded-none shadow-md min-w-[200px] z-[99995] py-1"
      style={{ left: position.x, top: position.y }}
    >
      <div className="px-3 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {t("fileManager.columns")}
      </div>
      {columns.columns.map((column) => {
        const visible = columns.isVisible(column.key);
        // Keep at least one optional column so the header stays meaningful.
        const disabled = visible && onlyOneVisible;
        return (
          <button
            key={column.key}
            type="button"
            role="menuitemcheckbox"
            aria-checked={visible}
            disabled={disabled}
            className={cn(
              "w-full px-3 min-h-8 py-1.5 text-left text-xs font-semibold flex items-center gap-2 rounded-none transition-colors cursor-pointer",
              "hover:bg-accent-brand/10 hover:text-accent-brand",
              disabled &&
                "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-current",
            )}
            onClick={() => {
              if (!disabled) columns.toggleColumn(column.key);
            }}
          >
            <span className="size-3.5 flex items-center justify-center text-accent-brand">
              {visible && <Check className="size-3.5" />}
            </span>
            <span className="flex-1 leading-tight">{t(column.labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
