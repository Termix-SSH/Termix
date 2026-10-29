/**
 * Linux metrics: one awk sample of /proc for CPU, memory, load, network and
 * processes, plus df parsing for disks.
 */

// One awk reads every /proc file itself, so a sample is one exec of awk instead
// of a shell plus six tools. Output sections are split by @@; each process line
// is pid, utime+stime ticks, rss pages, starttime, state, ppid, comm.
const AWK = String.raw`BEGIN{f="/proc/stat";while((getline l<f)>0)if(l~/^cpu/)print l;close(f);print "@@";f="/proc/meminfo";while((getline l<f)>0)if(l~/^(MemTotal|MemFree|MemAvailable|Buffers|Cached|SwapTotal|SwapFree):/)print l;close(f);print "@@";f="/proc/loadavg";getline l<f;print l;close(f);f="/proc/uptime";getline l<f;print l;close(f);print "@@";f="/proc/net/dev";while((getline l<f)>0)print l;close(f);print "@@";print pg;print "@@";for(i=1;i<ARGC;i++){f=ARGV[i];if((getline s<f)>0){a=index(s,"(");if(a&&match(s,/\)[^)]*$/)){split(substr(s,RSTART+2),x," ");print substr(s,1,a-2)"	"(x[12]+x[13])"	"x[22]"\t"x[20]"\t"x[1]"	"x[2]"	"substr(s,a+1,RSTART-a-1)}}close(f)}}`;

/** The live sample command. The page size never changes on a host, so pass it back once known. */
export const liveCmd = (pageBytes?: number) =>
  "awk -v pg=" +
  (pageBytes ?? '"$(getconf PAGESIZE)"') +
  " '" +
  AWK +
  "' /proc/[0-9]*/stat";

export interface LiveSample {
  /** The admin minimum between samples; the client never polls faster. */
  minIntervalS?: number;
  cpu: number | null;
  cpuMix?: { user: number; system: number; iowait: number; steal: number };
  cores: Array<number | null>;
  coreIds: string[];
  memTotalKb: number;
  memCachedKb: number;
  memFreeKb: number;
  memUsedKb: number;
  swapTotalKb: number;
  swapUsedKb: number;
  load: [number, number, number];
  net: Array<{ name: string; rxBps: number | null; txBps: number | null }>;
  count: number;
  running: number;
  procs: Array<{
    pid: number;
    name: string;
    cpu: number;
    memKb: number;
    state: string;
    ppid: number;
  }>;
  /** Seconds since boot. */
  uptime?: number;
  /** Total bytes received and sent on every interface but lo, since boot. */
  netTotals?: { rx: number; tx: number };
}

/** What the next call needs from this one. */
export interface LivePrev {
  at: number;
  uptime: number;
  pageBytes: number;
  cpu: Map<string, { total: number; idle: number }>;
  /** Aggregate user nice system idle iowait irq softirq steal ticks, for the breakdown. */
  cpuRaw?: number[];
  /** Keyed by pid:starttime so a reused pid never inherits another process's ticks. */
  ticks: Map<string, number>;
  net: Map<string, { rx: number; tx: number }>;
}

/** Total and idle ticks from a /proc/stat `cpu` line. */
export function parseCpuLine(
  cpuLine: string,
): { total: number; idle: number } | undefined {
  const parts = cpuLine.trim().split(/\s+/);
  if (parts[0] !== "cpu") return undefined;
  const nums = parts
    .slice(1)
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n));
  if (nums.length < 4) return undefined;
  const idle = (nums[3] ?? 0) + (nums[4] ?? 0);
  const total = nums.reduce((a, b) => a + b, 0);
  return { total, idle };
}

const TOP_N = 60;

