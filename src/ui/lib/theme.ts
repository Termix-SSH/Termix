import type {
  DashboardCardConfig,
  FontSizeId,
  UiFontId,
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

/** The root font size of each interface size, relative to Normal. */
export const FONT_SIZE_SCALE: Record<FontSizeId, number> = {
  xs: 12 / 14,
  sm: 13 / 14,
  md: 1,
  lg: 17 / 14,
  xl: 20 / 14,
};

export function applyFontSize(id: FontSizeId) {
  const root = document.documentElement;
  const size = id in FONT_SIZE_SCALE ? id : "md";
  root.classList.remove("fs-xs", "fs-sm", "fs-md", "fs-lg", "fs-xl");
  root.classList.add(`fs-${size}`);
  localStorage.setItem("termix-font-size", size);

  // Every length is in rem, so the root size scales the whole interface. An
  // earlier desktop build zoomed the window instead; undo that if it did.
  (
    window as Window & {
      electronAPI?: { setZoomFactor?: (factor: number) => void };
    }
  ).electronAPI?.setZoomFactor?.(1);
}

export const UI_FONTS: { id: UiFontId; label: string; family: string }[] = [
  {
    id: "jetbrains-mono",
    label: "JetBrains Mono",
    family: '"JetBrains Mono Variable", monospace',
  },
  {
    id: "system-sans",
    label: "System Sans",
    family: "ui-sans-serif, system-ui, sans-serif",
  },
  {
    id: "fira-code",
    label: "Fira Code",
    family: '"Fira Code", monospace',
  },
  {
    id: "source-code-pro",
    label: "Source Code Pro",
    family: '"Source Code Pro", monospace',
  },
  {
    id: "caskaydia-cove",
    label: "Caskaydia Cove",
    family: '"Caskaydia Cove Nerd Font Mono", monospace',
  },
];

export function applyUiFont(id: UiFontId) {
  const font = UI_FONTS.find((candidate) => candidate.id === id) ?? UI_FONTS[0];
  document.documentElement.style.setProperty("--font-ui", font.family);
  localStorage.setItem("termix-ui-font", font.id);
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
  { id: "2-way-horizontal", label: "2-Way (H)" },
  { id: "3-way", label: "3-Way (V)" },
  { id: "3-way-horizontal", label: "3-Way (H)" },
  { id: "4-way", label: "4-Way" },
  { id: "5-way", label: "5-Way" },
  { id: "6-way", label: "6-Way" },
];

export const PANE_COUNTS: Record<SplitMode, number> = {
  none: 0,
  "2-way": 2,
  "2-way-horizontal": 2,
  "3-way": 3,
  "3-way-horizontal": 3,
  "4-way": 4,
  "5-way": 5,
  "6-way": 6,
};
