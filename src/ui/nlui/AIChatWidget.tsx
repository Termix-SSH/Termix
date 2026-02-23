import React, { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip.tsx";
import { useAIEngine } from "./useAIEngine";
import { AIChatPanel } from "./AIChatPanel";

const DEFAULT_W = 420;
const DEFAULT_H = 600;
const MIN_W = 320;
const MIN_H = 400;

// Mutable drag/resize state — lives outside React render cycle for zero-overhead mousemove
interface DragState {
  active: boolean;
  mode: "drag" | "resize";
  dir: string;
  startMouseX: number;
  startMouseY: number;
  startX: number;
  startY: number;
  startW: number;
  startH: number;
}

export function AIChatWidget(): React.ReactElement | null {
  const { t } = useTranslation();
  const { engine, loading, error } = useAIEngine();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  // Position/size as state — only updated on mouseup (end of interaction)
  const [position, setPosition] = useState({
    x: window.innerWidth - DEFAULT_W - 24,
    y: window.innerHeight - DEFAULT_H - 80,
  });
  const [size, setSize] = useState({ width: DEFAULT_W, height: DEFAULT_H });

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState>({
    active: false, mode: "drag", dir: "",
    startMouseX: 0, startMouseY: 0,
    startX: 0, startY: 0, startW: 0, startH: 0,
  });

  if (error === "noConfig") return null;

  const handleOpen = () => {
    setIsOpen(true);
    setIsMinimized(false);
  };

  const handleClose = () => {
    setIsOpen(false);
    setIsMinimized(false);
  };

  const handleMinimize = () => {
    setIsMinimized(true);
  };

  const applyTransform = (x: number, y: number, w: number, h: number) => {
    const el = containerRef.current;
    if (!el) return;
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.width = w + "px";
    el.style.height = h + "px";
  };

  const onMouseMove = (e: MouseEvent) => {
    const d = dragRef.current;
    if (!d.active) return;

    const dx = e.clientX - d.startMouseX;
    const dy = e.clientY - d.startMouseY;

    if (d.mode === "drag") {
      const x = Math.max(0, Math.min(window.innerWidth - d.startW, d.startX + dx));
      const y = Math.max(0, Math.min(window.innerHeight - d.startH, d.startY + dy));
      applyTransform(x, y, d.startW, d.startH);
      return;
    }

    // resize
    let w = d.startW, h = d.startH, x = d.startX, y = d.startY;

    if (d.dir.includes("right"))  w = Math.max(MIN_W, d.startW + dx);
    if (d.dir.includes("left"))  { w = Math.max(MIN_W, d.startW - dx); x = d.startX - (w - d.startW); }
    if (d.dir.includes("bottom")) h = Math.max(MIN_H, d.startH + dy);
    if (d.dir.includes("top"))   { h = Math.max(MIN_H, d.startH - dy); y = d.startY - (h - d.startH); }

    x = Math.max(0, Math.min(window.innerWidth - w, x));
    y = Math.max(0, Math.min(window.innerHeight - h, y));

    applyTransform(x, y, w, h);
  };

  const onMouseUp = () => {
    const d = dragRef.current;
    if (!d.active) return;
    d.active = false;

    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";

    // Sync final DOM values back into React state (single render)
    const el = containerRef.current;
    if (el) {
      setPosition({ x: parseFloat(el.style.left), y: parseFloat(el.style.top) });
      setSize({ width: parseFloat(el.style.width), height: parseFloat(el.style.height) });
    }
  };

  const startInteraction = (e: React.MouseEvent, mode: "drag" | "resize", dir = "") => {
    e.preventDefault();
    e.stopPropagation();

    const d = dragRef.current;
    const el = containerRef.current;
    if (!el) return;

    d.active = true;
    d.mode = mode;
    d.dir = dir;
    d.startMouseX = e.clientX;
    d.startMouseY = e.clientY;
    d.startX = parseFloat(el.style.left) || position.x;
    d.startY = parseFloat(el.style.top) || position.y;
    d.startW = el.offsetWidth;
    d.startH = el.offsetHeight;

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.userSelect = "none";
    document.body.style.cursor = mode === "drag" ? "grabbing" : "";
  };

  const handleDragStart = (e: React.MouseEvent) => startInteraction(e, "drag");
  const handleResizeStart = (e: React.MouseEvent, dir: string) => startInteraction(e, "resize", dir);

  // Cleanup on unmount — in case user closes panel mid-drag
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, []);

  return (
    <>
      {/* Floating button */}
      {(!isOpen || isMinimized) && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              onClick={handleOpen}
              className="fixed bottom-20 right-6 z-50 h-10 w-10 rounded-full shadow-lg hover:shadow-xl hover:scale-105 transition-all animate-in fade-in zoom-in-90 duration-300"
            >
              <Sparkles className="h-4.5 w-4.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">{t("ai.title")}</TooltipContent>
        </Tooltip>
      )}

      {/* Chat panel */}
      {isOpen && !isMinimized && (
        <div
          ref={containerRef}
          className="fixed z-50 animate-in fade-in slide-in-from-bottom-4 duration-200"
          style={{
            left: position.x,
            top: position.y,
            width: size.width,
            height: size.height,
          }}
        >
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-2 h-full bg-canvas rounded-lg border-2 border-edge shadow-xl">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {t("ai.loading")}
              </span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full bg-canvas rounded-lg border-2 border-edge shadow-xl p-4">
              <div className="text-sm text-destructive text-center">
                {error}
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={handleClose}
                >
                  {t("ai.close")}
                </Button>
              </div>
            </div>
          ) : engine ? (
            <AIChatPanel
              engine={engine}
              onClose={handleClose}
              onMinimize={handleMinimize}
              onDragStart={handleDragStart}
            />
          ) : null}

          {/* Resize handles — 4 edges + 4 corners */}
          <div className="absolute top-0 left-0 right-0 h-1 cursor-n-resize" onMouseDown={(e) => handleResizeStart(e, "top")} />
          <div className="absolute bottom-0 left-0 right-0 h-1 cursor-s-resize" onMouseDown={(e) => handleResizeStart(e, "bottom")} />
          <div className="absolute top-0 bottom-0 left-0 w-1 cursor-w-resize" onMouseDown={(e) => handleResizeStart(e, "left")} />
          <div className="absolute top-0 bottom-0 right-0 w-1 cursor-e-resize" onMouseDown={(e) => handleResizeStart(e, "right")} />
          <div className="absolute top-0 left-0 w-2 h-2 cursor-nw-resize" onMouseDown={(e) => handleResizeStart(e, "top-left")} />
          <div className="absolute top-0 right-0 w-2 h-2 cursor-ne-resize" onMouseDown={(e) => handleResizeStart(e, "top-right")} />
          <div className="absolute bottom-0 left-0 w-2 h-2 cursor-sw-resize" onMouseDown={(e) => handleResizeStart(e, "bottom-left")} />
          <div className="absolute bottom-0 right-0 w-2 h-2 cursor-se-resize" onMouseDown={(e) => handleResizeStart(e, "bottom-right")} />
        </div>
      )}
    </>
  );
}
