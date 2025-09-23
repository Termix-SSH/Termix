import React, { useState, useRef, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Minus, Square, X, Maximize2, Minimize2 } from "lucide-react";
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
  isMaximized?: boolean;
  zIndex?: number;
  onFocus?: () => void;
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
  isMaximized = false,
  zIndex = 1000,
  onFocus,
}: DraggableWindowProps) {
  const { t } = useTranslation();
  // Window state
  const [position, setPosition] = useState({ x: initialX, y: initialY });
  const [size, setSize] = useState({
    width: initialWidth,
    height: initialHeight,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<string>("");

  // Drag and resize start positions
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [windowStart, setWindowStart] = useState({ x: 0, y: 0 });
  const [sizeStart, setSizeStart] = useState({ width: 0, height: 0 });

  const windowRef = useRef<HTMLDivElement>(null);
  const titleBarRef = useRef<HTMLDivElement>(null);

  // Handle window focus
  const handleWindowClick = useCallback(() => {
    onFocus?.();
  }, [onFocus]);

  // Drag handling
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isMaximized) return;

      e.preventDefault();
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      setWindowStart({ x: position.x, y: position.y });
      onFocus?.();
    },
    [isMaximized, position, onFocus],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (isDragging && !isMaximized) {
        const deltaX = e.clientX - dragStart.x;
        const deltaY = e.clientY - dragStart.y;

        setPosition({
          x: Math.max(
            0,
            Math.min(window.innerWidth - size.width, windowStart.x + deltaX),
          ),
          y: Math.max(
            0,
            Math.min(window.innerHeight - 40, windowStart.y + deltaY),
          ), // Keep title bar visible
        });
      }

      if (isResizing && !isMaximized) {
        const deltaX = e.clientX - dragStart.x;
        const deltaY = e.clientY - dragStart.y;

        let newWidth = sizeStart.width;
        let newHeight = sizeStart.height;
        let newX = windowStart.x;
        let newY = windowStart.y;

        // Handle horizontal resizing
        if (resizeDirection.includes("right")) {
          newWidth = Math.max(minWidth, sizeStart.width + deltaX);
        }
        if (resizeDirection.includes("left")) {
          const widthChange = -deltaX;
          newWidth = Math.max(minWidth, sizeStart.width + widthChange);
          // Only move position if we're actually changing size
          if (newWidth > minWidth || widthChange > 0) {
            newX = windowStart.x - (newWidth - sizeStart.width);
          } else {
            newX = windowStart.x - (minWidth - sizeStart.width);
          }
        }

        // Handle vertical resizing
        if (resizeDirection.includes("bottom")) {
          newHeight = Math.max(minHeight, sizeStart.height + deltaY);
        }
        if (resizeDirection.includes("top")) {
          const heightChange = -deltaY;
          newHeight = Math.max(minHeight, sizeStart.height + heightChange);
          // Only move position if we're actually changing size
          if (newHeight > minHeight || heightChange > 0) {
            newY = windowStart.y - (newHeight - sizeStart.height);
          } else {
            newY = windowStart.y - (minHeight - sizeStart.height);
          }
        }

        // Ensure window stays within viewport
        newX = Math.max(0, Math.min(window.innerWidth - newWidth, newX));
        newY = Math.max(0, Math.min(window.innerHeight - newHeight, newY));

        setSize({ width: newWidth, height: newHeight });
        setPosition({ x: newX, y: newY });
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
      position,
      minWidth,
      minHeight,
      resizeDirection,
    ],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsResizing(false);
    setResizeDirection("");
  }, []);

  // Resize handling
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
      onFocus?.();
    },
    [isMaximized, position, size, onFocus],
  );

  // Global event listeners
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

  // Double-click title bar to maximize/restore
  const handleTitleDoubleClick = useCallback(() => {
    onMaximize?.();
  }, [onMaximize]);

  return (
    <div
      ref={windowRef}
      className={cn(
        "absolute bg-card border border-border rounded-lg shadow-2xl",
        "select-none overflow-hidden",
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
      {/* Title bar */}
      <div
        ref={titleBarRef}
        className={cn(
          "flex items-center justify-between px-3 py-2",
          "bg-muted/50 text-foreground border-b border-border",
          "cursor-grab active:cursor-grabbing",
        )}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleTitleDoubleClick}
      >
        <div className="flex items-center gap-2 flex-1">
          <span className="text-sm font-medium truncate">{title}</span>
        </div>

        <div className="flex items-center gap-1">
          {onMinimize && (
            <button
              className="w-8 h-6 flex items-center justify-center rounded hover:bg-accent transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onMinimize();
              }}
              title={t("common.minimize")}
            >
              <Minus className="w-4 h-4" />
            </button>
          )}

          {onMaximize && (
            <button
              className="w-8 h-6 flex items-center justify-center rounded hover:bg-accent transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onMaximize();
              }}
              title={isMaximized ? t("common.restore") : t("common.maximize")}
            >
              {isMaximized ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>
          )}

          <button
            className="w-8 h-6 flex items-center justify-center rounded hover:bg-destructive hover:text-destructive-foreground transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            title={t("common.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Window content */}
      <div
        className="flex-1 overflow-auto"
        style={{ height: "calc(100% - 40px)" }}
      >
        {children}
      </div>

      {/* Resize borders - only show when not maximized */}
      {!isMaximized && (
        <>
          {/* Edge resize */}
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

          {/* Corner resize */}
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
