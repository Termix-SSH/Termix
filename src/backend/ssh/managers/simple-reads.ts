import type { Express } from "express";
import { execCommand } from "../widgets/common-utils.js";
import { managerHandler } from "./route-helpers.js";
import type { ManagerRoutesDeps } from "./types.js";

// ─── Top by memory ──────────────────────────────────────────────────────────

export interface MemProcessRow {
  pid: number;
  user: string;
  mem: number;
  rss: number;
  command: string;
}

const TOP_MEM_CMD =
  "ps -eo pid,user:20,pmem,rss,comm --sort=-pmem --no-headers 2>/dev/null | head -n 20";

export function parseTopMemory(output: string): MemProcessRow[] {
  const rows: MemProcessRow[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\d+)\s+(\S+)\s+([\d.]+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    rows.push({
      pid: Number(m[1]),
      user: m[2],
      mem: Number(m[3]),
      rss: Number(m[4]),
      command: m[5],
    });
  }
  return rows;
}

// ─── Systemd timers ─────────────────────────────────────────────────────────

export interface TimerRow {
  next: string;
  left: string;
  last: string;
  unit: string;
  activates: string;
}

const TIMERS_CMD =
  "systemctl list-timers --all --no-legend --no-pager 2>/dev/null";

export function parseTimers(output: string): TimerRow[] {
  const rows: TimerRow[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("NEXT")) continue;
    // NEXT(3) LEFT(2) LAST(3) PASSED(2) UNIT ACTIVATES  -> columns vary; grab
    // the trailing UNIT + ACTIVATES which always end the line.
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const activates = parts[parts.length - 1];
    const unit = parts[parts.length - 2];
    if (!unit.endsWith(".timer")) continue;
    rows.push({
      next: parts.slice(0, 3).join(" "),
      left: "",
      last: "",
      unit,
      activates,
    });
  }
  return rows;
}

// ─── Disk breakdown (per-mount) ─────────────────────────────────────────────

export interface MountUsage {
  filesystem: string;
  sizeKb: number;
  usedKb: number;
  availKb: number;
  usePct: number;
  mount: string;
}

const DF_CMD = "df -Pk 2>/dev/null | tail -n +2";

export function parseDfMounts(output: string): MountUsage[] {
  const mounts: MountUsage[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(.+)$/);
    if (!m) continue;
    const fs = m[1];
    // Skip pseudo/virtual filesystems that clutter the view.
    if (/^(tmpfs|devtmpfs|overlay|udev|none|shm)$/.test(fs)) continue;
    mounts.push({
      filesystem: fs,
      sizeKb: Number(m[2]),
      usedKb: Number(m[3]),
      availKb: Number(m[4]),
      usePct: Number(m[5]),
      mount: m[6],
    });
  }
  return mounts;
}

export function registerSimpleReadRoutes(
  app: Express,
  { validateHostId, runOnHost }: ManagerRoutesDeps,
): void {
  app.get(
    "/host-metrics/managers/top-memory/:id",
    validateHostId,
    managerHandler(runOnHost, "read", "top_memory", async (client) => {
      const { stdout } = await execCommand(client, TOP_MEM_CMD, 15000);
      return { processes: parseTopMemory(stdout) };
    }),
  );

  app.get(
    "/host-metrics/managers/timers/:id",
    validateHostId,
    managerHandler(runOnHost, "read", "systemd_timers", async (client) => {
      const { stdout } = await execCommand(client, TIMERS_CMD, 15000);
      return { timers: parseTimers(stdout) };
    }),
  );

  app.get(
    "/host-metrics/managers/disk-breakdown/:id",
    validateHostId,
    managerHandler(runOnHost, "read", "disk_breakdown", async (client) => {
      const { stdout } = await execCommand(client, DF_CMD, 15000);
      return { mounts: parseDfMounts(stdout) };
    }),
  );
}
