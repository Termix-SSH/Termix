import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  PanelRight,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { hostToSSHHost } from "@/lib/host-to-ssh-host";
import type { Tab } from "@/types/ui-types";
import {
  arrangeCompanions,
  companionApplies,
  companionKey,
  patchCompanionState,
  resolveCompanionLayout,
  useCompanionDefs,
  useCompanionLayoutDefs,
  useCompanionState,
  type CompanionDef,
  type CompanionDefaults,
  type CompanionSide,
} from "./companions";

const DEFAULT_SIDE_SIZE = 360;
const DEFAULT_BOTTOM_SIZE = 280;
const MIN_SIZE = 200;

function DefaultsReader({
  def,
  onValue,
}: {
  def: CompanionDef;
  onValue: (id: string, value: CompanionDefaults) => void;
}) {
  const Reader = def.Defaults;
  const report = useCallback(
    (value: CompanionDefaults) => onValue(def.id, value),
    [def.id, onValue],
  );
  return Reader ? <Reader onValue={report} /> : null;
}

function sideIcon(side: CompanionSide) {
  if (side === "left") return ArrowLeftToLine;
  if (side === "bottom") return ArrowDownToLine;
  return ArrowRightToLine;
}

/**
 * Puts a pane beside a tab for the companions that apply to it. The tab keeps
 * its place in the tree, so opening or closing a companion never remounts it.
 */
export const CompanionFrame = memo(function CompanionFrame({
  tab,
  isVisible,
  children,
}: {
  tab: Tab;
  isVisible: boolean;
  children: ReactNode;
}) {
  const defs = useCompanionDefs();
  const layoutDefs = useCompanionLayoutDefs();
  const applicable = useMemo(
    () =>
      arrangeCompanions(
        defs.filter((def) => companionApplies(def, tab)),
        resolveCompanionLayout(tab.type, tab.host).order,
      ),
    // tab.host and tab.type decide it
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [defs, layoutDefs, tab.type, tab.host],
  );
  if (applicable.length === 0) return <>{children}</>;
  return (
    <CompanionLayout tab={tab} defs={applicable} isVisible={isVisible}>
      {children}
    </CompanionLayout>
  );
});

