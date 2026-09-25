import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronDown,
  ClipboardPaste,
  GripVertical,
  ImagePlus,
  LayoutGrid,
  LogOut,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";

import {
  TERMINAL_TOOLBAR_SLOT,
  TERMINAL_TOOLBAR_STATUS_SLOT,
  type TerminalSlotApi,
} from "./terminal-slots";
import type { Host } from "../types";
import {
  clampToolbarPosition,
  getResponsiveToolbarDensity,
  persistToolbarPosition,
  readStoredToolbarPosition,
  type ToolbarPosition,
  type ToolbarDensity,
} from "./toolbar-geometry";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  cn,
  ActionSlot,
  ComponentSlot,
  useIsMobile,
} from "@termix/plugin-sdk/ui";
import {
  useHostActions,
  useTabs,
  useTranslation,
  useSlotContributions,
  type PluginHostRecord,
  type ShellApi,
} from "@termix/plugin-sdk/frontend";
type SelectedToolbarDensity = ToolbarDensity;

const DENSITY_STORAGE_KEY = "termix-terminal-toolbar-density";

/** Plugins contribute toolbar buttons here. Declared by the ssh-terminal plugin. */
const TOOLBAR_SLOT_ID = TERMINAL_TOOLBAR_SLOT;

const DENSITY_OPTIONS: { value: ToolbarDensity }[] = [
  { value: "icon" },
  { value: "labeled" },
  { value: "expanded" },
];
const DENSITIES = DENSITY_OPTIONS.map((option) => option.value);

function readStoredDensity(): ToolbarDensity {
  if (typeof window === "undefined") return "labeled";
  try {
    const stored = window.localStorage.getItem(DENSITY_STORAGE_KEY);
    return DENSITIES.includes(stored as ToolbarDensity)
      ? (stored as ToolbarDensity)
      : "labeled";
  } catch {
    return "labeled";
  }
}

const CONTROL =
  "inline-flex min-h-8 min-w-8 items-center justify-center gap-1.5 rounded-sm px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:translate-y-px active:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 data-[state=open]:bg-muted data-[state=open]:text-foreground";
const SEPARATOR = "mx-0.5 h-5 w-px shrink-0 bg-border";

interface TerminalToolbarProps {
  host: Host;
  terminalIdentity?: string;
  isConnected: boolean;
  isTmuxAttached: boolean;
  onTmuxDetach: () => void;
  isImageUploading: boolean;
  onUploadImage: (file: File) => void | Promise<void>;
  onPasteImage: () => void | Promise<void>;
  isFocused: boolean;
  /** Hides every contributed action, e.g. while the toolbar is measuring. */
  actionsEnabled?: boolean;
  /** Handed to contributed actions when they are invoked. */
  slotApi?: TerminalSlotApi;
}

