import type { HomepageWidgetContribution } from "@termix/plugin-sdk/frontend";

/** The homepage's grid step, in pixels. */
export const GRID_SIZE = 30;

export type MetricsChartMetric =
  "cpu" | "memory" | "disk" | "net_rx" | "net_tx";
export type MetricsChartRange = "15m" | "1h" | "6h" | "24h";

export interface MetricsChartConfig {
  hostId: number;
  metric: MetricsChartMetric;
  range: MetricsChartRange;
  showCurrentValue: boolean;
}

/** What the homepage hands a widget; only the fields this plugin reads. */
export interface WidgetComponentProps<C> {
  widget: { title?: string | null };
  config: C;
}

export interface WidgetEditFormProps<C> {
  config: C;
  onChange: (config: C) => void;
}

export type WidgetDefinition<C> = Omit<
  HomepageWidgetContribution<C>,
  "defaultConfig"
> & { defaultConfig: C };
