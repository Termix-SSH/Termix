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
