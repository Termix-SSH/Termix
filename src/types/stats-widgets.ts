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
  // Status monitoring configuration
  statusCheckEnabled: boolean;
  statusCheckInterval: number; // seconds (5-3600)
  // Metrics monitoring configuration
  metricsEnabled: boolean;
  metricsInterval: number; // seconds (5-3600)
}

export const DEFAULT_STATS_CONFIG: StatsConfig = {
  enabledWidgets: ["cpu", "memory", "disk", "network", "uptime", "system"],
  statusCheckEnabled: true,
  statusCheckInterval: 30,
  metricsEnabled: true,
  metricsInterval: 30,
};
