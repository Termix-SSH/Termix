import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  ImagePlus,
  LayoutGrid,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/tooltip.tsx";
import { cn } from "@/lib/utils";
import { getSshActions } from "@/sidebar/tree/HostItem/HostItem";
import {
  getServerMetricsById,
  startMetricsPolling,
  stopMetricsPolling,
} from "@/api/host-metrics-status-api";
import type { Host, TabType } from "@/types/ui-types";
import {
  getPollingEnvironmentMultiplier,
  runAdaptivePolling,
} from "@/lib/adaptive-polling";

type ToolbarDensity = "icon" | "labeled" | "expanded";

const DENSITY_STORAGE_KEY = "termix-terminal-toolbar-density";
const DENSITY_ORDER: ToolbarDensity[] = ["icon", "labeled", "expanded"];

function readStoredDensity(): ToolbarDensity {
  if (typeof window === "undefined") return "labeled";
  const stored = window.localStorage.getItem(DENSITY_STORAGE_KEY);
  return stored === "icon" || stored === "labeled" || stored === "expanded"
    ? stored
    : "labeled";
}

const BTN_BASE =
  "flex items-center justify-center gap-1.5 h-7 px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded-sm whitespace-nowrap select-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted-foreground";

const BTN_ICON =
  "flex items-center justify-center size-7 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded-sm select-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted-foreground";

const SEP = "w-px h-5 bg-border mx-0.5 shrink-0";

