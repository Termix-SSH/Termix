import { useTranslation } from "react-i18next";
import {
  ExternalLink,
  KeyRound,
  Plus,
  Server,
  Settings,
  User,
} from "lucide-react";
import { ComponentSlot } from "@/shell/ActionSlot";
import { VersionBadge } from "@/components/version-badge";
import { Facts } from "@/components/panel-layout";
import { enabledHostProtocols, protocolPort } from "@/sidebar/host-protocols";
import { activityTarget } from "@/lib/activity-types";
import {
  defaultConnectAction,
  hostActionsFor,
  listHostActions,
} from "@/sidebar/host-contributions";
import {
  getStatusClasses,
  useStatusColorScheme,
} from "@/hooks/use-status-color-scheme";
import { getDefaultConnectionTab } from "@/lib/host-connection-tabs";
import type { RecentActivityItem } from "@/main-axios";
import type { Host, TabType } from "@/types/ui-types";
import { quarterBorders } from "./quarter-borders";

export type VersionStatus =
  "up_to_date" | "requires_update" | "beta" | "unknown";

function Stat({
  label,
  aside,
  children,
}: {
  label: string;
  /** Sits beside the label, like the release channel. */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col justify-center gap-1 px-3 py-2">
      {children}
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-[10px] text-muted-foreground">
          {label}
        </span>
        {aside}
      </div>
    </div>
  );
}

export function StatsStrip({
  hosts,
  uptimeFormatted,
  versionText,
  versionStatus,
  releaseUrl,
  dbHealth,
}: {
  hosts: Host[];
  uptimeFormatted: string;
  versionText: string;
  versionStatus: VersionStatus;
  releaseUrl: string;
  dbHealth: "healthy" | "error";
}) {
  const { t } = useTranslation();
  const online = hosts.filter((h) => h.status === "online").length;
  const big = "text-2xl font-bold leading-none tracking-tight";
  return (
    <div className="grid h-full grid-cols-2 divide-x divide-border md:grid-cols-4">
      <Stat
        label={t("dashboard.version")}
        aside={
          <VersionBadge
            status={versionStatus}
            releaseUrl={releaseUrl}
            className="shrink-0 px-1 py-px text-[9px]"
          />
        }
      >
        <span className={`${big} truncate`} title={versionText || undefined}>
          {versionText || "-"}
        </span>
      </Stat>
      <Stat label={t("dashboard.uptime")}>
        <span className={big}>{uptimeFormatted || "-"}</span>
      </Stat>
      <Stat label={t("dashboard.database")}>
        <span
          className={`${big} ${dbHealth === "healthy" ? "text-accent-brand" : "text-destructive"}`}
        >
          {dbHealth === "healthy"
            ? t("dashboard.healthy")
            : t("dashboard.error")}
        </span>
      </Stat>
      <Stat label={t("dashboardTab.hostsAvailable")}>
        <div className="flex items-baseline gap-1">
          <span className={big}>{online}</span>
          <span className="text-sm leading-none text-muted-foreground">
            /{hosts.length}
          </span>
        </div>
      </Stat>
    </div>
  );
}

