export type WidgetType =
  | "cpu"
  | "memory"
  | "disk"
  | "network"
  | "uptime"
  | "processes"
  | "system"
  | "login_stats"
  | "ports"
  | "firewall"
  | "temperature"
  | "gpu";

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

export interface FirewallRule {
  chain: string;
  target: string;
  protocol: string;
  source: string;
  destination: string;
  dport?: string;
  sport?: string;
  state?: string;
  interface?: string;
  extra?: string;
}

export interface FirewallChain {
  name: string;
  policy: string;
  rules: FirewallRule[];
}

export interface FirewallMetrics {
  type: "iptables" | "nftables" | "none";
  status: "active" | "inactive" | "unknown";
  chains: FirewallChain[];
}

export interface TemperatureSensor {
  label: string;
  celsius: number;
}

export interface TemperatureMetrics {
  source: "sysfs" | "sensors" | "none";
  highestCelsius: number | null;
  sensors: TemperatureSensor[];
}

export interface GpuDevice {
  index: number;
  uuid: string;
  name: string;
  driverVersion: string | null;
  utilizationPercent: number | null;
  memoryUsedMiB: number | null;
  memoryTotalMiB: number | null;
  memoryPercent: number | null;
  temperatureCelsius: number | null;
  powerDrawWatts: number | null;
  powerLimitWatts: number | null;
  fanPercent: number | null;
}

export interface GpuProcess {
  gpuIndex: number | null;
  pid: number;
  name: string;
  memoryUsedMiB: number | null;
}

export interface GpuMetrics {
  source: "nvidia-smi" | "none";
  gpus: GpuDevice[];
  processes: GpuProcess[];
}

/** This plugin's host settings, as core stores them in plugin_settings. */
export interface HostMetricsSettings {
  metricsEnabled: boolean;
  /** Seconds between samples; null follows the admin setting. */
  metricsInterval: number | null;
  enabledWidgets: WidgetType[];
  /** Filesystem mount points to leave out of the disk widget. */
  excludedMounts: string[];
  /** Extra paths to monitor, including paths inside bind-mounted containers. */
  monitoredMounts: Array<{ path: string; label?: string }>;
}

export const DEFAULT_ENABLED_WIDGETS: WidgetType[] = [
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
  "temperature",
];

export const DEFAULT_HOST_METRICS_SETTINGS: HostMetricsSettings = {
  metricsEnabled: true,
  metricsInterval: null,
  enabledWidgets: DEFAULT_ENABLED_WIDGETS,
  excludedMounts: [],
  monitoredMounts: [],
};

/** Host settings with defaults filled in and bad values dropped. */
export function readHostMetricsSettings(
  values: Record<string, unknown> | null | undefined,
): HostMetricsSettings {
  const bag = values ?? {};
  const interval = Number(bag.metricsInterval);
  return {
    metricsEnabled: bag.metricsEnabled !== false,
    metricsInterval:
      bag.metricsInterval != null &&
      Number.isInteger(interval) &&
      interval >= 5 &&
      interval <= 3600
        ? interval
        : null,
    enabledWidgets: Array.isArray(bag.enabledWidgets)
      ? (bag.enabledWidgets.filter(
          (widget) => typeof widget === "string",
        ) as WidgetType[])
      : DEFAULT_ENABLED_WIDGETS,
    excludedMounts: Array.isArray(bag.excludedMounts)
      ? bag.excludedMounts.filter(
          (mount): mount is string => typeof mount === "string",
        )
      : [],
    monitoredMounts: Array.isArray(bag.monitoredMounts)
      ? (bag.monitoredMounts as unknown[]).filter(
          (mount): mount is { path: string; label?: string } =>
            !!mount &&
            typeof mount === "object" &&
            typeof (mount as { path?: unknown }).path === "string",
        )
      : [],
  };
}
