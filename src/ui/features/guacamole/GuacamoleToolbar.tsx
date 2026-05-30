import React, {
  useState,
  useRef,
  useCallback,
  useLayoutEffect,
  useEffect,
} from "react";
import {
  GripVertical,
  Monitor,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ChevronsLeftRight,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/tooltip.tsx";
import type { GuacamoleDisplayHandle } from "@/features/guacamole/GuacamoleDisplay.tsx";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface GuacamoleToolbarProps {
  displayRef: React.RefObject<GuacamoleDisplayHandle>;
  protocol: "rdp" | "vnc" | "telnet";
}

const MODIFIER_KEYSYMS = {
  ctrl: 0xffe3,
  alt: 0xffe9,
  shift: 0xffe1,
  win: 0xff67,
} as const;

const FKEY_KEYSYMS = Array.from({ length: 12 }, (_, i) => 0xffbe + i);

const BTN_BASE =
  "flex items-center justify-center gap-1 h-7 px-2 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded-sm whitespace-nowrap select-none";

const BTN_ICON =
  "flex items-center justify-center size-7 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded-sm select-none";

const SEP = "w-px h-5 bg-border mx-0.5 shrink-0";

function TipBtn({
  tooltip,
  onClick,
  className,
  children,
}: {
  tooltip: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={cn(BTN_BASE, className)}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function TipIconBtn({
  tooltip,
  onClick,
  className,
  children,
}: {
  tooltip: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={cn(BTN_ICON, className)}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

export const GuacamoleToolbar: React.FC<GuacamoleToolbarProps> = ({
  displayRef,
  protocol,
}) => {
  const { t } = useTranslation();
  const [position, setPosition] = useState({ x: 0, y: 12 });
  const [collapsed, setCollapsed] = useState(false);
  const [showFKeys, setShowFKeys] = useState(false);
  const [stickyKeys, setStickyKeys] = useState<Record<number, boolean>>({
    [MODIFIER_KEYSYMS.ctrl]: false,
    [MODIFIER_KEYSYMS.alt]: false,
    [MODIFIER_KEYSYMS.shift]: false,
    [MODIFIER_KEYSYMS.win]: false,
  });

  const toolbarRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragOriginRef = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 });
  const [isDragging, setIsDragging] = useState(false);

  useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const parent = el.offsetParent as HTMLElement | null;
    if (!parent) return;
    const parentW = parent.clientWidth;
    const toolbarW = el.offsetWidth;
    setPosition((p) => ({ ...p, x: Math.max(0, (parentW - toolbarW) / 2) }));
  }, [collapsed]);

  useEffect(() => {
    if (!isDragging) return;

    const onMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const parent = toolbarRef.current?.offsetParent as HTMLElement | null;
      const parentW = parent?.clientWidth ?? Infinity;
      const parentH = parent?.clientHeight ?? Infinity;
      const toolbarW = toolbarRef.current?.offsetWidth ?? 0;
      const toolbarH = toolbarRef.current?.offsetHeight ?? 0;

      const dx = e.clientX - dragOriginRef.current.mouseX;
      const dy = e.clientY - dragOriginRef.current.mouseY;
      setPosition({
        x: Math.max(
          0,
          Math.min(dragOriginRef.current.posX + dx, parentW - toolbarW),
        ),
        y: Math.max(
          0,
          Math.min(dragOriginRef.current.posY + dy, parentH - toolbarH),
        ),
      });
    };

    const onUp = () => {
      isDraggingRef.current = false;
      setIsDragging(false);
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [isDragging]);

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      dragOriginRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        posX: position.x,
        posY: position.y,
      };
      document.body.style.userSelect = "none";
      setIsDragging(true);
    },
    [position],
  );

  const releaseStickyKeys = useCallback(() => {
    const display = displayRef.current;
    if (!display) return;
    setStickyKeys((prev) => {
      const next = { ...prev };
      for (const [ksStr, active] of Object.entries(prev)) {
        if (active) {
          display.sendKey(Number(ksStr), false);
          next[Number(ksStr)] = false;
        }
      }
      return next;
    });
  }, [displayRef]);

  const sendCombo = useCallback(
    (...keysyms: number[]) => {
      const display = displayRef.current;
      if (!display) return;
      for (const k of keysyms) display.sendKey(k, true);
      for (const k of [...keysyms].reverse()) display.sendKey(k, false);
      releaseStickyKeys();
    },
    [displayRef, releaseStickyKeys],
  );

  const toggleStickyKey = useCallback(
    (keysym: number) => {
      const display = displayRef.current;
      if (!display) return;
      setStickyKeys((prev) => {
        const isActive = prev[keysym];
        display.sendKey(keysym, !isActive);
        return { ...prev, [keysym]: !isActive };
      });
    },
    [displayRef],
  );

  const isRdpVnc = protocol === "rdp" || protocol === "vnc";

  const containerStyle: React.CSSProperties = {
    position: "absolute",
    left: position.x,
    top: position.y,
    zIndex: 20,
  };

  return (
    <TooltipProvider delayDuration={500}>
      <div
        ref={toolbarRef}
        style={containerStyle}
        onMouseDown={(e) => e.preventDefault()}
      >
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center bg-background/85 backdrop-blur-sm border border-border shadow-lg rounded-sm overflow-hidden">
                <button
                  type="button"
                  onMouseDown={startDrag}
                  className="flex items-center justify-center size-7 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-grab active:cursor-grabbing"
                >
                  <GripVertical className="size-3" />
                </button>
                <div className="w-px h-4 bg-border" />
                <button
                  type="button"
                  onClick={() => setCollapsed(false)}
                  className="flex items-center justify-center size-7 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <Monitor className="size-3.5" />
                </button>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {t("guacamole.toolbar.expand")}
            </TooltipContent>
          </Tooltip>
        ) : (
          <div className="flex items-center bg-background/85 backdrop-blur-sm border border-border shadow-lg rounded-sm px-0.5 py-0.5 gap-0">
            {/* Drag handle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onMouseDown={startDrag}
                  className="flex items-center justify-center h-7 px-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded-sm cursor-grab active:cursor-grabbing"
                >
                  <GripVertical className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {t("guacamole.toolbar.dragHandle")}
              </TooltipContent>
            </Tooltip>

            {/* System combos — RDP/VNC only */}
            {isRdpVnc && (
              <>
                <div className={SEP} />
                <TipBtn
                  tooltip={t("guacamole.toolbar.ctrlAltDel")}
                  onClick={() => sendCombo(0xffe3, 0xffe9, 0xffff)}
                >
                  CAD
                </TipBtn>
                <TipBtn
                  tooltip={t("guacamole.toolbar.winL")}
                  onClick={() => sendCombo(0xff67, 0x006c)}
                >
                  Win+L
                </TipBtn>
                <TipBtn
                  tooltip={t("guacamole.toolbar.winKey")}
                  onClick={() => sendCombo(0xff67)}
                >
                  Win
                </TipBtn>
              </>
            )}

            {/* Sticky modifiers — RDP/VNC only */}
            {isRdpVnc && (
              <>
                <div className={SEP} />
                {(
                  [
                    [
                      "ctrl",
                      MODIFIER_KEYSYMS.ctrl,
                      t("guacamole.toolbar.ctrl"),
                    ],
                    ["alt", MODIFIER_KEYSYMS.alt, t("guacamole.toolbar.alt")],
                    [
                      "shift",
                      MODIFIER_KEYSYMS.shift,
                      t("guacamole.toolbar.shift"),
                    ],
                    ["win", MODIFIER_KEYSYMS.win, t("guacamole.toolbar.win")],
                  ] as [string, number, string][]
                ).map(([key, ks, label]) => (
                  <Tooltip key={key}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => toggleStickyKey(ks)}
                        className={cn(
                          BTN_BASE,
                          stickyKeys[ks] &&
                            "bg-primary/15 text-primary border border-primary/30",
                        )}
                      >
                        {label}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={6}>
                      {stickyKeys[ks]
                        ? t("guacamole.toolbar.stickyActive", { key: label })
                        : t("guacamole.toolbar.stickyInactive", { key: label })}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </>
            )}

            {/* Function key toggle */}
            <div className={SEP} />
            <TipBtn
              tooltip={t("guacamole.toolbar.fnToggle")}
              onClick={() => setShowFKeys((v) => !v)}
              className={cn(
                showFKeys &&
                  "bg-primary/15 text-primary border border-primary/30",
              )}
            >
              Fn
            </TipBtn>

            {/* F1-F12 row */}
            {showFKeys &&
              FKEY_KEYSYMS.map((ks, i) => (
                <TipBtn
                  key={ks}
                  tooltip={`F${i + 1}`}
                  onClick={() => sendCombo(ks)}
                >
                  F{i + 1}
                </TipBtn>
              ))}

            {/* Navigation */}
            <div className={SEP} />
            <TipBtn
              tooltip={t("guacamole.toolbar.esc")}
              onClick={() => sendCombo(0xff1b)}
            >
              Esc
            </TipBtn>
            <TipBtn
              tooltip={t("guacamole.toolbar.tab")}
              onClick={() => sendCombo(0xff09)}
            >
              Tab
            </TipBtn>
            <TipBtn
              tooltip={t("guacamole.toolbar.home")}
              onClick={() => sendCombo(0xff50)}
            >
              Home
            </TipBtn>
            <TipBtn
              tooltip={t("guacamole.toolbar.end")}
              onClick={() => sendCombo(0xff57)}
            >
              End
            </TipBtn>
            <TipBtn
              tooltip={t("guacamole.toolbar.pageUp")}
              onClick={() => sendCombo(0xff55)}
            >
              PgUp
            </TipBtn>
            <TipBtn
              tooltip={t("guacamole.toolbar.pageDown")}
              onClick={() => sendCombo(0xff56)}
            >
              PgDn
            </TipBtn>

            {/* Arrow cluster */}
            <div className="flex flex-col ml-0.5">
              <div className="flex justify-center">
                <TipIconBtn
                  tooltip={t("guacamole.toolbar.arrowUp")}
                  onClick={() => sendCombo(0xff52)}
                >
                  <ChevronUp className="size-3" />
                </TipIconBtn>
              </div>
              <div className="flex">
                <TipIconBtn
                  tooltip={t("guacamole.toolbar.arrowLeft")}
                  onClick={() => sendCombo(0xff51)}
                >
                  <ChevronLeft className="size-3" />
                </TipIconBtn>
                <TipIconBtn
                  tooltip={t("guacamole.toolbar.arrowDown")}
                  onClick={() => sendCombo(0xff54)}
                >
                  <ChevronDown className="size-3" />
                </TipIconBtn>
                <TipIconBtn
                  tooltip={t("guacamole.toolbar.arrowRight")}
                  onClick={() => sendCombo(0xff53)}
                >
                  <ChevronRight className="size-3" />
                </TipIconBtn>
              </div>
            </div>

            {/* Collapse */}
            <div className="w-px h-5 bg-border mx-0.5 shrink-0" />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setCollapsed(true)}
                  className={cn(BTN_ICON)}
                >
                  <ChevronsLeftRight className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {t("guacamole.toolbar.collapse")}
              </TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
};