export function CountersStrip({
  hosts,
  credentialCount,
  onOpenSingletonTab,
}: {
  hosts: Host[];
  credentialCount: number;
  onOpenSingletonTab: (type: TabType, pendingEvent?: string) => void;
}) {
  const { t } = useTranslation();
  const item =
    "flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50";
  return (
    <div className="grid h-full auto-cols-fr grid-flow-col divide-x divide-border">
      <button
        type="button"
        onClick={() => onOpenSingletonTab("host-manager")}
        className={item}
      >
        <Server className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xl font-bold leading-none tracking-tight">
          {hosts.length}
        </span>
        <span className="truncate text-[11px] text-muted-foreground">
          {t("dashboard.totalHosts")}
        </span>
      </button>
      <button
        type="button"
        onClick={() =>
          onOpenSingletonTab("host-manager", "host-manager:show-credentials")
        }
        className={item}
      >
        <KeyRound className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xl font-bold leading-none tracking-tight">
          {credentialCount}
        </span>
        <span className="truncate text-[11px] text-muted-foreground">
          {t("dashboard.totalCredentials")}
        </span>
      </button>
      <ComponentSlot slotId="dashboard.counters" />
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  hint,
  onClick,
  className,
}: {
  icon: React.ElementType;
  label: string;
  hint: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group/btn flex h-full min-w-0 items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50 ${className ?? ""}`}
    >
      <span className="flex size-6 shrink-0 items-center justify-center border border-border bg-muted transition-colors group-hover/btn:border-accent-brand/40 group-hover/btn:bg-accent-brand/20">
        <Icon className="size-3 text-accent-brand" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-xs font-medium">{label}</span>
        <span className="truncate text-[10px] text-muted-foreground">
          {hint}
        </span>
      </span>
    </button>
  );
}

export function QuickActions({
  onOpenSingletonTab,
  hosts,
  onOpenTab,
  isAdmin,
}: {
  onOpenSingletonTab: (type: TabType, pendingEvent?: string) => void;
  hosts: Host[];
  onOpenTab: (host: Host, type: TabType) => void;
  isAdmin: boolean;
}) {
  const { t } = useTranslation();
  const pinnedHosts = hosts.filter((h) => h.pin).slice(0, 4);
  const endpoint = (host: Host) => {
    const protocol = host.enableSsh ? undefined : enabledHostProtocols(host)[0];
    const port = host.enableSsh
      ? host.sshPort
      : protocol
        ? protocolPort(host.pluginSettings, protocol)
        : host.port;
    return `${host.ip}:${port ?? host.port}`;
  };
  const actions = [
    {
      icon: Plus,
      label: t("dashboard.addHost"),
      hint: t("dashboardTab.registerNewServer"),
      onClick: () =>
        onOpenSingletonTab("host-manager", "host-manager:add-host"),
    },
    {
      icon: KeyRound,
      label: t("dashboard.addCredential"),
      hint: t("dashboardTab.storeSshKeysOrPasswords"),
      onClick: () =>
        onOpenSingletonTab("host-manager", "host-manager:add-credential"),
    },
    ...(isAdmin
      ? [
          {
            icon: Settings,
            label: t("dashboard.adminSettings"),
            hint: t("dashboardTab.manageUsersAndRoles"),
            onClick: () => onOpenSingletonTab("admin-settings"),
          },
        ]
      : []),
    {
      icon: User,
      label: t("dashboard.userProfile"),
      hint: t("dashboardTab.manageYourAccount"),
      onClick: () => onOpenSingletonTab("user-profile"),
    },
  ];
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <div className="grid flex-1 auto-rows-fr grid-cols-1 sm:grid-cols-2">
        {actions.map((action, i) => (
          <ActionButton
            key={action.label}
            {...action}
            className={quarterBorders(i, actions.length)}
          />
        ))}
      </div>
      {pinnedHosts.length > 0 && (
        <div className="flex flex-col border-t border-border">
          {pinnedHosts.map((host) => {
            const Icon =
              defaultConnectAction(listHostActions(), host)?.icon ?? Server;
            return (
              <button
                key={host.id}
                type="button"
                onClick={() => {
                  const type = getDefaultConnectionTab(host);
                  if (type) onOpenTab(host, type);
                }}
                className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5 text-left transition-colors last:border-b-0 hover:bg-muted/50"
              >
                <Icon className="size-3 shrink-0 text-accent-brand" />
                <span className="truncate text-xs font-medium">
                  {host.name || host.ip}
                </span>
                <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">
                  {endpoint(host)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function HostStatusList({
  hosts,
  onOpenTab,
  statusLoading,
}: {
  hosts: Host[];
  onOpenTab: (host: Host, type: TabType) => void;
  statusLoading?: boolean;
}) {
  const { t } = useTranslation();
  const scheme = useStatusColorScheme();
  if (hosts.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-8 text-xs text-muted-foreground/60">
        {t("dashboardTab.noHostsConfigured")}
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {hosts.map((host) => {
        const availability = host.status ?? "offline";
        return (
          <div
            key={host.id}
            role="button"
            tabIndex={0}
            onClick={() => {
              // An overview action (a metrics view) wins over connecting.
              const actions = hostActionsFor(listHostActions(), host);
              const target =
                actions.find((action) => action.overview)?.tabType ??
                defaultConnectAction(actions, host)?.tabType;
              if (target) onOpenTab(host, target);
            }}
            className="group/row flex min-w-0 cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-muted/50"
          >
            <span
              className={`size-1.5 shrink-0 rounded-full ${getStatusClasses(availability, scheme, "dot", statusLoading)}`}
            />
            <span className="min-w-0 flex-1">
              <Facts className="min-w-0">
                <span
                  className="truncate text-xs font-medium"
                  title={host.name}
                >
                  {host.name}
                </span>
                <span
                  className="truncate font-mono text-[10px] text-muted-foreground"
                  title={host.ip}
                >
                  {host.ip}
                </span>
              </Facts>
            </span>
            {/* Plugins add live details to a host row here. */}
            <ComponentSlot
              slotId="dashboard.hostRow"
              props={{
                hostId: Number(host.id),
                online: availability === "online",
              }}
            />
            <span
              className={`shrink-0 border px-1.5 py-0.5 text-[10px] font-semibold ${getStatusClasses(availability, scheme, "badge", statusLoading)}`}
            >
              {statusLoading || availability === "unknown"
                ? t("dashboardTab.checking")
                : availability === "online"
                  ? t("hosts.status.online")
                  : t("hosts.status.offline")}
            </span>
            <ExternalLink className="size-2.5 shrink-0 text-muted-foreground/0 transition-colors group-hover/row:text-muted-foreground/60" />
          </div>
        );
      })}
    </div>
  );
}

export function RecentActivityList({
  activity,
  hosts,
  onOpenTab,
  statusLoading,
}: {
  activity: RecentActivityItem[];
  hosts: Host[];
  onOpenTab: (host: Host, type: TabType) => void;
  statusLoading?: boolean;
}) {
  const { t } = useTranslation();
  const scheme = useStatusColorScheme();
  const ago = (ts: string) => {
    const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (diff < 60) return t("dashboard.justNow");
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
  };
  if (activity.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-8 text-xs text-muted-foreground/60">
        {t("dashboard.noRecentActivity")}
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {activity.map((item) => {
        const host = hosts.find((h) => h.id === String(item.hostId));
        const target = activityTarget(item.type);
        const Icon = target?.icon ?? Server;
        return (
          <div
            key={item.id}
            role="button"
            tabIndex={0}
            onClick={() => {
              if (host && target) onOpenTab(host, target.tab);
            }}
            className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-muted/50"
          >
            <span
              className={`size-1.5 shrink-0 rounded-full ${getStatusClasses(host?.status ?? false, scheme, "dot", statusLoading)}`}
            />
            <span className="truncate text-xs font-medium">
              {item.hostName}
            </span>
            <span className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
              <Icon className="size-2.5 shrink-0" />
              <span className="truncate">
                {target?.labelKey
                  ? t(target.labelKey)
                  : item.type.replace("_", " ")}
              </span>
            </span>
            <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
              {ago(item.timestamp)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
