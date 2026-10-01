export type ProxmoxSource = {
  source: "proxmox";
  sourceHostId: number;
  node: string;
  vmid: number;
  type: "qemu" | "lxc";
  lastSeenAt?: string;
  lastStatus?: string;
  missingSince?: string | null;
};

export function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** The guest a host was imported from, read from its proxmoxConfig setting. */
export function getProxmoxSource(config: unknown): ProxmoxSource | null {
  const source = parseJsonObject(config).source;
  if (!source || typeof source !== "object") return null;
  const src = source as Record<string, unknown>;
  if (
    src.source !== "proxmox" ||
    typeof src.sourceHostId !== "number" ||
    typeof src.node !== "string" ||
    typeof src.vmid !== "number" ||
    (src.type !== "qemu" && src.type !== "lxc")
  ) {
    return null;
  }
  return src as ProxmoxSource;
}

export function proxmoxSourceKey(source: {
  sourceHostId: number;
  node: string;
  type: string;
  vmid: number;
}): string {
  return `${source.sourceHostId}:${source.node}:${source.type}:${source.vmid}`;
}

export interface ImportedGuest<H = Record<string, unknown>> {
  host: H;
  config: Record<string, unknown>;
  source: ProxmoxSource;
}

/**
 * The hosts already imported from one Proxmox node, keyed by guest. The
 * source lives in each guest's proxmoxConfig host setting, not on the host
 * row, so the caller passes both.
 */
export function indexImportedGuests<H extends { id: unknown }>(
  hosts: H[],
  configs: Array<{ hostId: number; value: unknown }>,
  sourceHostId: number,
): Map<string, ImportedGuest<H>> {
  const configById = new Map(configs.map((c) => [c.hostId, c.value]));
  const out = new Map<string, ImportedGuest<H>>();
  for (const host of hosts) {
    const config = parseJsonObject(configById.get(Number(host.id)));
    const source = getProxmoxSource(config);
    if (source?.sourceHostId === sourceHostId) {
      out.set(proxmoxSourceKey(source), { host, config, source });
    }
  }
  return out;
}
