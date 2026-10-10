/* eslint-disable react-refresh/only-export-components */
import type React from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  ChevronRight,
  PanelRight,
  RotateCcw,
  SquareArrowOutUpRight,
} from "lucide-react";
import { PANEL } from "@/components/panel-layout";
import type { EditingWidth } from "@/components/surface/surface-scope";
import { cn } from "@/lib/utils";
import { rem } from "@/lib/rem";

export const DOCK_DEFAULT_WIDTH = 291;
export const DOCK_MIN_WIDTH = 160;
export const DOCK_MAX_WIDTH = 480;
const EDITING_WIDTH = 560;
const WIDE_EDITING_WIDTH = 760;

/** The width a dock renders at, in Normal-size pixels. */
export function dockWidth(width: number, editing: EditingWidth): number {
  if (editing === "wide") return WIDE_EDITING_WIDTH;
  if (editing) return Math.max(width, EDITING_WIDTH);
  return width;
}

function HeaderButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex h-full w-12.5 shrink-0 items-center justify-center border-l border-border text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

/** The shared header and frame of the left sidebar and the right dock. */
export function DockPanel({
  side,
  title,
  open,
  width,
  editing = false,
  dragging = false,
  fill = false,
  onResizeStart,
  onClose,
  onOpenAsTab,
  onMoveToRightDock,
  onResetWidth,
  children,
}: {
  side: "left" | "right";
  title: string;
  open: boolean;
  width: number;
  editing?: EditingWidth;
  dragging?: boolean;
  /** Fill the parent instead of sizing itself, as in the mobile sheet. */
  fill?: boolean;
  onResizeStart?: (e: React.MouseEvent) => void;
  onClose: () => void;
  onOpenAsTab?: () => void;
  onMoveToRightDock?: () => void;
  onResetWidth?: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const CollapseIcon = side === "left" ? ChevronLeft : ChevronRight;

  return (
    <div
      className={cn(
        "relative flex min-h-0 flex-col overflow-hidden bg-sidebar",
        fill ? "flex-1" : "shrink-0",
        open &&
          !fill && [
            side === "left" ? "border-r" : "border-l",
            "transition-colors",
            dragging ? "border-accent-brand/60" : "border-border",
          ],
      )}
      style={
        fill
          ? undefined
          : {
              width: open ? rem(dockWidth(width, editing)) : 0,
              transition: dragging ? "none" : "width 0.2s",
            }
      }
    >
      <div
        className={`flex ${PANEL.header} shrink-0 flex-row items-center border-b border-border`}
      >
        <span className="min-w-0 flex-1 truncate whitespace-nowrap px-3 text-base font-bold tracking-tight text-foreground">
          {title}
        </span>
        {onOpenAsTab && (
          <HeaderButton title={t("nav.openAsTab")} onClick={onOpenAsTab}>
            <SquareArrowOutUpRight className="size-3.5" />
          </HeaderButton>
        )}
        {onMoveToRightDock && (
          <HeaderButton
            title={t("nav.openInRightDock")}
            onClick={onMoveToRightDock}
          >
            <PanelRight className="size-3.5" />
          </HeaderButton>
        )}
        {onResetWidth && (
          <HeaderButton
            title={t("nav.resetSidebarWidth")}
            onClick={onResetWidth}
          >
            <RotateCcw className="size-3.5" />
          </HeaderButton>
        )}
        <HeaderButton
          title={
            side === "left" ? t("nav.collapseSidebar") : t("nav.closeRightDock")
          }
          onClick={onClose}
        >
          <CollapseIcon className="size-4" />
        </HeaderButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>

      {open && onResizeStart && !editing && (
        <div
          onMouseDown={onResizeStart}
          className={cn(
            "absolute bottom-0 top-0 z-30 w-1 cursor-col-resize transition-colors",
            side === "left" ? "right-0" : "left-0",
            dragging ? "bg-accent-brand/60" : "hover:bg-accent-brand/40",
          )}
        />
      )}
    </div>
  );
}

/** The thin strip that reopens a collapsed left dock. */
export function DockReopenStrip({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      title={t("nav.openSidebar")}
      aria-label={t("nav.openSidebar")}
      className="absolute bottom-0 left-0 top-0 z-20 flex w-6 items-center justify-center border-r border-border bg-sidebar text-muted-foreground transition-colors hover:bg-accent-brand/5 hover:text-accent-brand"
    >
      <ChevronRight className="size-3.5" />
    </button>
  );
}