function TipBtn({
  tooltip,
  onClick,
  disabled,
  className,
  children,
}: {
  tooltip: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className={cn(BTN_BASE, className)}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function TipIconBtn({
  tooltip,
  onClick,
  disabled,
  className,
  children,
}: {
  tooltip: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className={cn(BTN_ICON, className)}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function StatBar({
  label,
  percent,
}: {
  label: string;
  percent: number | null;
}) {
  const value = percent == null ? null : Math.max(0, Math.min(100, percent));
  return (
    <div className="flex items-center gap-1.5 px-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-12 shrink-0 whitespace-nowrap">
        {label}
      </span>
      <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden shrink-0">
        {value != null && (
          <div
            className={cn(
              "h-full rounded-full transition-all",
              value >= 90
                ? "bg-red-500"
                : value >= 70
                  ? "bg-yellow-500"
                  : "bg-accent-brand",
            )}
            style={{ width: `${value}%` }}
          />
        )}
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground w-7 text-right shrink-0">
        {value != null ? `${Math.round(value)}%` : "--"}
      </span>
    </div>
  );
}

interface TerminalToolbarProps {
  host: Host;
  isConnected: boolean;
  isTmuxAttached: boolean;
  onTmuxDetach: () => void;
  isImageUploading: boolean;
  onUploadImage: (file: File) => void;
  onPasteImage: () => void;
  onOpenTab?: (type: TabType) => void;
  /** Opens Files at the terminal's current working directory, when known. */
  onOpenFiles?: () => void;
  isFocused: boolean;
}

export const TerminalToolbar: React.FC<TerminalToolbarProps> = ({
  host,
  isConnected,
  isTmuxAttached,
  onTmuxDetach,
  isImageUploading,
  onUploadImage,
  onPasteImage,
  onOpenTab,
  onOpenFiles,
  isFocused,
}) => {
  const { t } = useTranslation();
  const [density, setDensity] = useState<ToolbarDensity>(readStoredDensity);
  const [collapsed, setCollapsed] = useState(false);
  const [metrics, setMetrics] = useState<{
    cpu: number | null;
    memory: number | null;
    disk: number | null;
  } | null>(null);
  const [statsAvailable, setStatsAvailable] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const effectiveDensity: ToolbarDensity = isFocused ? density : "icon";
  const showStats = effectiveDensity === "expanded";

  useEffect(() => {
    window.localStorage.setItem(DENSITY_STORAGE_KEY, density);
  }, [density]);

  // Picking an interface preset seeds this key, so pick the new value up
  // without needing the tab to remount.
  useEffect(() => {
    const handler = () => setDensity(readStoredDensity());
    window.addEventListener("terminalToolbarDensityChanged", handler);
    return () =>
      window.removeEventListener("terminalToolbarDensityChanged", handler);
  }, []);

  const hostId = host?.id ? Number(host.id) : null;

  useEffect(() => {
    if (!showStats || !hostId || collapsed) {
      setMetrics(null);
      return;
    }

    let cancelled = false;
    let stopPolling: (() => void) | undefined;
    let viewerSessionId: string | undefined;
    let previousMetrics: typeof metrics = null;

    const poll = async () => {
      try {
        const data = await getServerMetricsById(hostId);
        if (cancelled || !data) return;
        const next = {
          cpu: data.cpu?.percent ?? null,
          memory: data.memory?.percent ?? null,
          disk: data.disk?.percent ?? null,
        };
        const changed =
          !previousMetrics ||
          (["cpu", "memory", "disk"] as const).some((key) => {
            const previous = previousMetrics?.[key];
            const current = next[key];
            return (
              previous == null ||
              current == null ||
              Math.abs(current - previous) >= 2
            );
          });
        previousMetrics = next;
        setMetrics(next);
        return changed;
      } catch {
        // keep prior value on transient errors
        return false;
      }
    };

    const start = async () => {
      try {
        const result = await startMetricsPolling(hostId);
        if (cancelled) return;
        if (result.requires_totp) {
          setStatsAvailable(false);
          return;
        }
        viewerSessionId = result.viewerSessionId;
        stopPolling = runAdaptivePolling(
          poll,
          {
            minIntervalMs: 5_000,
            maxIntervalMs: 20_000,
            stablePollsPerStep: 2,
            maxRequestDutyCycle: 0.2,
          },
          { intervalMultiplier: getPollingEnvironmentMultiplier },
        );
      } catch {
        if (!cancelled) setStatsAvailable(false);
      }
    };

    void start();

    return () => {
      cancelled = true;
      stopPolling?.();
      void stopMetricsPolling(hostId, viewerSessionId).catch(() => {});
    };
  }, [showStats, hostId, collapsed]);

  if (!isConnected) return null;

  const hostActions = getSshActions(host).filter(
    (action) => action.type !== "terminal",
  );

  const cycleDensity = () => {
    const idx = DENSITY_ORDER.indexOf(density);
    setDensity(DENSITY_ORDER[(idx + 1) % DENSITY_ORDER.length]);
  };

  const densityIcon =
    density === "icon" ? (
      <ChevronUp className="size-3.5" />
    ) : density === "labeled" ? (
      <LayoutGrid className="size-3.5" />
    ) : (
      <ChevronDown className="size-3.5" />
    );

  return (
    <TooltipProvider delayDuration={400}>
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-[110] max-w-[calc(100%-1rem)]">
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setCollapsed(false)}
                className="flex items-center justify-center size-7 bg-background/85 backdrop-blur-sm border border-border shadow-lg rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <LayoutGrid className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              {t("terminalToolbar.expand")}
            </TooltipContent>
          </Tooltip>
        ) : (
          <div className="flex flex-col bg-background/85 backdrop-blur-sm border border-border shadow-lg rounded-sm overflow-hidden">
            {showStats && (
              <div className="flex items-center justify-center flex-wrap gap-x-1 gap-y-0.5 px-1.5 py-1 border-b border-border">
                {statsAvailable ? (
                  <>
                    <StatBar
                      label={t("terminalToolbar.cpu")}
                      percent={metrics?.cpu ?? null}
                    />
                    <StatBar
                      label={t("terminalToolbar.memory")}
                      percent={metrics?.memory ?? null}
                    />
                    <StatBar
                      label={t("terminalToolbar.disk")}
                      percent={metrics?.disk ?? null}
                    />
                  </>
                ) : (
                  <span className="text-[10px] text-muted-foreground px-1 py-0.5">
                    {t("terminalToolbar.statsUnavailable")}
                  </span>
                )}
              </div>
            )}
            <div className="flex items-center flex-wrap px-0.5 py-0.5 gap-0">
              {hostActions.map((action) => {
                const Icon = action.icon;
                return (
                  <TipBtn
                    key={action.type}
                    tooltip={action.label}
                    onClick={() =>
                      action.type === "files" && onOpenFiles
                        ? onOpenFiles()
                        : onOpenTab?.(action.type)
                    }
                    className={
                      effectiveDensity === "icon" ? "px-1.5" : undefined
                    }
                  >
                    <Icon className="size-3.5" />
                    {effectiveDensity !== "icon" && action.label}
                  </TipBtn>
                );
              })}

              {(hostActions.length > 0 || isTmuxAttached) && (
                <div className={SEP} />
              )}

              {isTmuxAttached && (
                <TipBtn
                  tooltip={t("terminalToolbar.tmuxDetach")}
                  onClick={onTmuxDetach}
                  className={effectiveDensity === "icon" ? "px-1.5" : undefined}
                >
                  tmux
                  {effectiveDensity !== "icon" &&
                    `:${t("terminalToolbar.tmuxDetach")}`}
                </TipBtn>
              )}

              <Tooltip>
                <TooltipTrigger asChild>
                  <label
                    className={cn(
                      BTN_BASE,
                      "cursor-pointer",
                      effectiveDensity === "icon" && "px-1.5",
                    )}
                  >
                    <ImagePlus className="size-3.5" />
                    {effectiveDensity !== "icon" &&
                      (isImageUploading
                        ? t("terminalToolbar.uploadingImage")
                        : t("terminalToolbar.uploadImage"))}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={isImageUploading}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) onUploadImage(file);
                      }}
                    />
                  </label>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={6}>
                  {t("terminalToolbar.uploadImage")}
                </TooltipContent>
              </Tooltip>

              <TipIconBtn
                tooltip={t("terminalToolbar.pasteImage")}
                onClick={onPasteImage}
                disabled={isImageUploading}
              >
                <ClipboardPaste className="size-3.5" />
              </TipIconBtn>

              <div className={SEP} />

              <TipIconBtn
                tooltip={t("terminalToolbar.cycleDensity")}
                onClick={cycleDensity}
              >
                {densityIcon}
              </TipIconBtn>
              <TipIconBtn
                tooltip={t("terminalToolbar.collapse")}
                onClick={() => setCollapsed(true)}
              >
                <ChevronDown className="size-3.5" />
              </TipIconBtn>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
};
