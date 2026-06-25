import { useTranslation } from "react-i18next";
import {
  Lock,
  LockOpen,
  Minus,
  Plus,
  RotateCcw,
  PlusCircle,
} from "lucide-react";
import { MIN_ZOOM, MAX_ZOOM, ZOOM_STEP } from "@/types/homepage-types";
import { zoomAroundPoint } from "../canvas/canvasGeometry";

interface HomepageToolbarProps {
  zoom: number;
  isLocked: boolean;
  pan: { x: number; y: number };
  containerSize: { w: number; h: number };
  onZoomChange: (zoom: number, pan: { x: number; y: number }) => void;
  onLockToggle: () => void;
  onResetView: () => void;
  onAddWidget: (anchorRect: {
    top: number;
    bottom: number;
    left: number;
    right: number;
    width: number;
    height: number;
  }) => void;
}

function ToolButton({
  onClick,
  title,
  disabled,
  children,
}: {
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  );
}

export function HomepageToolbar({
  zoom,
  isLocked,
  pan,
  containerSize,
  onZoomChange,
  onLockToggle,
  onResetView,
  onAddWidget,
}: HomepageToolbarProps) {
  const { t } = useTranslation();
  const cx = containerSize.w / 2;
  const cy = containerSize.h / 2;

  const zoomIn = () => {
    const next = Math.min(MAX_ZOOM, parseFloat((zoom + ZOOM_STEP).toFixed(1)));
    onZoomChange(next, zoomAroundPoint(cx, cy, pan, zoom, next));
  };
  const zoomOut = () => {
    const next = Math.max(MIN_ZOOM, parseFloat((zoom - ZOOM_STEP).toFixed(1)));
    onZoomChange(next, zoomAroundPoint(cx, cy, pan, zoom, next));
  };

  return (
    <div className="absolute bottom-4 right-4 z-30 flex items-center gap-0 bg-card border border-border shadow-lg">
      <ToolButton
        onClick={(e) => onAddWidget(e.currentTarget.getBoundingClientRect())}
        title={t("homepage.addWidget")}
        disabled={isLocked}
      >
        <PlusCircle size={15} className={isLocked ? "" : "text-accent-brand"} />
      </ToolButton>

      <div className="w-px h-5 bg-border" />

      <ToolButton
        onClick={zoomOut}
        title={t("homepage.zoomOut")}
        disabled={zoom <= MIN_ZOOM}
      >
        <Minus size={13} />
      </ToolButton>

      <span className="text-[11px] font-mono text-foreground tabular-nums w-10 text-center select-none">
        {Math.round(zoom * 100)}%
      </span>

      <ToolButton
        onClick={zoomIn}
        title={t("homepage.zoomIn")}
        disabled={zoom >= MAX_ZOOM}
      >
        <Plus size={13} />
      </ToolButton>

      <div className="w-px h-5 bg-border" />

      <ToolButton onClick={onResetView} title={t("homepage.resetView")}>
        <RotateCcw size={13} />
      </ToolButton>

      <ToolButton
        onClick={onLockToggle}
        title={isLocked ? t("homepage.unlockLayout") : t("homepage.lockLayout")}
      >
        {isLocked ? (
          <Lock size={13} className="text-accent-brand" />
        ) : (
          <LockOpen size={13} />
        )}
      </ToolButton>
    </div>
  );
}
