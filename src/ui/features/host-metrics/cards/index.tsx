import type { ComponentType, ReactNode } from "react";
import type { ServerMetrics } from "@/main-axios";
import type { HostMetricsCardId } from "@/types/host-metrics";
import { defaultColSpanFor, defaultHeightFor } from "@/types/host-metrics";
import { CpuCard } from "./CpuCard";
import { MemoryCard } from "./MemoryCard";
import { DiskCard } from "./DiskCard";
import { NetworkCard } from "./NetworkCard";
import { UptimeCard } from "./UptimeCard";
import { SystemCard } from "./SystemCard";
import { LoginStatsCard } from "./LoginStatsCard";
import { PortsCard } from "./PortsCard";
import { ProcessesCard } from "./ProcessesCard";
import { FirewallCard } from "./FirewallCard";
import { TemperatureCard } from "./TemperatureCard";
import { ServiceManagerCard } from "./managers/ServiceManagerCard";
import { ProcessInspectorCard } from "./managers/ProcessInspectorCard";
import { PackageManagerCard } from "./managers/PackageManagerCard";
import { CronManagerCard } from "./managers/CronManagerCard";
import { SslManagerCard } from "./managers/SslManagerCard";
import { FirewallManagerCard } from "./managers/FirewallManagerCard";
import { UserManagerCard } from "./managers/UserManagerCard";
import { HealthCheckCard } from "./managers/HealthCheckCard";
import { LogViewerCard } from "./managers/LogViewerCard";
import {
  TopMemoryCard,
  SystemdTimersCard,
  DiskBreakdownCard,
} from "./managers/SimpleManagerCards";
import { WireGuardManagerCard } from "./managers/WireGuardManagerCard";
import { TailscaleManagerCard } from "./managers/TailscaleManagerCard";

export interface MetricCardHistories {
  cpu: number[];
  memory: number[];
  disk: number[];
}

export interface CardRenderContext {
  metrics: ServerMetrics | null;
  histories: MetricCardHistories;
  hostId: number | null;
}

export interface CardDefinition {
  id: HostMetricsCardId;
  /** i18n key for the card's display label. */
  labelKey: string;
  kind: "metric" | "manager";
  render: (ctx: CardRenderContext) => ReactNode;
}

type SimpleMetricCard = ComponentType<{
  metrics: ServerMetrics | null;
  hostId: number | null;
}>;
type HistoryMetricCard = ComponentType<{
  metrics: ServerMetrics | null;
  history: number[];
  hostId: number | null;
}>;

function metricCard(
  id: HostMetricsCardId,
  labelKey: string,
  Comp: SimpleMetricCard,
): CardDefinition {
  return {
    id,
    labelKey,
    kind: "metric",
    render: ({ metrics, hostId }) => <Comp metrics={metrics} hostId={hostId} />,
  };
}

function historyCard(
  id: HostMetricsCardId,
  labelKey: string,
  Comp: HistoryMetricCard,
  series: keyof MetricCardHistories,
): CardDefinition {
  return {
    id,
    labelKey,
    kind: "metric",
    render: ({ metrics, histories, hostId }) => (
      <Comp metrics={metrics} history={histories[series]} hostId={hostId} />
    ),
  };
}

type ManagerCardComp = ComponentType<{ hostId: number | null }>;

function managerCard(
  id: HostMetricsCardId,
  labelKey: string,
  Comp: ManagerCardComp,
): CardDefinition {
  return {
    id,
    labelKey,
    kind: "manager",
    render: ({ hostId }) => <Comp hostId={hostId} />,
  };
}

export const CARD_DEFINITIONS: Record<string, CardDefinition> = {
  cpu: historyCard("cpu", "hostMetrics.cpuUsage", CpuCard, "cpu"),
  memory: historyCard(
    "memory",
    "hostMetrics.memoryUsage",
    MemoryCard,
    "memory",
  ),
  disk: historyCard("disk", "hostMetrics.diskUsage", DiskCard, "disk"),
  network: metricCard("network", "hostMetrics.networkInterfaces", NetworkCard),
  uptime: metricCard("uptime", "hostMetrics.uptime", UptimeCard),
  system: metricCard("system", "hostMetrics.systemInfo", SystemCard),
  login_stats: metricCard(
    "login_stats",
    "hostMetrics.loginStats",
    LoginStatsCard,
  ),
  ports: metricCard("ports", "hostMetrics.ports.title", PortsCard),
  processes: metricCard("processes", "hostMetrics.processes", ProcessesCard),
  firewall: metricCard("firewall", "hostMetrics.firewall.title", FirewallCard),
  temperature: metricCard(
    "temperature",
    "hostMetrics.temperature",
    TemperatureCard,
  ),
  service_manager: managerCard(
    "service_manager",
    "hostMetrics.managers.services",
    ServiceManagerCard,
  ),
  process_inspector: managerCard(
    "process_inspector",
    "hostMetrics.managers.processInspector",
    ProcessInspectorCard,
  ),
  log_viewer: managerCard(
    "log_viewer",
    "hostMetrics.managers.logViewer",
    LogViewerCard,
  ),
  cron_manager: managerCard(
    "cron_manager",
    "hostMetrics.managers.cron",
    CronManagerCard,
  ),
  package_manager: managerCard(
    "package_manager",
    "hostMetrics.managers.packages",
    PackageManagerCard,
  ),
  ssl_manager: managerCard(
    "ssl_manager",
    "hostMetrics.managers.ssl",
    SslManagerCard,
  ),
  firewall_manager: managerCard(
    "firewall_manager",
    "hostMetrics.managers.firewall",
    FirewallManagerCard,
  ),
  user_manager: managerCard(
    "user_manager",
    "hostMetrics.managers.users",
    UserManagerCard,
  ),
  health_check: managerCard(
    "health_check",
    "hostMetrics.managers.healthCheck",
    HealthCheckCard,
  ),
  disk_breakdown: managerCard(
    "disk_breakdown",
    "hostMetrics.managers.diskBreakdown",
    DiskBreakdownCard,
  ),
  systemd_timers: managerCard(
    "systemd_timers",
    "hostMetrics.managers.systemdTimers",
    SystemdTimersCard,
  ),
  top_memory: managerCard(
    "top_memory",
    "hostMetrics.managers.topMemory",
    TopMemoryCard,
  ),
  wireguard_manager: managerCard(
    "wireguard_manager",
    "hostMetrics.managers.wireguard",
    WireGuardManagerCard,
  ),
  tailscale_manager: managerCard(
    "tailscale_manager",
    "hostMetrics.managers.tailscale",
    TailscaleManagerCard,
  ),
};

/** All card ids implemented and available in the Add tray. */
export const IMPLEMENTED_CARD_IDS = Object.keys(
  CARD_DEFINITIONS,
) as HostMetricsCardId[];

export function getCardDefinition(id: string): CardDefinition | undefined {
  return CARD_DEFINITIONS[id];
}

export { defaultColSpanFor, defaultHeightFor };
