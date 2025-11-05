export type WidgetType =
  | "cpu"
  | "memory"
  | "disk"
  | "network"
  | "uptime"
  | "processes"
  | "system";

export interface StatsConfig {
  enabledWidgets: WidgetType[];
  statusCheckEnabled: boolean;
  statusCheckInterval: number;
  metricsEnabled: boolean;
  metricsInterval: number;
}

export const DEFAULT_STATS_CONFIG: StatsConfig = {
  enabledWidgets: ["cpu", "memory", "disk", "network", "uptime", "system"],
  statusCheckEnabled: true,
  statusCheckInterval: 30,
  metricsEnabled: true,
  metricsInterval: 30,
};
