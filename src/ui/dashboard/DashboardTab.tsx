import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useActionSlot } from "@/hooks/use-action-slot";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePluginStore } from "@/plugin-host/plugin-store";
import { Button } from "@/components/button";
import { Skeleton } from "@/components/skeleton";
import { Kbd } from "@/components/kbd";
import {
  Facts,
  GroupHeading,
  PanelShell,
  Segmented,
} from "@/components/panel-layout";
import { useConfirm } from "@/components/surface/surface-scope";
import {
  Activity,
  Check,
  Database,
  GripVertical,
  LayoutGrid,
  Pencil,
  Plus,
  RotateCcw,
  Server,
  X,
  Zap,
} from "lucide-react";
import { DASHBOARD_CARDS } from "@/lib/theme";
import type { DashboardCardId, TabType, Host } from "@/types/ui-types";
import {
  getSSHHosts,
  getUptime,
  getVersionInfo,
  releaseUrlFrom,
  getDatabaseHealth,
  getRecentActivity,
  getCredentials,
  resetRecentActivity,
  getUserInfo,
  isElectron,
} from "@/main-axios";
import type { RecentActivityItem } from "@/main-axios";
import { useTranslation } from "react-i18next";
import {
  getRegisteredDashboardCard,
  useRegisteredDashboardCards,
} from "./dashboard-cards-registry";
import { PluginViewPlaceholder } from "@/plugin-host/PluginViewPlaceholder";
import { shell } from "@/plugin-host/shell-bridge";
import {
  useServerStatus,
  useServerStatusMeta,
} from "@/lib/ServerStatusContext";
import { withLiveHostStatus } from "@/sidebar/live-host-status";
import { sshHostToHost } from "@/sidebar/HostManagerData";
import {
  CountersStrip,
  HostStatusList,
  QuickActions,
  RecentActivityList,
  StatsStrip,
  type VersionStatus,
} from "./dashboard-core-cards";
import { reportCoreIssueUrl } from "@/lib/issue-url";
import { docsUrl } from "@/lib/docs";

export { HostStatusList as HostStatusCard } from "./dashboard-core-cards";

// ─── Types ────────────────────────────────────────────────────────────────────

type PanelId = "main" | "side";

type CardSlot = {
  key: string;
  id: DashboardCardId;
  panel: PanelId;
  order: number;
  height: number | null;
};

// ─── Default layout ───────────────────────────────────────────────────────────

const DEFAULT_SLOTS: CardSlot[] = [
  { key: "stats_bar_0", id: "stats_bar", panel: "main", order: 0, height: 76 },
  {
    key: "counters_bar_0",
    id: "counters_bar",
    panel: "main",
    order: 1,
    height: 52,
  },
  {
    key: "host_status_0",
    id: "host_status",
    panel: "main",
    order: 2,
    height: null,
  },
  {
    key: "quick_actions_0",
    id: "quick_actions",
    panel: "side",
    order: 0,
    height: 180,
  },
  {
    key: "recent_activity_0",
    id: "recent_activity",
    panel: "side",
    order: 1,
    height: null,
  },
];

/** Cards core draws itself, how they are framed and what marks them. */
const CORE_CARD_META: Record<
  string,
  { icon: React.ElementType; frame: "framed" | "bare" }
> = {
  stats_bar: { icon: Activity, frame: "bare" },
  counters_bar: { icon: Database, frame: "bare" },
  quick_actions: { icon: Zap, frame: "framed" },
  host_status: { icon: Server, frame: "framed" },
  recent_activity: { icon: Activity, frame: "framed" },
};

/**
 * A plugin's card, or a placeholder that keeps the slot while its plugin is
 * off, so the card comes back in the same place when the plugin does.
 */
export function PluginCardSlot({
  id,
  isVisible,
  onOpenSingletonTab,
}: {
  id: string;
  isVisible: boolean;
  onOpenSingletonTab: (type: TabType, pendingEvent?: string) => void;
}) {
  useRegisteredDashboardCards();
  const cardShell = useMemo(
    () => ({
      ...shell,
      openSingletonTab: (type: string) => onOpenSingletonTab(type as TabType),
    }),
    [onOpenSingletonTab],
  );
  const card = getRegisteredDashboardCard(id);
  if (!card) {
    return (
      <div className="flex h-full w-full overflow-hidden">
        <PluginViewPlaceholder kind="card" viewId={id} compact />
      </div>
    );
  }
  const Component = card.component;
  return <Component isVisible={isVisible} shell={cardShell} />;
}