/** Parses `liveCmd()` output. Rates need the `next` of the previous call. */
export function parseLive(
  output: string,
  prev: LivePrev | undefined,
  at = Date.now(),
): { sample: LiveSample; next: LivePrev } {
  const [cpuS = "", memS = "", loadS = "", netS = "", pageS = "", procS = ""] =
    output.split("@@\n");

  // Only the first 8 fields: guest and guest_nice are already inside user and nice.
  const cpu = new Map<string, { total: number; idle: number }>();
  let cpuRaw: number[] | undefined;
  for (const l of cpuS.split("\n")) {
    const name = l.split(/\s+/)[0];
    if (!name.startsWith("cpu")) continue;
    if (name === "cpu") cpuRaw = l.split(/\s+/).slice(1, 9).map(Number);
    const c = parseCpuLine(
      l
        .replace(/^cpu\d*/, "cpu")
        .split(/\s+/)
        .slice(0, 9)
        .join(" "),
    );
    if (c) cpu.set(name, c);
  }
  // Matched by name, so an offline core does not shift the ones after it.
  const pct = (name: string) => {
    const p = prev?.cpu.get(name);
    const c = cpu.get(name);
    if (!p || !c || c.total <= p.total) return null;
    const used = c.total - p.total - (c.idle - p.idle);
    return Math.max(0, Math.min(100, (used / (c.total - p.total)) * 100));
  };

  // Where the busy time went since the last sample, as percent of all ticks.
  let cpuMix: LiveSample["cpuMix"];
  if (prev?.cpuRaw && cpuRaw && cpuRaw.length === 8) {
    const d = cpuRaw.map((v, i) => v - (prev.cpuRaw?.[i] ?? 0));
    const total = d.reduce((a, b) => a + b, 0);
    if (total > 0 && d.every((v) => v >= 0)) {
      const p = (n: number) => (n / total) * 100;
      cpuMix = {
        user: p(d[0] + d[1]),
        system: p(d[2] + d[5] + d[6]),
        iowait: p(d[4]),
        steal: p(d[7]),
      };
    }
  }

  const mem: Record<string, number> = {};
  for (const l of memS.split("\n")) {
    const m = l.match(/^(\w+):\s+(\d+)/);
    if (m) mem[m[1]] = Number(m[2]);
  }

  const [la = "", up = ""] = loadS.trim().split("\n");
  const laParts = la.split(/\s+/).map(Number);
  const uptime = Number(up.split(/\s+/)[0]) || 0;

  const nets = new Map<string, { rx: number; tx: number }>();
  for (const l of netS.split("\n")) {
    const [name, rest] = l.split(":");
    if (!rest || name.trim() === "lo") continue;
    const f = rest.trim().split(/\s+/);
    nets.set(name.trim(), { rx: Number(f[0]) || 0, tx: Number(f[8]) || 0 });
  }
  // A reboot makes uptime go backwards, so rates start again.
  const dt = prev && uptime > prev.uptime ? uptime - prev.uptime : 0;
  const rate = (now: number, before: number | undefined) =>
    dt > 0 && before !== undefined && now >= before
      ? (now - before) / dt
      : null;

  const pageBytes = Number(pageS.trim()) || prev?.pageBytes || 4096;
  const pageKb = pageBytes / 1024;
  const aggDelta =
    prev && cpu.has("cpu") && prev.cpu.has("cpu")
      ? cpu.get("cpu")!.total - prev.cpu.get("cpu")!.total
      : 0;
  const cores = [...cpu.keys()].filter((k) => k !== "cpu");
  const ncpu = Math.max(1, cores.length);
  const ticks = new Map<string, number>();
  const procs: LiveSample["procs"] = [];
  for (const l of procS.split("\n")) {
    const [pid, t, rss, start, state, ppid, ...rest] = l.split("\t");
    const name = rest.join("\t");
    if (!name) continue;
    const key = pid + ":" + start;
    const tk = Number(t) || 0;
    ticks.set(key, tk);
    const before = prev?.ticks.get(key);
    procs.push({
      pid: Number(pid),
      name,
      cpu:
        before !== undefined && aggDelta > 0 && tk >= before
          ? ((tk - before) / aggDelta) * ncpu * 100
          : 0,
      memKb: (Number(rss) || 0) * pageKb,
      state: state || "?",
      ppid: Number(ppid) || 0,
    });
  }
  procs.sort((a, b) => b.cpu - a.cpu || b.memKb - a.memKb);

  // Awk exits 0 when /proc is missing (macOS, restricted containers); that is not a sample.
  if (!cpu.has("cpu") || !mem.MemTotal || !uptime) {
    throw new Error("live sample unavailable: /proc data missing");
  }
  const memTotalKb = mem.MemTotal;
  const swapTotalKb = mem.SwapTotal ?? 0;
  let rxTotal = 0;
  let txTotal = 0;
  for (const c of nets.values()) {
    rxTotal += c.rx;
    txTotal += c.tx;
  }
  return {
    sample: {
      cpu: pct("cpu"),
      cores: cores.map(pct),
      coreIds: cores.map((k) => k.slice(3)),
      cpuMix,
      memTotalKb,
      memCachedKb: (mem.Buffers ?? 0) + (mem.Cached ?? 0),
      memFreeKb: mem.MemFree ?? 0,
      memUsedKb: memTotalKb - (mem.MemAvailable ?? 0),
      swapTotalKb,
      swapUsedKb: swapTotalKb - (mem.SwapFree ?? 0),
      load: [laParts[0] || 0, laParts[1] || 0, laParts[2] || 0],
      net: [...nets].map(([name, c]) => ({
        name,
        rxBps: rate(c.rx, prev?.net.get(name)?.rx),
        txBps: rate(c.tx, prev?.net.get(name)?.tx),
      })),
      count: procs.length,
      running: procs.filter((p) => p.state === "R").length,
      procs: procs.slice(0, TOP_N),
      uptime,
      netTotals: { rx: rxTotal, tx: txTotal },
    },
    next: { at, uptime, pageBytes, cpu, cpuRaw, ticks, net: nets },
  };
}

