/** One mounted filesystem, as the host-metrics plugin reports it. */
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

export interface HostDiskInfo {
  percent: number | null;
  usedHuman: string | null;
  totalHuman: string | null;
  mount: string | null;
  filesystems?: DiskFilesystem[];
}

/** The filesystem the path lives on: the longest mount point that holds it. */
export function mountForPath(
  filesystems: DiskFilesystem[],
  path: string | null | undefined,
): DiskFilesystem | null {
  if (!path) return null;
  let best: DiskFilesystem | null = null;
  for (const fs of filesystems) {
    const mount = fs.mount.replace(/\/+$/, "") || "/";
    const inside =
      mount === "/" || path === mount || path.startsWith(`${mount}/`);
    if (inside && (!best || mount.length > best.mount.length)) best = fs;
  }
  return best;
}
