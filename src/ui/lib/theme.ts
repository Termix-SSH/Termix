import type {
  DashboardCardConfig,
  FontSizeId,
  SplitMode,
} from "@/types/ui-types";

export const DASHBOARD_CARDS: DashboardCardConfig[] = [
  {
    id: "stats_bar",
    label: "Status Bar",
    description: "Version, uptime, database health, hosts online",
    defaultEnabled: true,
  },
  {
    id: "counters_bar",
    label: "Counters Bar",
    description: "Total hosts, credentials, and tunnels count",
    defaultEnabled: true,
  },
  {
    id: "quick_actions",
    label: "Quick Actions",
    description: "Shortcuts to add hosts, credentials, settings",
    defaultEnabled: true,
  },
  {
    id: "host_status",
    label: "Host Status",
    description: "Live status list with CPU/RAM per host",
    defaultEnabled: true,
  },
  {
    id: "recent_activity",
    label: "Recent Activity",
    description: "Feed of recent connection events",
    defaultEnabled: true,
  },
  {
    id: "network_graph",
    label: "Network Graph",
    description: "Visual map of host network topology",
    defaultEnabled: false,
  },
  {
    id: "service_links",
    label: "Service Links",
    description: "Clickable buttons linking to services on your servers",
    defaultEnabled: false,
  },
  {
    id: "homepage_preview",
    label: "Homepage",
    description: "Scaled preview of your Homepage canvas",
    defaultEnabled: false,
  },
];

export const ACCENT_PRESET_COLORS = [
  { label: "Orange", value: "#f59145" },
  { label: "Blue", value: "#3b82f6" },
  { label: "Green", value: "#22c55e" },
  { label: "Purple", value: "#a855f7" },
  { label: "Pink", value: "#ec4899" },
  { label: "Cyan", value: "#06b6d4" },
  { label: "Red", value: "#ef4444" },
  { label: "Yellow", value: "#eab308" },
  { label: "Teal", value: "#14b8a6" },
  { label: "Indigo", value: "#6366f1" },
  { label: "Rose", value: "#f43f5e" },
  { label: "Lime", value: "#84cc16" },
];

export function applyAccentColor(colorValue: string) {
  document.documentElement.style.setProperty("--accent-brand", colorValue);
}

export const FONT_SIZES: { id: FontSizeId; label: string }[] = [
  { id: "xs", label: "XS" },
  { id: "sm", label: "Small" },
  { id: "md", label: "Normal" },
  { id: "lg", label: "Large" },
  { id: "xl", label: "XL" },
];

export function applyFontSize(id: FontSizeId) {
  const root = document.documentElement;
  root.classList.remove("fs-xs", "fs-sm", "fs-md", "fs-lg", "fs-xl");
  root.classList.add(`fs-${id}`);
  localStorage.setItem("termix-font-size", id);
}

export const FOLDER_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
  "#6b7280",
];

export const SPLIT_MODES: { id: SplitMode; label: string }[] = [
  { id: "none", label: "None" },
  { id: "2-way", label: "2-Way" },
  { id: "3-way", label: "3-Way (V)" },
  { id: "3-way-horizontal", label: "3-Way (H)" },
  { id: "4-way", label: "4-Way" },
  { id: "5-way", label: "5-Way" },
  { id: "6-way", label: "6-Way" },
];

export const PANE_COUNTS: Record<SplitMode, number> = {
  none: 0,
  "2-way": 2,
  "3-way": 3,
  "3-way-horizontal": 3,
  "4-way": 4,
  "5-way": 5,
  "6-way": 6,
};