// Disks

const DARWIN_DATA_MOUNT = "/System/Volumes/Data";
const PSEUDO_FS_RE =
  /^(tmpfs|devtmpfs|overlay|udev|none|shm|squashfs|efivarfs)$/;

/** GNU df sizes in KiB, without the header. */
export const DF_BYTES_COMMAND = "df -TkP | tail -n +2";
/** GNU df sizes as short human text, without the header. */
export const DF_HUMAN_COMMAND = "df -hT -P | tail -n +2";

export interface DfRow {
  filesystem: string;
  type: string;
  mount: string;
  parts: string[];
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

export interface MonitoredMount {
  path: string;
  label?: string;
}

function toFixedNum(n: number | null | undefined, digits = 2): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

/**
 * Parses `df -T -P` style output: Filesystem, Type, then the size columns,
 * with Mounted-on last. Pseudo filesystems are left out.
 */
export function parseDfLines(output: string): DfRow[] {
  return output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      return {
        filesystem: parts[0] || "",
        type: parts[1] || "",
        mount: parts[6] || "",
        parts,
      };
    })
    .filter((row) => row.parts.length >= 7 && !PSEUDO_FS_RE.test(row.type));
}

/** The most used real filesystem in a `df -TkP` row set. */
export function findWorstMountIndex(bytesRows: DfRow[]): {
  index: number;
  usedBytes: number;
  totalBytes: number;
} {
  let worstIndex = -1;
  let worstUsedBytes = -1;
  let worstTotalBytes = 0;
  bytesRows.forEach((row, index) => {
    const totalBytes = Number(row.parts[2]);
    const usedBytes = Number(row.parts[3]);
    if (
      !Number.isFinite(totalBytes) ||
      !Number.isFinite(usedBytes) ||
      totalBytes <= 0
    ) {
      return;
    }
    const usedRatio = usedBytes / totalBytes;
    const worstRatio =
      worstTotalBytes > 0 ? worstUsedBytes / worstTotalBytes : -1;
    if (usedRatio > worstRatio) {
      worstIndex = index;
      worstUsedBytes = usedBytes;
      worstTotalBytes = totalBytes;
    }
  });
  return {
    index: worstIndex,
    usedBytes: worstUsedBytes,
    totalBytes: worstTotalBytes,
  };
}

/**
 * Merges `df -TkP` size rows (parts[2..4] in `blockSizeBytes` units) and
 * `df -hT -P` human rows into one list. Human rows only supply the display
 * text, matched by mount point so a mismatched row count can't shift them.
 */
