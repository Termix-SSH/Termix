import React, { useState, useRef, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils.ts";
import { Minus, X, Maximize2, Minimize2 } from "lucide-react";
import { useTranslation } from "react-i18next";

interface DraggableWindowProps {
  title: string;
  children: React.ReactNode;
  initialX?: number;
  initialY?: number;
  initialWidth?: number;
  initialHeight?: number;
  minWidth?: number;
  minHeight?: number;
  onClose: () => void;
  onMinimize?: () => void;
  onMaximize?: () => void;
  onResize?: () => void;
  isMaximized?: boolean;
  zIndex?: number;
  onFocus?: () => void;
  targetSize?: { width: number; height: number };
}

export function DraggableWindow({
  title,
  children,
  initialX = 100,
  initialY = 100,
  initialWidth = 600,
  initialHeight = 400,
  minWidth = 300,
  minHeight = 200,
  onClose,
  onMinimize,
  onMaximize,
  onResize,
  isMaximized = false,
  zIndex = 1000,
  onFocus,
  targetSize,
}: DraggableWindowProps) {
  const { t } = useTranslation();
  const [position, setPosition] = useState({ x: initialX, y: initialY });
  const [size, setSize] = useState({
    width: initialWidth,
    height: initialHeight,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<string>("");

  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [windowStart, setWindowStart] = useState({ x: 0, y: 0 });
  const [sizeStart, setSizeStart] = useState({ width: 0, height: 0 });
  const containerBoundsRef = useRef({ width: 0, height: 0 });

  const windowRef = useRef<HTMLDivElement>(null);
  const titleBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (targetSize && !isMaximized) {
      const container = windowRef.current?.offsetParent as HTMLElement | null;
      const maxWidth = container
        ? Math.min(container.clientWidth * 0.9, 1200)
        : Math.min(window.innerWidth * 0.9, 1200);
      const maxHeight = container
        ? Math.min(container.clientHeight * 0.8, 800)
        : Math.min(window.innerHeight * 0.8, 800);

      let newWidth = Math.min(targetSize.width + 50, maxWidth);
      let newHeight = Math.min(targetSize.height + 150, maxHeight);

      if (newWidth > maxWidth || newHeight > maxHeight) {
        const widthRatio = maxWidth / newWidth;
        const heightRatio = maxHeight / newHeight;
        const scale = Math.min(widthRatio, heightRatio);

        newWidth = Math.floor(newWidth * scale);
        newHeight = Math.floor(newHeight * scale);
      }

      newWidth = Math.max(newWidth, minWidth);
      newHeight = Math.max(newHeight, minHeight);

      setSize({ width: newWidth, height: newHeight });

      setPosition({
        x: Math.max(
          0,
          (container ? container.clientWidth : window.innerWidth) / 2 -
            newWidth / 2,
        ),
        y: Math.max(
          0,
          (container ? container.clientHeight : window.innerHeight) / 2 -
            newHeight / 2,
        ),
      });
    }
  }, [targetSize, isMaximized, minWidth, minHeight]);

  const handleWindowClick = useCallback(() => {
    onFocus?.();
  }, [onFocus]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isMaximized) return;

      e.preventDefault();
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      setWindowStart({ x: position.x, y: position.y });

      const container = windowRef.current?.offsetParent as HTMLElement | null;
      containerBoundsRef.current = {
        width: container ? container.clientWidth : window.innerWidth,
        height: container ? container.clientHeight : window.innerHeight,
      };

      onFocus?.();
    },
    [isMaximized, position, onFocus],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (isDragging && !isMaximized) {
        const deltaX = e.clientX - dragStart.x;
        const deltaY = e.clientY - dragStart.y;

        const newX = windowStart.x + deltaX;
        const newY = windowStart.y + deltaY;

        const { width: containerW, height: containerH } =
          containerBoundsRef.current;
        const maxX = containerW - size.width;
        const maxY = containerH - size.height;

        setPosition({
          x: Math.max(0, Math.min(maxX, newX)),
          y: Math.max(49, Math.min(maxY, newY)),
        });
      }

      if (isResizing && !isMaximized) {
        const deltaX = e.clientX - dragStart.x;
        const deltaY = e.clientY - dragStart.y;

        let newWidth = sizeStart.width;
        let newHeight = sizeStart.height;
        let newX = windowStart.x;
        let newY = windowStart.y;

        if (resizeDirection.includes("right")) {
          newWidth = Math.max(minWidth, sizeStart.width + deltaX);
        }
        if (resizeDirection.includes("left")) {
          const widthChange = -deltaX;
          newWidth = Math.max(minWidth, sizeStart.width + widthChange);
          if (newWidth > minWidth || widthChange > 0) {
            newX = windowStart.x - (newWidth - sizeStart.width);
          } else {
            newX = windowStart.x - (minWidth - sizeStart.width);
          }
        }

        if (resizeDirection.includes("bottom")) {
          newHeight = Math.max(minHeight, sizeStart.height + deltaY);
        }
        if (resizeDirection.includes("top")) {
          const heightChange = -deltaY;
          newHeight = Math.max(minHeight, sizeStart.height + heightChange);
          if (newHeight > minHeight || heightChange > 0) {
            newY = windowStart.y - (newHeight - sizeStart.height);
          } else {
            newY = windowStart.y - (minHeight - sizeStart.height);
          }
        }

        const { width: containerW, height: containerH } =
          containerBoundsRef.current;
        newX = Math.max(0, Math.min(containerW - newWidth, newX));
        newY = Math.max(49, Math.min(containerH - newHeight, newY));

        setSize({ width: newWidth, height: newHeight });
        setPosition({ x: newX, y: newY });

        if (onResize) {
          onResize();
        }
      }
    },
    [
      isDragging,
      isResizing,
      isMaximized,
      dragStart,
      windowStart,
      sizeStart,
      size,
      minWidth,
      minHeight,
      resizeDirection,
      onResize,
    ],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsResizing(false);
    setResizeDirection("");
  }, []);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, direction: string) => {
      if (isMaximized) return;

      e.preventDefault();
      e.stopPropagation();
      setIsResizing(true);
      setResizeDirection(direction);
      setDragStart({ x: e.clientX, y: e.clientY });
      setWindowStart({ x: position.x, y: position.y });
      setSizeStart({ width: size.width, height: size.height });

      const container = windowRef.current?.offsetParent as HTMLElement | null;
      containerBoundsRef.current = {
        width: container ? container.clientWidth : window.innerWidth,
        height: container ? container.clientHeight : window.innerHeight,
      };

      onFocus?.();
    },
    [isMaximized, position, size, onFocus],
  );

  useEffect(() => {
    if (isDragging || isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "none";
      document.body.style.cursor = isDragging ? "grabbing" : "resizing";

      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      };
    }
  }, [isDragging, isResizing, handleMouseMove, handleMouseUp]);

  const handleTitleDoubleClick = useCallback(() => {
    onMaximize?.();
  }, [onMaximize]);

  return (
    <div
      ref={windowRef}
      className={cn(
        "absolute bg-[#0d0e0c] border border-border rounded-none shadow-2xl",
        "select-none overflow-hidden flex flex-col",
        isMaximized ? "inset-0" : "",
      )}
      style={{
        left: isMaximized ? 0 : position.x,
        top: isMaximized ? 0 : position.y,
        width: isMaximized ? "100%" : size.width,
        height: isMaximized ? "100%" : size.height,
        zIndex,
      }}
      onClick={handleWindowClick}
    >
      <div
        ref={titleBarRef}
        className="flex items-center justify-between px-4 py-2 bg-muted/30 border-b border-border shrink-0 cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onDoubleClick={handleTitleDoubleClick}
      >
        <div className="flex items-center gap-3 flex-1 overflow-hidden">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-accent-brand shrink-0">
            {t("fileManager.editor")}
          </span>
          <div className="h-4 w-px bg-border/50 shrink-0" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground truncate">
            {title}
          </span>
        </div>

        <div className="flex items-center gap-0.5">
          {onMinimize && (
            <button
              className="size-6 flex items-center justify-center rounded-none hover:bg-accent-brand/10 hover:text-accent-brand text-muted-foreground transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onMinimize();
              }}
              title={t("common.minimize")}
            >
              <Minus className="size-3.5" />
            </button>
          )}

          {onMaximize && (
            <button
              className="size-6 flex items-center justify-center rounded-none hover:bg-accent-brand/10 hover:text-accent-brand text-muted-foreground transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onMaximize();
              }}
              title={isMaximized ? t("common.restore") : t("common.maximize")}
            >
              {isMaximized ? (
                <Minimize2 className="size-3.5" />
              ) : (
                <Maximize2 className="size-3.5" />
              )}
            </button>
          )}

          <button
            className="size-6 flex items-center justify-center rounded-none hover:bg-accent-brand/10 hover:text-accent-brand text-muted-foreground transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            title={t("common.close")}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">{children}</div>

      {!isMaximized && (
        <>
          <div
            className="absolute top-0 left-0 right-0 h-1 cursor-n-resize"
            onMouseDown={(e) => handleResizeStart(e, "top")}
          />
          <div
            className="absolute bottom-0 left-0 right-0 h-1 cursor-s-resize"
            onMouseDown={(e) => handleResizeStart(e, "bottom")}
          />
          <div
            className="absolute top-0 bottom-0 left-0 w-1 cursor-w-resize"
            onMouseDown={(e) => handleResizeStart(e, "left")}
          />
          <div
            className="absolute top-0 bottom-0 right-0 w-1 cursor-e-resize"
            onMouseDown={(e) => handleResizeStart(e, "right")}
          />

          <div
            className="absolute top-0 left-0 w-2 h-2 cursor-nw-resize"
            onMouseDown={(e) => handleResizeStart(e, "top-left")}
          />
          <div
            className="absolute top-0 right-0 w-2 h-2 cursor-ne-resize"
            onMouseDown={(e) => handleResizeStart(e, "top-right")}
          />
          <div
            className="absolute bottom-0 left-0 w-2 h-2 cursor-sw-resize"
            onMouseDown={(e) => handleResizeStart(e, "bottom-left")}
          />
          <div
            className="absolute bottom-0 right-0 w-2 h-2 cursor-se-resize"
            onMouseDown={(e) => handleResizeStart(e, "bottom-right")}
          />
        </>
      )}
    </div>
  );
}