function isStatusCheckEnabled(host: Host): boolean {
  return host.statusCheckEnabled !== false;
}

// ─── Sections ─────────────────────────────────────────────────────────────────

interface CardMeta {
  label: string;
  icon: React.ElementType;
  frame: "framed" | "bare";
  action?: React.ReactNode;
}

/** One section of a column, separated from the next by a hairline. */
function Section({
  slot,
  meta,
  editMode,
  last,
  dragging,
  onDragStart,
  onDrop,
  onRemove,
  onHeightChange,
  autoHeight,
  children,
}: {
  slot: CardSlot;
  meta: CardMeta;
  editMode: boolean;
  last: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDrop: () => void;
  onRemove: () => void;
  onHeightChange: (key: string, h: number) => void;
  /** Phones stack cards, so each takes the height of its content. */
  autoHeight?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement | null>(null);
  // The last section always fills the column, so resizing one never leaves
  // dead space underneath.
  const flex = last || slot.height === null;
  const Icon = meta.icon;

  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = ref.current?.getBoundingClientRect().height ?? 100;
    const onMove = (ev: MouseEvent) =>
      onHeightChange(slot.key, Math.max(48, startH + (ev.clientY - startY)));
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      ref={ref}
      draggable={editMode}
      onDragStart={onDragStart}
      onDragOver={(e) => editMode && e.preventDefault()}
      onDrop={(e) => {
        if (!editMode) return;
        e.stopPropagation();
        onDrop();
      }}
      style={{
        height: flex || autoHeight ? undefined : (slot.height ?? undefined),
      }}
      className={`relative flex shrink-0 flex-col border-b border-border last:border-b-0 ${
        flex ? "min-h-48 flex-1" : ""
      } ${dragging ? "opacity-40" : ""} ${editMode ? "cursor-grab select-none" : ""}`}
    >
      {(meta.frame === "framed" || editMode) && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
          {editMode && (
            <GripVertical className="size-3 shrink-0 text-muted-foreground/50" />
          )}
          <Icon className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {meta.label}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {!editMode && meta.action}
            {editMode && (
              <button
                type="button"
                onClick={onRemove}
                title={t("dashboardTab.removeSection")}
                aria-label={t("dashboardTab.removeSection")}
                className="text-muted-foreground transition-colors hover:text-destructive"
              >
                <X className="size-3.5" />
              </button>
            )}
          </span>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto thin-scrollbar">
        {children}
      </div>
      {!last && (
        <div
          draggable={false}
          onDragStart={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onMouseDown={onResizeMouseDown}
          title={t("cardGrid.dragToResize")}
          className="absolute inset-x-0 bottom-0 z-10 h-1.5 cursor-ns-resize transition-colors hover:bg-accent-brand/40"
        />
      )}
    </div>
  );
}

/** Everything that could go on the dashboard but is not on it. */
function AddTray({
  available,
  labels,
  onAdd,
}: {
  available: { id: string; plugin: boolean }[];
  labels: Record<string, string>;
  onAdd: (id: string) => void;
}) {
  const { t } = useTranslation();
  const builtin = available.filter((c) => !c.plugin);
  const fromPlugins = available.filter((c) => c.plugin);
  const row = (cards: typeof available) => (
    <div className="flex flex-wrap gap-1.5">
      {cards.map((card) => (
        <button
          key={card.id}
          type="button"
          onClick={() => onAdd(card.id)}
          className="flex h-7 items-center gap-1.5 border border-border px-2 text-[11px] text-muted-foreground transition-colors hover:border-accent-brand hover:text-accent-brand focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Plus className="size-3" />
          {labels[card.id] ?? card.id}
        </button>
      ))}
    </div>
  );
  return (
    <div className="shrink-0 border-t border-border bg-surface/40 p-2.5">
      <GroupHeading
        title={t("dashboardTab.addSection")}
        count={available.length}
      />
      {available.length === 0 ? (
        <p className="pt-2 text-xs text-muted-foreground">
          {t("dashboardTab.allSectionsShown")}
        </p>
      ) : (
        <div className="flex flex-col gap-2 pt-2">
          {builtin.length > 0 && row(builtin)}
          {fromPlugins.length > 0 && (
            <>
              <span className="text-[11px] text-muted-foreground/70">
                {t("dashboardTab.fromPlugins")}
              </span>
              {row(fromPlugins)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── DashboardTab ─────────────────────────────────────────────────────────────

export function DashboardTab({
  onOpenSingletonTab,
  onOpenTab,
  isVisible = true,
}: {
  onOpenSingletonTab: (type: TabType, pendingEvent?: string) => void;
  onOpenTab: (host: Host, type: TabType) => void;
  /** When false, pause dashboard metrics refresh while the tab stays mounted. */
  isVisible?: boolean;
}) {
  const registeredCards = useRegisteredDashboardCards();
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const { initialLoadComplete } = useServerStatusMeta();
  const statusLoading = !initialLoadComplete;

  const [slots, setSlots] = useState<CardSlot[]>(() => {
    try {
      const saved = localStorage.getItem("dashboardTab.slots");
      if (saved) {
        const parsed = JSON.parse(saved) as CardSlot[];
        return parsed.map((s, i) => ({ key: s.key ?? `${s.id}_${i}`, ...s }));
      }
    } catch {
      /* ignore */
    }
    return DEFAULT_SLOTS;
  });

  // Picking an interface preset rewrites the stored layout from settings, so
  // pick it up without waiting for a remount.
  useEffect(() => {
    const handler = () => {
      try {
        const saved = localStorage.getItem("dashboardTab.slots");
        if (!saved) return;
        const parsed = JSON.parse(saved) as CardSlot[];
        setSlots(
          parsed.map((s, i) => ({ key: s.key ?? `${s.id}_${i}`, ...s })),
        );
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("dashboardSlotsChanged", handler);
    return () => window.removeEventListener("dashboardSlotsChanged", handler);
  }, []);

  // A plugin's own view next to the dashboard, e.g. the homepage canvas.
  const secondaryViews = useActionSlot("dashboard.secondaryView");
  const secondaryView = secondaryViews[0];
  const { settled: pluginsSettled } = usePluginStore();

  const [dashboardView, setDashboardView] = useState<string>(() => {
    try {
      return localStorage.getItem("dashboardView") ?? "dashboard";
    } catch {
      return "dashboard";
    }
  });
  // Until plugins settle, a plugin view saved last session has not had a
  // chance to register, so its absence does not mean it is gone.
  const viewPending = !pluginsSettled && dashboardView !== "dashboard";
  const isDashboardView =
    dashboardView === "dashboard" ||
    (!viewPending && !secondaryView) ||
    (!!secondaryView && dashboardView !== secondaryView.actionId);

  useEffect(() => {
    try {
      localStorage.setItem("dashboardView", dashboardView);
    } catch {
      /* ignore */
    }
  }, [dashboardView]);

  const [editMode, setEditMode] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);

  const [mainWidthPct, setMainWidthPct] = useState(() => {
    try {
      const saved = localStorage.getItem("dashboardTab.mainWidthPct");
      if (saved) return Number(saved);
    } catch {
      /* ignore */
    }
    return 68;
  });

  useEffect(() => {
    try {
      localStorage.setItem("dashboardTab.slots", JSON.stringify(slots));
    } catch {
      /* ignore */
    }
  }, [slots]);

  useEffect(() => {
    try {
      localStorage.setItem("dashboardTab.mainWidthPct", String(mainWidthPct));
    } catch {
      /* ignore */
    }
  }, [mainWidthPct]);

  const [configHosts, setHosts] = useState<Host[]>([]);
  const { statuses, getStatus } = useServerStatus();
  const hosts = useMemo(
    () => withLiveHostStatus(configHosts, getStatus),
    // statuses changes identity whenever a host's status changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [configHosts, statuses, getStatus],
  );
  const [isAdmin, setIsAdmin] = useState(false);
  const [uptimeFormatted, setUptimeFormatted] = useState("");
  const [versionText, setVersionText] = useState("");
  const [versionStatus, setVersionStatus] =
    useState<VersionStatus>("up_to_date");
  const [releaseUrl, setReleaseUrl] = useState("");
  const [dbHealth, setDbHealth] = useState<"healthy" | "error">("healthy");
  const [credentialCount, setCredentialCount] = useState(0);
  const [activity, setActivity] = useState<RecentActivityItem[]>([]);
  const statusCheckHosts = hosts.filter(isStatusCheckEnabled);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const raw = await getSSHHosts().catch(() => []);
      if (mounted) setHosts(raw.map(sshHostToHost));
    };
    load();

    getUserInfo()
      .then((info) => {
        // A desktop on its own has one implicit user and nothing to
        // administer; linked, it is an admin when the server account is.
        setIsAdmin(isElectron() ? !!info.linked?.isAdmin : !!info.is_admin);
      })
      .catch(() => {});
    getUptime()
      .then((u) => setUptimeFormatted(u.formatted))
      .catch(() => {});
    getVersionInfo()
      .then((info) => {
        setVersionText(info.localVersion ?? "");
        setVersionStatus(info.status ?? "unknown");
        setReleaseUrl(releaseUrlFrom(info));
      })
      .catch(() => {});
    getDatabaseHealth()
      .then((health) => {
        setDbHealth(
          health.status === "ok" || health.status === "healthy"
            ? "healthy"
            : "error",
        );
      })
      .catch(() => {
        setDbHealth("error");
      });
    getRecentActivity(50)
      .then(setActivity)
      .catch(() => {});
    getCredentials()
      .then((res) =>
        setCredentialCount(
          Array.isArray(res)
            ? res.length
            : Array.isArray(res?.credentials)
              ? res.credentials.length
              : 0,
        ),
      )
      .catch(() => {});

    if (!isVisible) {
      return () => {
        mounted = false;
      };
    }

    const hostsInterval = setInterval(async () => {
      if (document.visibilityState === "hidden") return;
      const raw = await getSSHHosts().catch(() => []);
      if (mounted) setHosts(raw.map(sshHostToHost));
    }, 30000);

    return () => {
      mounted = false;
      clearInterval(hostsInterval);
    };
  }, [isVisible]);

  const handleClearActivity = async () => {
    const ok = await confirm({
      title: t("dashboardTab.clearActivityConfirm"),
      confirmLabel: t("dashboardTab.clear"),
    });
    if (!ok) return;
    try {
      await resetRecentActivity();
      setActivity([]);
    } catch {
      /* ignore */
    }
  };

  const todayLabel = new Date().toLocaleDateString(i18n.language, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const isMobile = useIsMobile();

  const mainSlots = slots
    .filter((s) => s.panel === "main")
    .sort((a, b) => a.order - b.order);
  const sideSlots = slots
    .filter((s) => s.panel === "side")
    .sort((a, b) => a.order - b.order);
  const showSide = sideSlots.length > 0 || editMode;

  const labels: Record<string, string> = {
    stats_bar: t("dashboard.serverOverview"),
    counters_bar: t("dashboard.serverStats"),
    quick_actions: t("dashboard.quickActions"),
    host_status: t("dashboardTab.hostStatus"),
    recent_activity: t("dashboard.recentActivity"),
    ...Object.fromEntries(
      registeredCards.map((card) => [card.id, t(card.titleKey)]),
    ),
  };

  const metaFor = (id: string): CardMeta => {
    const core = CORE_CARD_META[id];
    if (core)
      return {
        label: labels[id] ?? id,
        icon: core.icon,
        frame: core.frame,
        action:
          id === "recent_activity" && activity.length > 0 ? (
            <button
              type="button"
              onClick={() => void handleClearActivity()}
              className="text-[10px] font-medium text-accent-brand hover:underline"
            >
              {t("dashboardTab.clear")}
            </button>
          ) : undefined,
      };
    const registered = getRegisteredDashboardCard(id);
    return {
      label: labels[id] ?? id,
      icon: LayoutGrid,
      frame: registered?.frame ?? "bare",
    };
  };

  const renderCard = (id: string) => {
    switch (id) {
      case "stats_bar":
        return (
          <StatsStrip
            hosts={hosts}
            uptimeFormatted={uptimeFormatted}
            versionText={versionText}
            versionStatus={versionStatus}
            releaseUrl={releaseUrl}
            dbHealth={dbHealth}
          />
        );
      case "counters_bar":
        return (
          <CountersStrip
            hosts={hosts}
            credentialCount={credentialCount}
            onOpenSingletonTab={onOpenSingletonTab}
          />
        );
      case "quick_actions":
        return (
          <QuickActions
            onOpenSingletonTab={onOpenSingletonTab}
            hosts={hosts}
            onOpenTab={onOpenTab}
            isAdmin={isAdmin}
          />
        );
      case "host_status":
        return (
          <HostStatusList
            hosts={statusCheckHosts}
            onOpenTab={onOpenTab}
            statusLoading={statusLoading}
          />
        );
      case "recent_activity":
        return (
          <RecentActivityList
            activity={activity}
            hosts={hosts}
            onOpenTab={onOpenTab}
            statusLoading={statusLoading}
          />
        );
      default:
        return (
          <PluginCardSlot
            id={id}
            isVisible={isVisible}
            onOpenSingletonTab={onOpenSingletonTab}
          />
        );
    }
  };

  const onColumnDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startPct = mainWidthPct;
      const totalW = bodyRef.current?.getBoundingClientRect().width ?? 0;
      if (!totalW) return;
      let frame = 0;
      let clientX = startX;
      const onMove = (ev: MouseEvent) => {
        clientX = ev.clientX;
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          setMainWidthPct(
            Math.min(
              85,
              Math.max(25, startPct + ((clientX - startX) / totalW) * 100),
            ),
          );
        });
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [mainWidthPct],
  );

  const drop = (panel: PanelId, order: number) => {
    if (!dragKey) return;
    setSlots((prev) => {
      const moving = prev.find((s) => s.key === dragKey);
      if (!moving) return prev;
      const rest = prev.filter((s) => s.key !== dragKey);
      const target = rest
        .filter((s) => s.panel === panel)
        .sort((a, b) => a.order - b.order);
      const others = rest.filter((s) => s.panel !== panel);
      const at = target.findIndex((s) => s.order > order);
      const index = at === -1 ? target.length : at;
      const next = [
        ...target.slice(0, index),
        { ...moving, panel },
        ...target.slice(index),
      ].map((s, i) => ({ ...s, order: i }));
      return [...others, ...next];
    });
    setDragKey(null);
  };

  const handleAdd = (id: DashboardCardId) => {
    const registered = getRegisteredDashboardCard(id);
    const panel: PanelId = registered?.defaultPanel ?? "main";
    setSlots((prev) => {
      const panelSlots = prev.filter((s) => s.panel === panel);
      const order =
        panelSlots.length > 0
          ? Math.max(...panelSlots.map((s) => s.order)) + 1
          : 0;
      const height: number | null =
        registered?.defaultHeight ??
        (id === "host_status" || id === "recent_activity" ? null : 150);
      return [
        ...prev,
        { key: `${id}_${Date.now()}`, id, panel, order, height },
      ];
    });
  };

  const handleHeightChange = (key: string, h: number) =>
    setSlots((prev) =>
      prev.map((s) => (s.key === key ? { ...s, height: h } : s)),
    );

  const handleReset = async () => {
    const ok = await confirm({
      title: t("dashboardTab.resetConfirm"),
      confirmLabel: t("dashboard.reset"),
    });
    if (!ok) return;
    setSlots(DEFAULT_SLOTS);
    setMainWidthPct(68);
    setEditMode(false);
    try {
      localStorage.removeItem("dashboardTab.slots");
      localStorage.removeItem("dashboardTab.mainWidthPct");
    } catch {
      /* ignore */
    }
  };

  const placed = new Set(slots.map((s) => s.id as string));
  const available = [
    ...DASHBOARD_CARDS.map((card) => ({
      id: card.id as string,
      plugin: false,
    })),
    ...registeredCards.map((card) => ({ id: card.id, plugin: true })),
  ].filter((card) => !placed.has(card.id));

  const column = (panel: PanelId, columnSlots: CardSlot[], width: string) => (
    <div
      style={{ width }}
      className={`flex min-w-0 flex-col ${
        isMobile ? "shrink-0" : "min-h-0 overflow-y-auto thin-scrollbar"
      } ${panel === "side" ? "bg-surface-dim/40" : ""}`}
      onDragOver={(e) => editMode && e.preventDefault()}
      onDrop={() => editMode && drop(panel, columnSlots.length)}
    >
      {columnSlots.length === 0 && editMode && (
        <div className="m-2.5 flex flex-1 items-center justify-center border border-dashed border-border p-6 text-xs text-muted-foreground">
          {t("dashboardTab.dropHere")}
        </div>
      )}
      {columnSlots.map((slot, i) => (
        <Section
          key={slot.key}
          slot={slot}
          meta={metaFor(slot.id)}
          editMode={editMode}
          last={isMobile ? false : i === columnSlots.length - 1}
          dragging={dragKey === slot.key}
          onDragStart={() => setDragKey(slot.key)}
          onDrop={() => drop(panel, slot.order - 0.5)}
          onRemove={() =>
            setSlots((prev) => prev.filter((s) => s.key !== slot.key))
          }
          onHeightChange={handleHeightChange}
          autoHeight={isMobile}
        >
          {renderCard(slot.id)}
        </Section>
      ))}
    </div>
  );

  const online = hosts.filter((h) => h.status === "online").length;
  const links = [
    {
      href: "https://github.com/Termix-SSH/Termix",
      label: t("dashboard.github"),
    },
    {
      href: reportCoreIssueUrl(import.meta.env.VITE_APP_VERSION || undefined),
      label: t("dashboard.reportBug"),
    },
    {
      href: "https://discord.com/invite/jVQGdvHDrf",
      label: t("dashboard.discord"),
    },
    { href: docsUrl(), label: t("dashboard.docs") },
    { href: "https://donate.termix.site/", label: t("dashboard.donate") },
  ];

  const title =
    secondaryView && !viewPending ? (
      <Segmented
        value={isDashboardView ? "dashboard" : secondaryView.actionId}
        onChange={setDashboardView}
        options={[
          { value: "dashboard", label: t("dashboard.title") },
          { value: secondaryView.actionId, label: t(secondaryView.titleKey) },
        ]}
      />
    ) : (
      t("dashboard.title")
    );

  return (
    <PanelShell
      icon={<LayoutGrid className="size-4" />}
      title={title}
      status={isDashboardView ? todayLabel : undefined}
      scroll={false}
      docs={docsUrl("dashboard")}
      actions={
        <>
          {isDashboardView && !viewPending && (
            <>
              {editMode ? (
                <>
                  <span className="hidden text-[11px] text-muted-foreground lg:inline">
                    {t("dashboardTab.dragToReorder")}
                  </span>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="gap-1"
                    onClick={() => void handleReset()}
                  >
                    <RotateCcw className="size-3" />
                    {t("dashboard.reset")}
                  </Button>
                </>
              ) : (
                <Facts className="hidden px-1.5 text-[11px] text-muted-foreground md:flex">
                  <span>
                    {t("dashboardTab.onlineCount", { count: online })}
                  </span>
                  <span>
                    {t("dashboardTab.hostCount", { count: hosts.length })}
                  </span>
                  <span className="flex items-center gap-1">
                    {t("dashboardTab.commandPalette")}
                    <Kbd className="h-4">⇧⇧</Kbd>
                  </span>
                </Facts>
              )}
              <span
                aria-hidden
                className="hidden h-4 w-px bg-border xl:block"
              />
            </>
          )}
          <span className="hidden items-center gap-0.5 xl:flex">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
          </span>
          {isDashboardView && (
            <Button
              variant="ghost"
              size="icon-sm"
              title={
                editMode
                  ? t("dashboardTab.done")
                  : t("dashboard.customizeLayout")
              }
              aria-label={
                editMode
                  ? t("dashboardTab.done")
                  : t("dashboard.customizeLayout")
              }
              className={editMode ? "text-accent-brand" : ""}
              onClick={() => setEditMode((v) => !v)}
            >
              {editMode ? (
                <Check className="size-4" />
              ) : (
                <Pencil className="size-4" />
              )}
            </Button>
          )}
        </>
      }
    >
      {viewPending ? (
        <div className="flex flex-1 flex-col gap-2 p-2.5">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="w-full flex-1" />
        </div>
      ) : !isDashboardView && secondaryView?.component ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <secondaryView.component onOpenSingletonTab={onOpenSingletonTab} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div
            ref={bodyRef}
            className={`flex min-h-0 flex-1 ${isMobile ? "flex-col overflow-y-auto" : ""}`}
          >
            {column(
              "main",
              mainSlots,
              isMobile || !showSide ? "100%" : `${mainWidthPct}%`,
            )}
            {showSide && (
              <>
                <div
                  onMouseDown={isMobile ? undefined : onColumnDividerMouseDown}
                  title={t("dashboardTab.dragToResizeColumns")}
                  className={`shrink-0 bg-border transition-colors ${
                    isMobile
                      ? "h-px w-full"
                      : "w-px cursor-col-resize hover:bg-accent-brand"
                  }`}
                />
                {column(
                  "side",
                  sideSlots,
                  isMobile ? "100%" : `${100 - mainWidthPct}%`,
                )}
              </>
            )}
          </div>
          {editMode && (
            <AddTray
              available={available}
              labels={labels}
              onAdd={(id) => handleAdd(id as DashboardCardId)}
            />
          )}
        </div>
      )}
    </PanelShell>
  );
}
