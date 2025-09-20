import React, { useState, useRef, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Minus, Square, X, Maximize2, Minimize2 } from "lucide-react";

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
  // 窗口状态
  const [position, setPosition] = useState({ x: initialX, y: initialY });
  const [size, setSize] = useState({
    width: initialWidth,
    height: initialHeight,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<string>("");

  // 拖拽开始位置
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [windowStart, setWindowStart] = useState({ x: 0, y: 0 });

  const windowRef = useRef<HTMLDivElement>(null);
  const titleBarRef = useRef<HTMLDivElement>(null);

  // 处理窗口焦点
  const handleWindowClick = useCallback(() => {
    onFocus?.();
  }, [onFocus]);

  // 拖拽处理
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
          ), // 保持标题栏可见
        });
      }

      if (isResizing && !isMaximized) {
        const deltaX = e.clientX - dragStart.x;
        const deltaY = e.clientY - dragStart.y;

        let newWidth = size.width;
        let newHeight = size.height;
        let newX = position.x;
        let newY = position.y;

        if (resizeDirection.includes("right")) {
          newWidth = Math.max(minWidth, windowStart.x + deltaX);
        }
        if (resizeDirection.includes("left")) {
          newWidth = Math.max(minWidth, size.width - deltaX);
          newX = Math.min(
            windowStart.x + deltaX,
            position.x + size.width - minWidth,
          );
        }
        if (resizeDirection.includes("bottom")) {
          newHeight = Math.max(minHeight, windowStart.y + deltaY);
        }
        if (resizeDirection.includes("top")) {
          newHeight = Math.max(minHeight, size.height - deltaY);
          newY = Math.min(
            windowStart.y + deltaY,
            position.y + size.height - minHeight,
          );
        }

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

  // 调整大小处理
  const handleResizeStart = useCallback(
    (e: React.MouseEvent, direction: string) => {
      if (isMaximized) return;

      e.preventDefault();
      e.stopPropagation();
      setIsResizing(true);
      setResizeDirection(direction);
      setDragStart({ x: e.clientX, y: e.clientY });
      setWindowStart({ x: size.width, y: size.height });
      onFocus?.();
    },
    [isMaximized, size, onFocus],
  );

  // 全局事件监听
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

  // 双击标题栏最大化/还原
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
      {/* 标题栏 */}
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
              title={isMaximized ? "还原" : "最大化"}
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

      {/* 窗口内容 */}
      <div
        className="flex-1 overflow-auto"
        style={{ height: "calc(100% - 40px)" }}
      >
        {children}
      </div>

      {/* 调整大小边框 - 只在非最大化时显示 */}
      {!isMaximized && (
        <>
          {/* 边缘调整 */}
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

          {/* 角落调整 */}
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