export const TerminalToolbar: React.FC<TerminalToolbarProps> = ({
  host,
  terminalIdentity,
  isConnected,
  isTmuxAttached,
  onTmuxDetach,
  isImageUploading,
  onUploadImage,
  onPasteImage,
  isFocused,
  actionsEnabled = true,
  slotApi,
}) => {
  const { t } = useTranslation();
  // Drives both the measurement copy and the separator, so the toolbar sizes
  // itself correctly whether or not anything contributed.
  const allSlotContributions = useSlotContributions(TOOLBAR_SLOT_ID, { host });
  const statusContributions = useSlotContributions(
    TERMINAL_TOOLBAR_STATUS_SLOT,
    { host },
  );
  const slotContributions = useMemo(
    () =>
      allSlotContributions.filter(
        (contribution) => contribution.kind !== "component",
      ),
    [allSlotContributions],
  );
  // Quick links to the other tools a plugin offers for this host (tmux
  // monitor, docker, tunnels, host metrics), from their host actions.
  const hostActions = useHostActions();
  const tabs = useTabs();
  const hostLinks = useMemo(() => {
    const record = host as unknown as PluginHostRecord;
    return hostActions.filter(
      (action) =>
        action.kind === "open" &&
        !action.items &&
        (action.run || action.tabType) &&
        action.when(record),
    );
  }, [hostActions, host]);
  const openHostLink = (action: (typeof hostLinks)[number]) => {
    const record = host as unknown as PluginHostRecord;
    if (action.run) action.run(record, tabs as unknown as ShellApi);
    else if (action.tabType) tabs.openTab(record, action.tabType);
  };
  const [density, setDensity] =
    useState<SelectedToolbarDensity>(readStoredDensity);
  const [responsiveDensity, setResponsiveDensity] =
    useState<SelectedToolbarDensity>(readStoredDensity);
  const [position, setPosition] = useState<ToolbarPosition>(
    readStoredToolbarPosition,
  );
  const positionRef = useRef(position);
  const [collapsed, setCollapsed] = useState(false);
  const [densityOpen, setDensityOpen] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [retryImageAction, setRetryImageAction] = useState<(() => void) | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hideToolbarRef = useRef<HTMLButtonElement>(null);
  const pendingExpansionFocusRef = useRef(false);
  const pendingRightEdgeRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const imageGenerationRef = useRef(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const measurementRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    basePosition: ToolbarPosition;
  } | null>(null);
  const capturedPointerIdRef = useRef<number | null>(null);
  const dragMovedRef = useRef(false);
  const densityId = useId();
  const [desktopViewportReady, setDesktopViewportReady] = useState<boolean>();
  const hostIdentity = terminalIdentity ?? `${host.id ?? "unknown"}`;
  positionRef.current = position;
  const effectiveDensity: ToolbarDensity = isFocused
    ? responsiveDensity
    : "icon";
  const showStats =
    effectiveDensity === "expanded" && statusContributions.length > 0;
  const isMobile = useIsMobile();

  useLayoutEffect(() => {
    setDesktopViewportReady(
      typeof window !== "undefined" && window.innerWidth >= 768,
    );
  }, []);

  useEffect(() => {
    if (isMobile === false) setDesktopViewportReady(true);
  }, [isMobile]);

  useEffect(() => {
    if (desktopViewportReady !== true || isMobile !== false) return;
    try {
      window.localStorage.setItem(DENSITY_STORAGE_KEY, density);
    } catch {
      // Storage can be unavailable in hardened browser contexts.
    }
  }, [density, desktopViewportReady, isMobile]);

  // Picking an interface preset seeds this key, so pick the new value up
  // without needing the tab to remount.
  useEffect(() => {
    if (desktopViewportReady !== true || isMobile !== false) return;
    const handler = () => setDensity(readStoredDensity());
    window.addEventListener("terminalToolbarDensityChanged", handler);
    return () =>
      window.removeEventListener("terminalToolbarDensityChanged", handler);
  }, [desktopViewportReady, isMobile]);
  useEffect(() => {
    if (desktopViewportReady !== true || isMobile !== false) return;
    const measurement = measurementRef.current;
    const host = hostRef.current;
    if (!measurement || !host) return;
    let frameId: number | null = null;
    let remeasurements = 0;
    const measure = () => {
      frameId = null;
      const available = host.getBoundingClientRect().width;
      const required = measurement.getBoundingClientRect().width;
      if (available > 0 && required > 0) {
        setResponsiveDensity((current) =>
          getResponsiveToolbarDensity(density, current, available, required),
        );
        remeasurements = 0;
      } else if (remeasurements < 2) {
        remeasurements += 1;
        frameId = window.requestAnimationFrame(measure);
      }
    };
    const schedule = () => {
      if (frameId == null) frameId = window.requestAnimationFrame(measure);
    };
    schedule();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    observer?.observe(host);
    observer?.observe(measurement);
    return () => {
      if (frameId != null) window.cancelAnimationFrame(frameId);
      observer?.disconnect();
    };
  }, [
    density,
    desktopViewportReady,
    isConnected,
    isMobile,
    isTmuxAttached,
    actionsEnabled,
    slotContributions,
    hostLinks,
    t,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      imageGenerationRef.current += 1;
      dragRef.current = null;
      capturedPointerIdRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    if (desktopViewportReady !== true || isMobile !== false) return;
    const toolbar = toolbarRef.current;
    const host = hostRef.current;
    if (!toolbar || !host || dragRef.current) return;
    const hostRect = host.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();
    const extremeOffset =
      hostRect.width > 0 &&
      hostRect.height > 0 &&
      Math.max(
        Math.abs(positionRef.current.x),
        Math.abs(positionRef.current.y),
      ) >
        Math.max(hostRect.width, hostRect.height) * 4;
    if (extremeOffset) {
      positionRef.current = { x: 0, y: 0 };
      setPosition({ x: 0, y: 0 });
      persistToolbarPosition({ x: 0, y: 0 });
      return;
    }
    if (toolbarRect.width > 0 && toolbarRect.height > 0) {
      const pendingRightEdge = pendingRightEdgeRef.current;
      pendingRightEdgeRef.current = null;
      const baseRight = toolbarRect.right - positionRef.current.x;
      const next = clampToolbarPosition(
        {
          x:
            pendingRightEdge == null
              ? positionRef.current.x
              : pendingRightEdge - baseRight,
          y: positionRef.current.y,
        },
        toolbarRect,
        hostRect,
        positionRef.current,
      );
      if (
        next.x !== positionRef.current.x ||
        next.y !== positionRef.current.y
      ) {
        positionRef.current = next;
        setPosition(next);
        persistToolbarPosition(next);
      }
    }
    if (!collapsed && pendingExpansionFocusRef.current) {
      pendingExpansionFocusRef.current = false;
      hideToolbarRef.current?.focus();
    }
  }, [
    collapsed,
    density,
    desktopViewportReady,
    effectiveDensity,
    isConnected,
    isMobile,
    isTmuxAttached,
    responsiveDensity,
  ]);

  useEffect(() => {
    imageGenerationRef.current += 1;
    setImageError(null);
    setRetryImageAction(null);
  }, [isConnected, hostIdentity]);

  useEffect(() => {
    if (collapsed || !pendingExpansionFocusRef.current) return;
    pendingExpansionFocusRef.current = false;
    hideToolbarRef.current?.focus();
  }, [collapsed]);

  if (!isConnected || desktopViewportReady !== true || isMobile !== false)
    return null;

  const setAndStoreDensity = (next: ToolbarDensity) => {
    setDensity(next);
  };
  const reportImageResult = (
    action: () => void | Promise<void>,
    retry: () => void,
  ) => {
    const generation = ++imageGenerationRef.current;
    let result: void | Promise<void>;
    try {
      result = action();
    } catch (error) {
      result = Promise.reject(error);
    }
    void Promise.resolve(result).then(
      () => {
        if (!mountedRef.current || generation !== imageGenerationRef.current)
          return;
        setImageError(null);
        setRetryImageAction(null);
      },
      (error: unknown) => {
        if (!mountedRef.current || generation !== imageGenerationRef.current)
          return;
        setImageError(
          error instanceof Error
            ? error.message
            : t("terminalToolbar.imageActionFailed"),
        );
        setRetryImageAction(() => retry);
      },
    );
  };
  const uploadFile = (file: File) => {
    setImageError(null);
    reportImageResult(
      () => onUploadImage(file),
      () => uploadFile(file),
    );
  };
  const pasteImage = () => {
    setImageError(null);
    // Invoke clipboard access in this click's user-activation call chain.
    reportImageResult(onPasteImage, pasteImage);
  };
  const chooseFile = () => fileInputRef.current?.click();
  const handleGrabPointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0 || event.pointerType === "touch") return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    capturedPointerIdRef.current = event.pointerId;
    dragMovedRef.current = false;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      basePosition: positionRef.current,
    };
  };
  const handleGrabPointerMove = (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    const toolbar = toolbarRef.current;
    const host = hostRef.current;
    if (!toolbar || !host) return;
    const next = clampToolbarPosition(
      {
        x: drag.basePosition.x + deltaX,
        y: drag.basePosition.y + deltaY,
      },
      toolbar.getBoundingClientRect(),
      host.getBoundingClientRect(),
      positionRef.current,
    );
    if (event.clientX !== drag.startX || event.clientY !== drag.startY) {
      dragMovedRef.current = true;
    }
    positionRef.current = next;
    setPosition(next);
  };
  const handleGrabPointerEnd = (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    persistToolbarPosition(positionRef.current);
    dragRef.current = null;
    if (capturedPointerIdRef.current === event.pointerId) {
      capturedPointerIdRef.current = null;
      if (event.type !== "lostpointercapture") {
        try {
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        } catch {
          // The browser may have already released capture for this pointer.
        }
      }
    }
  };
  const densityLabels: Record<ToolbarDensity, string> = {
    icon: t("terminalToolbar.layoutIcon"),
    labeled: t("terminalToolbar.layoutLabeled"),
    expanded: t("terminalToolbar.layoutExpanded"),
  };

  const densitySelect = (
    <Select
      value={density}
      open={densityOpen}
      onOpenChange={setDensityOpen}
      onValueChange={(value) => setAndStoreDensity(value as ToolbarDensity)}
    >
      <SelectTrigger
        id={densityId}
        size="sm"
        aria-label={t("terminalToolbar.layout")}
        title={t("terminalToolbar.layout")}
        className={cn(
          CONTROL,
          "h-8 border-0 bg-transparent px-2 shadow-none dark:bg-transparent dark:hover:bg-muted",
        )}
      >
        <LayoutGrid className="size-4 shrink-0" />
      </SelectTrigger>
      <SelectContent>
        {DENSITY_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {densityLabels[option.value]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const imageButtons = (
    <>
      <button
        type="button"
        className={CONTROL}
        aria-label={t("terminalToolbar.uploadImage")}
        title={t("terminalToolbar.uploadImage")}
        disabled={isImageUploading}
        onClick={chooseFile}
      >
        <ImagePlus className="size-4 shrink-0" />
        {effectiveDensity !== "icon" && t("terminalToolbar.upload")}
      </button>
      <button
        type="button"
        className={CONTROL}
        aria-label={t("terminalToolbar.pasteImage")}
        title={t("terminalToolbar.pasteImage")}
        disabled={isImageUploading}
        onClick={pasteImage}
      >
        <ClipboardPaste className="size-4 shrink-0" />
        {effectiveDensity !== "icon" && t("terminalToolbar.paste")}
      </button>
    </>
  );
  const expandButton = (
    <button
      type="button"
      className={CONTROL}
      aria-label={t("terminalToolbar.showToolbar")}
      title={t("terminalToolbar.showToolbar")}
      onClick={() => {
        pendingRightEdgeRef.current =
          toolbarRef.current?.getBoundingClientRect().right ?? null;
        pendingExpansionFocusRef.current = true;
        setCollapsed(false);
      }}
    >
      <Maximize2 className="size-4" />
      <span className="sr-only">{t("terminalToolbar.showToolbar")}</span>
    </button>
  );
  const grabButton = () => (
    <button
      type="button"
      className={cn(CONTROL, "cursor-grab active:cursor-grabbing")}
      aria-label={t("terminalToolbar.moveToolbar")}
      title={t("terminalToolbar.moveToolbarHint")}
      onPointerDown={handleGrabPointerDown}
      onPointerMove={handleGrabPointerMove}
      onPointerUp={handleGrabPointerEnd}
      onPointerCancel={handleGrabPointerEnd}
      onLostPointerCapture={handleGrabPointerEnd}
    >
      <GripVertical className="size-4" />
    </button>
  );

  return (
    <>
      <div
        ref={hostRef}
        data-terminal-toolbar-host
        className={cn(
          "pointer-events-none @container absolute inset-0 z-[110] flex items-end justify-center pb-2",
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          disabled={isImageUploading}
          aria-hidden="true"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) uploadFile(file);
          }}
        />
        <span role="status" aria-live="polite" className="sr-only">
          {isImageUploading ? t("terminalToolbar.uploadingImage") : ""}
        </span>
        {imageError && (
          <div
            role="alert"
            className="pointer-events-auto absolute bottom-full mb-2 flex min-h-11 max-w-sm items-center gap-2 rounded-sm border border-destructive bg-background p-2 text-xs text-destructive shadow-lg"
          >
            <span>{imageError}</span>
            {retryImageAction && (
              <button
                type="button"
                className={cn(CONTROL, "text-foreground")}
                title={t("terminalToolbar.retry")}
                disabled={isImageUploading}
                onClick={retryImageAction}
              >
                {t("terminalToolbar.retry")}
              </button>
            )}
            <button
              type="button"
              className={cn(CONTROL, "px-2")}
              aria-label={t("terminalToolbar.dismissError")}
              title={t("terminalToolbar.dismissError")}
              onClick={() => {
                setImageError(null);
                setRetryImageAction(null);
              }}
            >
              <X className="size-4" />
            </button>
          </div>
        )}

        <div
          ref={measurementRef}
          aria-hidden="true"
          className="pointer-events-none invisible absolute left-0 top-0 flex whitespace-nowrap"
        >
          {isTmuxAttached && (
            <span className={CONTROL}>
              <LogOut className="size-4" />
              {density !== "icon" && t("terminalToolbar.detachTmux")}
            </span>
          )}
          <span className={CONTROL}>
            <ImagePlus className="size-4" />
            {density !== "icon" && t("terminalToolbar.upload")}
          </span>
          <span className={CONTROL}>
            <ClipboardPaste className="size-4" />
            {density !== "icon" && t("terminalToolbar.paste")}
          </span>
          {actionsEnabled &&
            slotContributions.map((contribution) => (
              <span key={contribution.actionId} className={CONTROL}>
                {contribution.icon && <contribution.icon className="size-4" />}
                {density !== "icon" && t(contribution.titleKey)}
              </span>
            ))}
          {actionsEnabled &&
            hostLinks.map((action) => (
              <span key={action.id} className={CONTROL}>
                <action.icon className="size-4" />
                {density !== "icon" && t(action.titleKey)}
              </span>
            ))}
          <span className={cn(CONTROL, "h-8 px-2")}>
            <LayoutGrid className="size-4" />
            <ChevronDown className="size-4" />
          </span>
          <span className={CONTROL}>
            <Minimize2 className="size-4" />
          </span>
          <span className={CONTROL}>
            <GripVertical className="size-4" />
          </span>
        </div>
        <div
          ref={toolbarRef}
          data-terminal-toolbar-wide
          className={cn(
            "pointer-events-auto transition-opacity duration-300 hover:duration-0 focus-within:duration-0 hover:opacity-100 focus-within:opacity-100",
            collapsed || densityOpen ? "opacity-100" : "opacity-30",
          )}
          style={{
            transform: `translate(${position.x}px, ${position.y}px)`,
          }}
        >
          {collapsed ? (
            <div className="terminal-toolbar-collapsed-shell flex rounded-sm border border-border bg-background/90 p-0.5 shadow-lg backdrop-blur-sm">
              {expandButton}
              {grabButton()}
            </div>
          ) : (
            <div className="flex flex-col overflow-hidden rounded-sm border border-border bg-background/90 shadow-lg backdrop-blur-sm">
              {showStats && (
                <div className="flex flex-wrap items-center justify-center gap-x-1 border-b border-border px-1.5 py-0.5">
                  <ComponentSlot
                    slotId={TERMINAL_TOOLBAR_STATUS_SLOT}
                    when={{ host }}
                    props={{
                      host,
                      isConnected,
                      active:
                        isConnected &&
                        desktopViewportReady === true &&
                        isMobile === false,
                    }}
                  />
                </div>
              )}
              <div className={cn("flex gap-0.5 p-0.5", "items-center")}>
                {isTmuxAttached && (
                  <button
                    type="button"
                    className={CONTROL}
                    aria-label={t("terminalToolbar.detachTmuxDescription")}
                    title={t("terminalToolbar.detachTmuxDescription")}
                    onClick={onTmuxDetach}
                  >
                    <LogOut className="size-4" />
                    {effectiveDensity !== "icon" &&
                      t("terminalToolbar.detachTmux")}
                  </button>
                )}
                {isTmuxAttached && <div className={SEPARATOR} />}
                <div
                  role="group"
                  aria-label={t("terminalToolbar.image")}
                  className="flex items-center gap-0.5"
                >
                  {imageButtons}
                </div>
                {actionsEnabled && slotContributions.length > 0 && (
                  <>
                    <div className={SEPARATOR} />
                    <ActionSlot
                      slotId={TOOLBAR_SLOT_ID}
                      className={CONTROL}
                      enabled={actionsEnabled}
                      hideLabels={effectiveDensity === "icon"}
                      when={{ host }}
                      context={() => [slotApi]}
                    />
                  </>
                )}
                {actionsEnabled && hostLinks.length > 0 && (
                  <>
                    <div className={SEPARATOR} />
                    {hostLinks.map((action) => (
                      <button
                        key={action.id}
                        type="button"
                        className={CONTROL}
                        aria-label={t(action.titleKey)}
                        title={t(action.titleKey)}
                        onClick={() => openHostLink(action)}
                      >
                        <action.icon className="size-4" />
                        {effectiveDensity !== "icon" && t(action.titleKey)}
                      </button>
                    ))}
                  </>
                )}
                <div className={SEPARATOR} />
                {densitySelect}
                <button
                  ref={hideToolbarRef}
                  type="button"
                  className={CONTROL}
                  aria-label={t("terminalToolbar.hideToolbar")}
                  title={t("terminalToolbar.hideToolbar")}
                  onClick={() => {
                    pendingRightEdgeRef.current =
                      toolbarRef.current?.getBoundingClientRect().right ?? null;
                    setCollapsed(true);
                  }}
                >
                  <Minimize2 className="size-4" />
                  <span className="sr-only">
                    {t("terminalToolbar.hideToolbar")}
                  </span>
                </button>
                <div className={SEPARATOR} />
                {grabButton()}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