function CompanionLayout({
  tab,
  defs,
  isVisible,
  children,
}: {
  tab: Tab;
  defs: CompanionDef[];
  isVisible: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const key = companionKey(tab);
  const state = useCompanionState(key);
  const [defaults, setDefaults] = useState<Record<string, CompanionDefaults>>(
    {},
  );
  const [dragging, setDragging] = useState(false);
  // A companion stays mounted once opened, so it keeps its place and session.
  const [mounted, setMounted] = useState<Set<string>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);

  const onDefaults = useCallback((id: string, value: CompanionDefaults) => {
    setDefaults((prev) => {
      const old = prev[id];
      if (
        old &&
        old.open === value.open &&
        old.side === value.side &&
        old.size === value.size &&
        old.edgeButton === value.edgeButton
      ) {
        return prev;
      }
      return { ...prev, [id]: value };
    });
  }, []);

  // The first time a tab shows, a companion can open itself.
  useEffect(() => {
    if (state.seen || !isVisible) return;
    const ready = defs.every(
      (def) => !def.Defaults || defaults[def.id] !== undefined,
    );
    if (!ready) return;
    const auto = defs.find((def) => defaults[def.id]?.open);
    patchCompanionState(key, { seen: true, openId: auto?.id ?? null });
  }, [state.seen, isVisible, defs, defaults, key]);

  const active = defs.find((def) => def.id === state.openId) ?? null;
  useEffect(() => {
    if (!active) return;
    setMounted((prev) =>
      prev.has(active.id) ? prev : new Set(prev).add(active.id),
    );
  }, [active]);

  const activeDefaults = active ? defaults[active.id] : undefined;
  const layout = useMemo(
    () => resolveCompanionLayout(tab.type, tab.host),
    [tab.type, tab.host],
  );
  const side: CompanionSide = isMobile
    ? "bottom"
    : (state.side ?? layout.side ?? activeDefaults?.side ?? "right");
  const baseSize =
    state.size ??
    activeDefaults?.size ??
    (side === "bottom" ? DEFAULT_BOTTOM_SIZE : DEFAULT_SIDE_SIZE);

  const setSide = useCallback(
    (next: CompanionSide) => patchCompanionState(key, { side: next }),
    [key],
  );
  const close = useCallback(
    () => patchCompanionState(key, { openId: null }),
    [key],
  );

  const startResize = (event: React.MouseEvent) => {
    event.preventDefault();
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const total = side === "bottom" ? rect.height : rect.width;
    const max = Math.max(MIN_SIZE, total - MIN_SIZE);
    setDragging(true);
    const move = (e: MouseEvent) => {
      const raw =
        side === "right"
          ? rect.right - e.clientX
          : side === "left"
            ? e.clientX - rect.left
            : rect.bottom - e.clientY;
      patchCompanionState(key, {
        size: Math.round(Math.min(max, Math.max(MIN_SIZE, raw))),
      });
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const getHandle = useCallback(
    () => (tab.terminalRef?.current as Record<string, unknown> | null) ?? null,
    [tab.terminalRef],
  );
  const sshHost = useMemo(
    () =>
      tab.host
        ? (hostToSSHHost(tab.host) as unknown as Record<string, unknown>)
        : undefined,
    [tab.host],
  );

  const showEdge = defs.filter((def) => defaults[def.id]?.edgeButton !== false);
  const vertical = side === "bottom";
  const clamped = vertical ? Math.min(baseSize, 2000) : baseSize;
  const paneStyle = isMobile
    ? { height: "55%" }
    : vertical
      ? { height: clamped }
      : { width: clamped };
  const SideIcon = sideIcon(side);

  return (
    <div className="flex h-full w-full min-h-0 min-w-0">
      {defs.map((def) =>
        def.Defaults ? (
          <DefaultsReader key={def.id} def={def} onValue={onDefaults} />
        ) : null,
      )}
      <div
        ref={rootRef}
        className={cn(
          "relative flex flex-1 min-h-0 min-w-0",
          vertical
            ? "flex-col"
            : side === "left"
              ? "flex-row-reverse"
              : "flex-row",
        )}
      >
        <div className="relative flex-1 min-h-0 min-w-0">{children}</div>
        {defs.map((def) => {
          if (!mounted.has(def.id)) return null;
          const open = active?.id === def.id;
          const Component = def.component;
          const Icon = def.icon;
          return (
            <div
              key={def.id}
              className={cn(
                "relative flex-shrink-0 flex-col min-h-0 min-w-0 bg-background border-border",
                open ? "flex" : "hidden",
                vertical
                  ? "border-t"
                  : side === "left"
                    ? "border-r"
                    : "border-l",
                isMobile && "absolute inset-x-0 bottom-0 z-20 shadow-lg",
              )}
              style={paneStyle}
            >
              {!isMobile && (
                <div
                  role="separator"
                  aria-label={t("companion.resize")}
                  onMouseDown={startResize}
                  className={cn(
                    "absolute z-10",
                    vertical
                      ? "inset-x-0 -top-1 h-2 cursor-row-resize"
                      : side === "left"
                        ? "inset-y-0 -right-1 w-2 cursor-col-resize"
                        : "inset-y-0 -left-1 w-2 cursor-col-resize",
                    dragging && "bg-primary/30",
                  )}
                />
              )}
              <div className="flex items-center gap-1.5 h-8 px-2 border-b border-border flex-shrink-0">
                {Icon && <Icon className="size-3.5 text-muted-foreground" />}
                <span className="text-xs font-medium truncate flex-1">
                  {def.titleKey ? t(def.titleKey) : def.id}
                </span>
                {!isMobile && (
                  <button
                    type="button"
                    className="p-1 text-muted-foreground hover:text-foreground"
                    title={t("companion.moveSide")}
                    onClick={() =>
                      setSide(
                        side === "right"
                          ? "bottom"
                          : side === "bottom"
                            ? "left"
                            : "right",
                      )
                    }
                  >
                    <SideIcon className="size-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  className="p-1 text-muted-foreground hover:text-foreground"
                  title={t("companion.close")}
                  onClick={close}
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
                <Component
                  tab={tab}
                  host={tab.host}
                  sshHost={sshHost}
                  getHandle={getHandle}
                  side={side}
                  isVisible={isVisible && open}
                  close={close}
                  setSide={setSide}
                />
              </div>
            </div>
          );
        })}
      </div>
      {showEdge.length > 0 && !isMobile && (
        <div className="flex flex-col flex-shrink-0 w-6 items-center gap-1 pt-1 border-l border-border bg-background">
          {showEdge.map((def) => {
            const Icon = def.icon ?? PanelRight;
            const open = active?.id === def.id;
            return (
              <button
                key={def.id}
                type="button"
                title={def.titleKey ? t(def.titleKey) : def.id}
                aria-pressed={open}
                onClick={() =>
                  patchCompanionState(key, {
                    seen: true,
                    openId: open ? null : def.id,
                  })
                }
                className={cn(
                  "p-1 text-muted-foreground hover:text-foreground",
                  open && "text-foreground bg-accent",
                )}
              >
                <Icon className="size-3.5" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
