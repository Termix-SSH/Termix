import type { GpuMetrics } from "./stats-widgets.js";

/** What GET /metrics/:id answers. */
export interface CpuMetrics {
  percent: number | null;
  cores: number | null;
  load: [number, number, number] | null;
}

export interface MemoryMetrics {
  percent: number | null;
  usedGiB: number | null;
  totalGiB: number | null;
}

export interface DiskFilesystem {
  filesystem: string;
  type: string;
  mount: string;
  percent: number | null;
  usedHuman: string | null;
  totalHuman: string | null;
  availableHuman: string | null;
  usedBytes: number | null;
  totalBytes: number | null;
  availableBytes: number | null;
  label?: string;
}

interface DiskMetrics {
  percent: number | null;
  usedHuman: string | null;
  totalHuman: string | null;
  availableHuman?: string | null;
  mount?: string | null;
  filesystems?: DiskFilesystem[];
}

export interface NetworkInterface {
  name: string;
  ip: string;
  state: string;
  rx?: string | null;
  tx?: string | null;
  rxBytes?: string | null;
  txBytes?: string | null;
  rxRateBps?: number | null;
  txRateBps?: number | null;
}

export interface ProcessInfo {
  pid: string;
  user: string;
  cpu: string;
  mem: string;
  command: string;
}

export interface LoginRecord {
  user: string;
  ip: string;
  time: string;
  status: "success" | "failed";
}

export interface ListeningPort {
  protocol: "tcp" | "udp";
  localAddress: string;
  localPort: number;
  state?: string;
  pid?: number;
  process?: string;
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

export type ServerMetrics = {
  cpu: CpuMetrics;
  memory: MemoryMetrics;
  disk: DiskMetrics;
  network?: { interfaces?: NetworkInterface[] };
  uptime?: { seconds?: number | null; formatted?: string | null };
  system?: {
    hostname?: string | null;
    os?: string | null;
    kernel?: string | null;
    arch?: string | null;
  };
  processes?: {
    total?: number | null;
    running?: number | null;
    top?: ProcessInfo[];
  };
  login_stats?: {
    recentLogins?: LoginRecord[];
    failedLogins?: LoginRecord[];
    totalLogins?: number;
    uniqueIPs?: number;
  };
  ports?: {
    source?: "ss" | "netstat" | "none";
    ports?: ListeningPort[];
  };
  firewall?: {
    type?: "iptables" | "nftables" | "none";
    status?: "active" | "inactive" | "unknown";
    chains?: FirewallChain[];
  };
  temperature?: {
    source?: "sysfs" | "sensors" | "none";
    highestCelsius?: number | null;
    sensors?: Array<{
      label: string;
      celsius: number;
    }>;
  };
  gpu?: GpuMetrics;
  lastChecked: string;
};
