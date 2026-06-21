import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Plug, Search, X, Pencil, Check } from "lucide-react";
import {
  getActiveSessions,
  deleteOpenTab,
  type ActiveSessionInfo,
  type OpenTabRecord,
} from "@/main-axios";
import { tabIcon } from "@/shell/tabUtils";
import type { Tab, TabType } from "@/types/ui-types";
import { Badge } from "@/components/badge";
import { Input } from "@/components/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/tooltip";

const CONNECTION_TAB_TYPES: TabType[] = [
  "terminal",
  "rdp",
  "vnc",
  "telnet",
  "files",
  "docker",
  "host-metrics",
  "tunnel",
];

const TYPE_LABELS: Record<string, string> = {
  terminal: "SSH",
  rdp: "RDP",
  vnc: "VNC",
  telnet: "Telnet",
  files: "Files",
  docker: "Docker",
  "host-metrics": "Host Metrics",
  tunnel: "Tunnel",
};

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatExpiry(updatedAt: string): string {
  const TTL_MS = 30 * 60 * 1000;
  const elapsed = Date.now() - new Date(updatedAt).getTime();
  const remaining = TTL_MS - elapsed;
  if (remaining <= 0) return "expiring";
  return formatDuration(remaining);
}

function ConnectionRow({
  isActive,
  isLive,
  tabType,
  name,
  hostName,
  subLabel,
  icon,
  onSwitch,
  onClose,
  switchTitle,
  faded,
  onRename,
  isDragging,
}: {
  isActive?: boolean;
  isLive: boolean;
  tabType: string;
  name: string;
  hostName?: string;
  subLabel: string;
  icon: React.ReactNode;
  onSwitch?: () => void;
  onClose: () => void;
  switchTitle?: string;
  faded?: boolean;
  onRename?: (newLabel: string) => void;
  isDragging?: boolean;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(name);

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation();
    setEditValue(name);
    setEditing(true);
  }

  function commitEdit() {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== name && onRename) {
      onRename(trimmed);
    }
    setEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") commitEdit();
    if (e.key === "Escape") setEditing(false);
  }

  return (
    <div
      role={onSwitch && !editing ? "button" : undefined}
      tabIndex={onSwitch && !editing ? 0 : undefined}
      onClick={!editing ? onSwitch : undefined}
      onKeyDown={(e) => !editing && e.key === "Enter" && onSwitch?.()}
      className={`group flex items-center gap-2.5 px-3 py-2.5 border-b border-border/40 transition-colors last:border-b-0 ${
        faded ? "opacity-60" : ""
      } ${isDragging ? "opacity-30" : ""} ${
        isActive
          ? "bg-accent-brand/8 cursor-pointer border-l-2 border-l-accent-brand"
          : onSwitch && !editing
            ? "hover:bg-muted/40 cursor-pointer"
            : ""
      }`}
    >
      <div
        className={`shrink-0 flex items-center justify-center size-7 rounded ${
          isActive
            ? "bg-accent-brand/15 text-accent-brand"
            : "bg-muted/60 text-muted-foreground"
        }`}
      >
        {icon}
      </div>

      <div className="flex flex-col flex-1 min-w-0 gap-0.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`shrink-0 size-1.5 rounded-full ${
              isLive ? "bg-green-500" : "bg-muted-foreground/30"
            }`}
          />
          {editing ? (
            <input
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              className="text-xs font-semibold flex-1 min-w-0 bg-transparent border-b border-accent-brand outline-none text-foreground"
              autoFocus
            />
          ) : (
            <span
              className={`text-xs font-semibold truncate flex-1 ${
                isActive ? "text-accent-brand" : "text-foreground"
              }`}
            >
              {name}
            </span>
          )}
          <Badge
            variant="outline"
            className="text-[9px] px-1 py-0 h-4 font-mono shrink-0 text-muted-foreground/60 border-border/60"
          >
            {TYPE_LABELS[tabType] ?? tabType}
          </Badge>
        </div>
        <span className="text-[10px] text-muted-foreground/60 truncate pl-3">
          {hostName && hostName !== name ? (
            <span className="text-muted-foreground/50">
              {hostName} &middot;{" "}
            </span>
          ) : null}
          {subLabel}
        </span>
      </div>

      <TooltipProvider>
        <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {editing ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                commitEdit();
              }}
              className="size-6 flex items-center justify-center text-accent-brand hover:bg-muted/60 rounded transition-colors"
            >
              <Check className="size-3" />
            </button>
          ) : (
            onRename && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={startEdit}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="size-6 flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-muted/60 rounded transition-colors"
                  >
                    <Pencil className="size-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left">
                  {t("connections.rename")}
                </TooltipContent>
              </Tooltip>
            )
          )}
          {switchTitle && onSwitch && !editing && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSwitch();
                  }}
                  className="size-6 flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-muted/60 rounded transition-colors"
                >
                  <ExternalLink className="size-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">{switchTitle}</TooltipContent>
            </Tooltip>
          )}
          {!editing && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="size-6 flex items-center justify-center text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </TooltipProvider>
    </div>
  );
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60 bg-muted/20">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 flex-1">
        {label}
      </span>
      <span className="text-[10px] font-semibold text-muted-foreground/40 bg-muted/60 rounded px-1.5 py-0.5">
        {count}
      </span>
    </div>
  );
}

export function ConnectionsPanel({
  tabs,
  activeTabId,
  allHosts,
  backgroundTabRecords,
  onSwitchToTab,
  onCloseTab,
  onReopenTab,
  onForgetBackground,
  onRenameTab,
  onReorderTabs,
}: {
  tabs: Tab[];
  activeTabId: string;
  allHosts: { id: string; name: string }[];
  backgroundTabRecords: OpenTabRecord[];
  onSwitchToTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onReopenTab: (
    record: OpenTabRecord,
    restoredSessionId: string | null,
  ) => void;
  onForgetBackground: (recordId: string) => void;
  onRenameTab?: (tabId: string, newLabel: string) => void;
  onReorderTabs?: (tabs: Tab[]) => void;
}) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now());
  const [activeSessions, setActiveSessions] = useState<ActiveSessionInfo[]>([]);
  const [search, setSearch] = useState("");
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Drag-to-reorder state
  const [dragTabId, setDragTabId] = useState<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
  const rowEls = useRef<Map<string, HTMLDivElement>>(new Map());
  const dragStartY = useRef<number>(0);
  const didDragRef = useRef(false);

  const openTabs = tabs.filter((tab) =>
    CONNECTION_TAB_TYPES.includes(tab.type),
  );

  const openInstanceIds = new Set(
    tabs.map((t) => t.instanceId).filter(Boolean),
  );
  const backgroundTabs = backgroundTabRecords.filter(
    (r) => !openInstanceIds.has(r.id),
  );

  const q = search.trim().toLowerCase();
  const filteredOpenTabs = q
    ? openTabs.filter((tab) => {
        const displayName = tab.customLabel ?? tab.host?.name ?? tab.label;
        return (
          displayName.toLowerCase().includes(q) ||
          (tab.host?.name ?? "").toLowerCase().includes(q)
        );
      })
    : openTabs;
  const filteredBackgroundTabs = q
    ? backgroundTabs.filter((r) => {
        const host = allHosts.find((h) => h.id === String(r.hostId));
        return (host?.name ?? r.label).toLowerCase().includes(q);
      })
    : backgroundTabs;

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const sessions = await getActiveSessions();
      setActiveSessions((prev) => {
        const next = Array.isArray(sessions) ? sessions : [];
        if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
        return next;
      });
    } catch {
      // silently ignore
    }
  }, []);

  useEffect(() => {
    refresh();
    pollTimerRef.current = setInterval(refresh, 5000);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [refresh]);

  // Global pointer listeners for drag reorder
  useEffect(() => {
    if (!dragTabId) return;

    function onPointerMove(e: PointerEvent) {
      if (Math.abs(e.clientY - dragStartY.current) > 4)
        didDragRef.current = true;
      if (!didDragRef.current) return;

      // Find which row the pointer is over
      let overTabId: string | null = null;
      rowEls.current.forEach((el, id) => {
        if (id === dragTabId) return;
        const rect = el.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
          overTabId = id;
        }
      });
      setDragOverTabId(overTabId);
    }

    function onPointerUp(e: PointerEvent) {
      if (didDragRef.current && dragTabId && onReorderTabs) {
        // Find drop target
        let targetTabId: string | null = null;
        rowEls.current.forEach((el, id) => {
          if (id === dragTabId) return;
          const rect = el.getBoundingClientRect();
          if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
            targetTabId = id;
          }
        });

        if (targetTabId) {
          const fromIdx = openTabs.findIndex((t) => t.id === dragTabId);
          const toIdx = openTabs.findIndex((t) => t.id === targetTabId);
          if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
            const reordered = [...openTabs];
            reordered.splice(toIdx, 0, reordered.splice(fromIdx, 1)[0]);
            const connectionSet = new Set(CONNECTION_TAB_TYPES as string[]);
            const nonConnectionTabs = tabs.filter(
              (t) => !connectionSet.has(t.type),
            );
            onReorderTabs([...nonConnectionTabs, ...reordered]);
          }
        }
      }

      setDragTabId(null);
      setDragOverTabId(null);
      setTimeout(() => {
        didDragRef.current = false;
      }, 0);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [dragTabId, openTabs, tabs, onReorderTabs]);

  const sessionByInstanceId = new Map(
    activeSessions.map((s) => [s.tabInstanceId, s]),
  );

  const hasAnything = openTabs.length > 0 || backgroundTabs.length > 0;
  const hasResults =
    filteredOpenTabs.length > 0 || filteredBackgroundTabs.length > 0;

  if (!hasAnything) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-3 p-6 text-center py-16">
        <div className="size-10 rounded-full bg-muted/40 flex items-center justify-center">
          <Plug className="size-5 text-muted-foreground/30" />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-muted-foreground/60">
            {t("connections.noConnections")}
          </span>
          <span className="text-xs text-muted-foreground/40">
            {t("connections.noConnectionsDesc")}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="relative px-3 py-2 border-b border-border/60">
        <Search className="absolute left-5.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50 pointer-events-none" />
        <Input
          placeholder={t("connections.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 h-7 text-xs"
        />
      </div>

      {!hasResults && (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <span className="text-xs text-muted-foreground/50">
            {t("connections.noSearchResults")}
          </span>
        </div>
      )}

      {filteredOpenTabs.length > 0 && (
        <div className="flex flex-col">
          <SectionHeader
            label={t("connections.sectionOpen")}
            count={filteredOpenTabs.length}
          />
          {filteredOpenTabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const liveSession = tab.instanceId
              ? sessionByInstanceId.get(tab.instanceId)
              : undefined;
            const isLive =
              tab.type === "terminal"
                ? (liveSession?.isConnected ?? false)
                : true;
            const duration = liveSession?.createdAt
              ? formatDuration(now - liveSession.createdAt)
              : formatDuration(now - tab.openedAt);

            const displayName = tab.customLabel ?? tab.host?.name ?? tab.label;
            const hostName = tab.host?.name;
            const isDraggingThis = dragTabId === tab.id;
            const isDropTarget = dragOverTabId === tab.id && !isDraggingThis;

            return (
              <div
                key={tab.id}
                ref={(el) => {
                  if (el) rowEls.current.set(tab.id, el);
                  else rowEls.current.delete(tab.id);
                }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  dragStartY.current = e.clientY;
                  didDragRef.current = false;
                  setDragTabId(tab.id);
                }}
                className={`relative ${isDropTarget ? "border-t-2 border-accent-brand" : ""}`}
                style={{
                  cursor: dragTabId
                    ? isDraggingThis
                      ? "grabbing"
                      : "default"
                    : "grab",
                }}
              >
                <ConnectionRow
                  isActive={isActive}
                  isLive={isLive}
                  tabType={tab.type}
                  name={displayName}
                  hostName={tab.customLabel ? hostName : undefined}
                  subLabel={
                    isLive && tab.type === "terminal"
                      ? t("connections.connectedFor", { duration })
                      : isLive
                        ? t("connections.connected")
                        : t("connections.disconnected")
                  }
                  icon={tabIcon(tab.type)}
                  onSwitch={() => {
                    if (!didDragRef.current) onSwitchToTab(tab.id);
                  }}
                  onClose={() => onCloseTab(tab.id)}
                  onRename={
                    onRenameTab
                      ? (newLabel) => onRenameTab(tab.id, newLabel)
                      : undefined
                  }
                  isDragging={isDraggingThis}
                />
              </div>
            );
          })}
        </div>
      )}

      {filteredBackgroundTabs.length > 0 && (
        <div
          className={`flex flex-col ${filteredOpenTabs.length > 0 ? "mt-2" : ""}`}
        >
          <SectionHeader
            label={t("connections.sectionBackground")}
            count={filteredBackgroundTabs.length}
          />
          <div className="px-3 py-1.5 border-b border-border/40">
            <span className="text-[10px] text-muted-foreground/50">
              {t("connections.backgroundDesc")}
            </span>
          </div>
          {filteredBackgroundTabs.map((record) => {
            const host = record.hostId
              ? allHosts.find((h) => h.id === String(record.hostId))
              : undefined;
            const expiresIn = formatExpiry(record.updatedAt);

            return (
              <ConnectionRow
                key={record.id}
                isLive={false}
                faded
                tabType={record.tabType}
                name={host?.name ?? record.label}
                subLabel={t("connections.expiresIn", { duration: expiresIn })}
                icon={tabIcon(record.tabType as TabType)}
                onSwitch={() => {
                  const liveSession = sessionByInstanceId.get(record.id);
                  onReopenTab(record, liveSession?.sessionId ?? null);
                }}
                onClose={async () => {
                  await deleteOpenTab(record.id).catch(() => {});
                  onForgetBackground(record.id);
                }}
                switchTitle={t("connections.reconnect")}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