export function buildFilesystemList(
  bytesRows: DfRow[],
  humanRows: DfRow[],
  blockSizeBytes = 1,
): DiskFilesystem[] {
  const aligned = humanRows.length === bytesRows.length;
  return bytesRows
    .map((row, index) => {
      const totalBytes = Number(row.parts[2]) * blockSizeBytes;
      const usedBytes = Number(row.parts[3]) * blockSizeBytes;
      const availableBytes = Number(row.parts[4]) * blockSizeBytes;
      if (!Number.isFinite(totalBytes) || totalBytes <= 0) return null;
      const humanRow = aligned
        ? humanRows[index]
        : humanRows.find((h) => h.mount === row.mount);
      const percent = Number.isFinite(usedBytes)
        ? Math.max(0, Math.min(100, (usedBytes / totalBytes) * 100))
        : null;
      return {
        filesystem: row.filesystem,
        type: row.type,
        mount: row.mount,
        percent: toFixedNum(percent, 0),
        usedHuman: humanRow?.parts[3] || null,
        totalHuman: humanRow?.parts[2] || null,
        availableHuman: humanRow?.parts[4] || null,
        usedBytes: Number.isFinite(usedBytes) ? usedBytes : null,
        totalBytes,
        availableBytes: Number.isFinite(availableBytes) ? availableBytes : null,
      };
    })
    .filter((fs): fs is DiskFilesystem => fs !== null);
}

/**
 * The headline disk is the root filesystem. On macOS "/" is the small sealed
 * system volume, so the data volume wins there. With no root mount the most
 * used one is shown.
 */
export function selectPrimaryFilesystem(
  filesystems: DiskFilesystem[],
): DiskFilesystem | null {
  if (filesystems.length === 0) return null;
  const root =
    filesystems.find((fs) => fs.mount === DARWIN_DATA_MOUNT) ??
    filesystems.find((fs) => fs.mount === "/");
  if (root) return root;
  let best = filesystems[0];
  for (const fs of filesystems) {
    const ratio = (fs.usedBytes ?? 0) / (fs.totalBytes || 1);
    const bestRatio = (best.usedBytes ?? 0) / (best.totalBytes || 1);
    if (ratio > bestRatio) best = fs;
  }
  return best;
}

/**
 * Drops mounts by exact path ("/mnt/nas") or by filesystem type substring
 * ("nfs" matches nfs and nfs4), so network shares can be hidden.
 */
export function filterExcludedFilesystems(
  filesystems: DiskFilesystem[],
  excludedMounts?: string[] | null,
): DiskFilesystem[] {
  if (!excludedMounts || excludedMounts.length === 0) return filesystems;
  const normalized = excludedMounts
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (normalized.length === 0) return filesystems;
  return filesystems.filter((fs) => {
    const mount = fs.mount.toLowerCase();
    const type = fs.type.toLowerCase();
    return !normalized.some(
      (entry) => mount === entry || (type && type.includes(entry)),
    );
  });
}

export function mergeMonitoredFilesystems(
  filesystems: DiskFilesystem[],
  monitored: MonitoredMount[],
  customFilesystems: Array<DiskFilesystem | null>,
): DiskFilesystem[] {
  const result = [...filesystems];
  monitored.forEach((entry, index) => {
    const path = entry.path.trim();
    const custom = customFilesystems[index];
    if (!path || !custom) return;
    const existing = result.find((fs) => fs.mount === path);
    if (existing) {
      existing.label = entry.label?.trim() || undefined;
      return;
    }
    result.push({
      ...custom,
      mount: path,
      label: entry.label?.trim() || undefined,
    });
  });
  return result;
}

/** Host name, OS, kernel and arch in one exec, as key=value lines. */
export const SYSTEM_INFO_COMMAND = `echo "hostname=$(hostname 2>/dev/null || cat /etc/hostname 2>/dev/null)"; echo "os=$( . /etc/os-release 2>/dev/null; echo "$PRETTY_NAME")"; echo "kernel=$(uname -r 2>/dev/null)"; echo "arch=$(uname -m 2>/dev/null)"`;
