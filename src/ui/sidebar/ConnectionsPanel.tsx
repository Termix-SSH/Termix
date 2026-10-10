import { useConfirm } from "@/components/surface/surface-scope";
import { getTabType, isPersistentTabType } from "@/shell/tab-registry";
import { ComponentSlot } from "@/shell/ActionSlot";
import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Plug, X, Pencil, Check } from "lucide-react";
import {
  getActiveSessions,
  deleteOpenTab,
  type ActiveSessionInfo,
  type OpenTabRecord,
} from "@/main-axios";
import { tabIcon } from "@/shell/tabUtils";
import { getSessionTimeoutMinutes } from "@/api/open-tabs-api";
import type { Tab, TabType } from "@/types/ui-types";
import { EmptyState } from "@/components/empty-state";
import { Facts, GroupHeading, PanelSearch } from "@/components/panel-layout";
import { ListBadge, ListRow, ListRowAction } from "@/components/list-kit";
import { usePageVisibleInterval } from "@/hooks/use-page-visible-interval";
import { useAdaptivePolling } from "@/hooks/use-adaptive-polling";

/** Core badge labels; plugin tabs are labelled by their registered title. */
const CORE_TYPE_LABELS: Record<string, string> = {
  files: "Files",
};

/** Saved connection tabs: the ones reopened after login. */
function isConnectionTabType(type: TabType): boolean {
  return isPersistentTabType(type);
}

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function sessionsUnchanged(
  prev: ActiveSessionInfo[],
  next: ActiveSessionInfo[],
): boolean {
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i++) {
    const a = prev[i];
    const b = next[i];
    if (
      a.sessionId !== b.sessionId ||
      a.hostId !== b.hostId ||
      a.hostName !== b.hostName ||
      a.tabInstanceId !== b.tabInstanceId ||
      a.isConnected !== b.isConnected ||
      a.createdAt !== b.createdAt
    ) {
      return false;
    }
  }
  return true;
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
  stripe,
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
  stripe: number;
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

  function commitEdit() {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== name && onRename) {
      onRename(trimmed);
    }
    setEditing(false);
  }

  const registered = getTabType(tabType)?.titleKey;
  const typeLabel =
    CORE_TYPE_LABELS[tabType] ?? (registered ? t(registered) : tabType);
  const stop = (e: React.PointerEvent) => e.stopPropagation();

  return (
    <ListRow
      stripe={stripe}
      tone={isLive ? "success" : "muted"}
      selected={isActive}
      active={editing}
      dimmed={faded || isDragging}
      onClick={!editing ? onSwitch : undefined}
      icon={icon}
      title={
        editing ? (
          <input
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") setEditing(false);
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={stop}
            className="w-full min-w-0 border-b border-accent-brand bg-transparent text-[13px] font-semibold text-foreground outline-none"
            autoFocus
          />
        ) : (
          name
        )
      }
      badges={<ListBadge className="ml-auto font-mono">{typeLabel}</ListBadge>}
      meta={
        <Facts>
          {hostName && hostName !== name ? <span>{hostName}</span> : null}
          <span>{subLabel}</span>
        </Facts>
      }
      actions={
        editing ? (
          <ListRowAction
            label={t("common.save")}
            tone="brand"
            onPointerDown={stop}
            onClick={commitEdit}
          >
            <Check />
          </ListRowAction>
        ) : (
          <>
            {onRename && (
              <ListRowAction
                label={t("connections.rename")}
                onPointerDown={stop}
                onClick={() => {
                  setEditValue(name);
                  setEditing(true);
                }}
              >
                <Pencil />
              </ListRowAction>
            )}
            {switchTitle && onSwitch && (
              <ListRowAction
                label={switchTitle}
                tone="brand"
                onPointerDown={stop}
                onClick={onSwitch}
              >
                <ExternalLink />
              </ListRowAction>
            )}
            <ListRowAction
              label={t("common.close")}
              tone="destructive"
              onPointerDown={stop}
              onClick={onClose}
            >
              <X />
            </ListRowAction>
          </>
        )
      }
    />
  );
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <GroupHeading
      title={label}
      count={count}
      className="border-b border-border/40 px-3 pb-1.5 pt-2.5"
    />
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
  const confirm = useConfirm();
  const [now, setNow] = useState(Date.now());

  const [persistMinutes, setPersistMinutes] = useState(30);
  useEffect(() => {
    getSessionTimeoutMinutes()
      .then((minutes) => setPersistMinutes(minutes))
      .catch(() => {});
  }, []);
  const [activeSessions, setActiveSessions] = useState<ActiveSessionInfo[]>([]);
  const activeSessionsRef = useRef(activeSessions);
  activeSessionsRef.current = activeSessions;
  const [search, setSearch] = useState("");

  // Drag-to-reorder state
  const [dragTabId, setDragTabId] = useState<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
  const rowEls = useRef<Map<string, HTMLDivElement>>(new Map());
  const dragStartY = useRef<number>(0);
  const didDragRef = useRef(false);

  const openTabs = tabs.filter((tab) => isConnectionTabType(tab.type));

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

  // Duration labels only need minute-level freshness; 1s ticks re-render the whole panel.
  usePageVisibleInterval(() => setNow(Date.now()), 15_000);

  const refresh = useCallback(async () => {
    const sessions = await getActiveSessions();
    const next = Array.isArray(sessions) ? sessions : [];
    const changed = !sessionsUnchanged(activeSessionsRef.current, next);
    if (changed) {
      activeSessionsRef.current = next;
      setActiveSessions(next);
    }
    return changed;
  }, []);

  useAdaptivePolling(refresh, {
    minIntervalMs: 5_000,
    maxIntervalMs: 30_000,
    stablePollsPerStep: 3,
  });

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
            const nonConnectionTabs = tabs.filter(
              (t) => !isConnectionTabType(t.type),
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

  const pluginSections = (
    <ComponentSlot
      slotId="connections.sections"
      props={{
        search: q,
        openTabData: tabs.map((tab) => tab.data ?? {}),
      }}
    />
  );

  if (!hasAnything) {
    return (
      <div className="flex flex-col flex-1">
        {pluginSections}
        <EmptyState
          icon={Plug}
          title={t("connections.noConnections")}
          hint={t("connections.noConnectionsDesc")}
          className="flex-1"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <PanelSearch
          value={search}
          onChange={setSearch}
          placeholder={t("connections.search")}
          fill
        />
      </div>

      {!hasResults && <EmptyState title={t("connections.noSearchResults")} />}

      {filteredOpenTabs.length > 0 && (
        <div className="flex flex-col">
          <SectionHeader
            label={t("connections.sectionOpen")}
            count={filteredOpenTabs.length}
          />
          {filteredOpenTabs.map((tab, index) => {
            const isActive = tab.id === activeTabId;
            const liveSession = tab.instanceId
              ? sessionByInstanceId.get(tab.instanceId)
              : undefined;
            const tracksSession = !!getTabType(tab.type)?.commandTarget;
            const isLive = tracksSession
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
                className={`relative ${isDropTarget ? "before:absolute before:inset-x-0 before:-top-px before:z-20 before:h-0.5 before:bg-accent-brand" : ""}`}
                style={{
                  cursor: dragTabId
                    ? isDraggingThis
                      ? "grabbing"
                      : "default"
                    : "grab",
                }}
              >
                <ConnectionRow
                  stripe={index}
                  isActive={isActive}
                  isLive={isLive}
                  tabType={tab.type}
                  name={displayName}
                  hostName={tab.customLabel ? hostName : undefined}
                  subLabel={
                    isLive && tracksSession
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
        <div className="flex flex-col">
          <SectionHeader
            label={t("connections.sectionBackground")}
            count={filteredBackgroundTabs.length}
          />
          <div className="px-3 py-1.5 border-b border-border/40">
            <span className="text-[10px] text-muted-foreground/50">
              {t("connections.backgroundDesc", {
                minutes: persistMinutes,
              })}
            </span>
          </div>
          {filteredBackgroundTabs.map((record, index) => {
            const host = record.hostId
              ? allHosts.find((h) => h.id === String(record.hostId))
              : undefined;
            const expiresIn = formatExpiry(record.updatedAt);

            return (
              <ConnectionRow
                key={record.id}
                stripe={index}
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
                  const ok = await confirm({
                    title: t("connections.forgetConfirm", {
                      name: host?.name ?? record.label,
                    }),
                    confirmLabel: t("connections.forget"),
                  });
                  if (!ok) return;
                  await deleteOpenTab(record.id).catch(() => {});
                  onForgetBackground(record.id);
                }}
                switchTitle={t("connections.reconnect")}
              />
            );
          })}
        </div>
      )}

      {/* Sections a plugin adds, such as sessions others shared with you. */}
      {pluginSections}
    </div>
  );
}
