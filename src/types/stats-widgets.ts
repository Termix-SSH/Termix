export type WidgetType = "cpu" | "memory" | "disk";

export interface StatsConfig {
  enabledWidgets: WidgetType[];
}

export const DEFAULT_STATS_CONFIG: StatsConfig = {
  enabledWidgets: ["cpu", "memory", "disk"],
};
