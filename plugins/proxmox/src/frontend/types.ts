// Frontend-side mirror of the backend Proxmox stats collectors' return
// shapes (src/backend/proxmox/*.ts). Kept in sync by hand.

export interface ProxmoxNodeStats {
  cpu: {
    percent: number | null;
    cores: number | null;
    load: [number, number, number] | null;
  };
  memory: {
    percent: number | null;
    usedGiB: number | null;
    totalGiB: number | null;
  };
  disk: {
    percent: number | null;
    usedGiB: number | null;
    totalGiB: number | null;
  };
  uptime: {
    seconds: number | null;
    formatted: string | null;
  };
  system: {
    hostname: string | null;
    kernel: string | null;
    pveVersion: string | null;
  };
}

export interface ProxmoxNodeNetwork {
  interfaces: Array<{
    name: string;
    ip: string | null;
    state: string | null;
    rxBytes: string | null;
    txBytes: string | null;
  }>;
}

export interface ProxmoxGuestSummary {
  vmid: number;
  name: string;
  type: "qemu" | "lxc";
  status: string;
  cpuPercent: number | null;
  memPercent: number | null;
  memUsedGiB: number | null;
  memTotalGiB: number | null;
  diskPercent: number | null;
  diskUsedGiB: number | null;
  diskTotalGiB: number | null;
  uptimeSeconds: number | null;
}

export interface ProxmoxGuestsSummary {
  guests: ProxmoxGuestSummary[];
  counts: { running: number; stopped: number; total: number };
}

export interface ProxmoxStoragePool {
  name: string;
  type: string;
  active: boolean;
  enabled: boolean;
  usedGiB: number | null;
  totalGiB: number | null;
  availGiB: number | null;
  percent: number | null;
}

export interface ProxmoxStorage {
  pools: ProxmoxStoragePool[];
}

export type ProxmoxClusterHealth =
  | { clustered: false }
  | {
      clustered: true;
      quorate: boolean;
      clusterName: string | null;
      nodes: Array<{
        name: string;
        online: boolean;
        local: boolean;
        ip: string | null;
      }>;
    };

export interface ProxmoxStatsSnapshot {
  node: ProxmoxNodeStats;
  network: ProxmoxNodeNetwork;
  guests: ProxmoxGuestsSummary;
  storage: ProxmoxStorage;
  cluster: ProxmoxClusterHealth;
  lastChecked: string;
}

export interface ProxmoxStatsConfig {
  nodeName?: string | null;
  pollInterval?: number;
  enabledCards?: string[];
}

/** The proxmoxConfig host setting. */
export interface ProxmoxHostConfig {
  source?: {
    source: "proxmox";
    sourceHostId: number;
    node: string;
    vmid: number;
    type: "qemu" | "lxc";
    lastSeenAt?: string;
    lastStatus?: string;
    missingSince?: string | null;
  };
  defaultCredentialId: number | null;
  defaultAuthType?: string;
  windowsPatterns: string;
  dockerPatterns: string;
  preferredPrefixes: string;
  autoSyncEnabled?: boolean;
  syncIntervalMinutes?: number;
  markMissingGuests?: boolean;
  lastSyncAt?: string;
  lastSyncStatus?: "success" | "error";
  lastSyncError?: string | null;
  lastSyncResult?: {
    created: number;
    updated: number;
    markedMissing: number;
    skipped: number;
    errors: string[];
  };
}
