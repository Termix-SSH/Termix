import type { WidgetType } from "./stats-widgets.js";

/**
 * Host Metrics layout model. Shared by the frontend tab and the backend
 * preferences endpoint. Metric card ids reuse the existing `WidgetType` values
 * verbatim (so `enabledWidgets` stays valid for the mobile app); manager card
 * ids are new and never enter `statsConfig.enabledWidgets`.
 */

export type HostMetricCardId = WidgetType;

export type HostMetricManagerId =
  | "service_manager"
  | "process_inspector"
  | "log_viewer"
  | "cron_manager"
  | "package_manager"
  | "ssl_manager"
  | "firewall_manager"
  | "user_manager"
  | "health_check"
  | "disk_breakdown"
  | "systemd_timers"
  | "top_memory";

export type HostMetricsCardId = HostMetricCardId | HostMetricManagerId;

export type HostMetricsColSpan = 1 | 2 | 3;

export interface HostMetricsSlot {
  id: HostMetricsCardId;
  order: number;
  colSpan: HostMetricsColSpan;
  height: number | null;
}

export interface HostMetricsLayout {
  slots: HostMetricsSlot[];
  columns: number;
}

/** Canonical order of metric cards (also the canonical `enabledWidgets` order). */
export const METRIC_CARD_IDS: HostMetricCardId[] = [
  "cpu",
  "memory",
  "disk",
  "network",
  "uptime",
  "system",
  "login_stats",
  "processes",
  "ports",
  "firewall",
];

export const MANAGER_CARD_IDS: HostMetricManagerId[] = [
  "service_manager",
  "process_inspector",
  "log_viewer",
  "cron_manager",
  "package_manager",
  "ssl_manager",
  "firewall_manager",
  "user_manager",
  "health_check",
  "disk_breakdown",
  "systemd_timers",
  "top_memory",
];

export function isMetricCardId(id: string): id is HostMetricCardId {
  return (METRIC_CARD_IDS as string[]).includes(id);
}

export function isManagerCardId(id: string): id is HostMetricManagerId {
  return (MANAGER_CARD_IDS as string[]).includes(id);
}

/**
 * Derive the flat `enabledWidgets` array (canonical order, deduped, metric ids
 * only) from a set of layout slots. This is the single source of truth keeping
 * `statsConfig.enabledWidgets` valid for the mobile app.
 */
export function deriveEnabledWidgets(
  slots: Array<{ id: string }>,
): WidgetType[] {
  const present = new Set(slots.map((s) => s.id));
  return METRIC_CARD_IDS.filter((id) => present.has(id));
}

const DEFAULT_COLSPAN: Partial<Record<HostMetricsCardId, HostMetricsColSpan>> =
  {
    cpu: 1,
    memory: 1,
    disk: 1,
    uptime: 1,
    system: 1,
    network: 1,
    processes: 2,
    ports: 2,
    firewall: 2,
    login_stats: 2,
  };

// All cards default to content/auto height (null); the masonry packs them
// tetris-style and scrollable cards cap their own body height. Users can still
// pin an explicit height by dragging a card's resize handle.
const DEFAULT_HEIGHT: Partial<Record<HostMetricsCardId, number | null>> = {};

/**
 * Build a default layout from a list of enabled metric-card ids (e.g. the host's
 * current `statsConfig.enabledWidgets`), preserving canonical order. Manager
 * cards are not added by default.
 */
export function defaultLayoutFromWidgets(
  enabledWidgets: string[],
  columns = 3,
): HostMetricsLayout {
  const enabled = new Set(enabledWidgets);
  const ids = METRIC_CARD_IDS.filter((id) => enabled.has(id));
  const slots: HostMetricsSlot[] = ids.map((id, i) => ({
    id,
    order: i,
    colSpan: DEFAULT_COLSPAN[id] ?? 1,
    height: DEFAULT_HEIGHT[id] ?? null,
  }));
  return { slots, columns };
}

export function defaultColSpanFor(id: HostMetricsCardId): HostMetricsColSpan {
  return DEFAULT_COLSPAN[id] ?? (isManagerCardId(id) ? 2 : 1);
}

export function defaultHeightFor(id: HostMetricsCardId): number | null {
  if (id in DEFAULT_HEIGHT) return DEFAULT_HEIGHT[id] ?? null;
  return null;
}
