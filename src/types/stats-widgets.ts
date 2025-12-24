export type WidgetType =
  | "cpu"
  | "memory"
  | "disk"
  | "network"
  | "uptime"
  | "processes"
  | "system"
  | "login_stats"
  | "ports";

export interface ListeningPort {
  protocol: "tcp" | "udp";
  localAddress: string;
  localPort: number;
  state?: string;
  pid?: number;
  process?: string;
}

export interface PortsMetrics {
  source: "ss" | "netstat" | "none";
  ports: ListeningPort[];
}

export interface StatsConfig {
  enabledWidgets: WidgetType[];
  statusCheckEnabled: boolean;
  statusCheckInterval: number;
  metricsEnabled: boolean;
  metricsInterval: number;
}

export const DEFAULT_STATS_CONFIG: StatsConfig = {
  enabledWidgets: [
    "cpu",
    "memory",
    "disk",
    "network",
    "uptime",
    "system",
    "login_stats",
  ],
  statusCheckEnabled: true,
  statusCheckInterval: 30,
  metricsEnabled: true,
  metricsInterval: 30,
};
