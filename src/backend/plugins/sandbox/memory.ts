/**
 * How much memory Termix and its plugin processes use, against what the box
 * (or the container) allows, and an alert to admins when it gets tight.
 */

import fs from "node:fs";
import os from "node:os";
import type { SandboxStatus } from "./supervisor.js";

/** Over this share of the limit the plugins page warns and admins get told. */
export const MEMORY_WARN_SHARE = 0.8;
const CHECK_MS = 10 * 60_000;
const ALERT_EVERY_MS = 24 * 60 * 60_000;

export interface MemoryLimit {
  mb: number;
  /** A container limit, or the machine's memory. */
  source: "container" | "system";
}

const MB = 1024 * 1024;

/** The container's memory limit when it has one, else the machine's memory. */
export function readMemoryLimit(
  read: (file: string) => string = (file) => fs.readFileSync(file, "utf8"),
  totalBytes: number = os.totalmem(),
): MemoryLimit {
  const system = { mb: Math.round(totalBytes / MB), source: "system" as const };
  for (const file of [
    "/sys/fs/cgroup/memory.max",
    "/sys/fs/cgroup/memory/memory.limit_in_bytes",
  ]) {
    let text: string;
    try {
      text = read(file).trim();
    } catch {
      continue;
    }
    const bytes = Number(text);
    // "max", or v1's huge number, means no limit.
    if (!Number.isFinite(bytes) || bytes <= 0 || bytes >= totalBytes) {
      return system;
    }
    return { mb: Math.round(bytes / MB), source: "container" };
  }
  return system;
}

export interface PluginMemoryReport {
  core: { rssMb: number };
  plugins: Array<{
    pluginId: string;
    state: SandboxStatus["state"];
    keepOnReason: string | null;
    /** What keeps it up for now when it may stop, or null. */
    busy: string | null;
    rssMb: number | null;
  }>;
  /** Termix plus every running plugin process. */
  totalMb: number;
  pluginsMb: number;
  running: number;
  limitMb: number;
  limitSource: MemoryLimit["source"];
  /** Total memory is past MEMORY_WARN_SHARE of the limit. */
  low: boolean;
}

export function buildMemoryReport(
  statuses: SandboxStatus[],
  coreRssBytes: number,
  limit: MemoryLimit,
): PluginMemoryReport {
  const plugins = statuses
    .map((status) => ({
      pluginId: status.pluginId,
      state: status.state,
      keepOnReason: status.keepOnReason,
      busy: status.busy ?? null,
      rssMb: status.rssMb,
    }))
    .sort((a, b) => (b.rssMb ?? 0) - (a.rssMb ?? 0));
  const pluginsMb = plugins.reduce((sum, p) => sum + (p.rssMb ?? 0), 0);
  const coreMb = Math.round(coreRssBytes / MB);
  const totalMb = coreMb + pluginsMb;
  return {
    core: { rssMb: coreMb },
    plugins,
    totalMb,
    pluginsMb,
    running: plugins.filter((p) => p.state === "ready").length,
    limitMb: limit.mb,
    limitSource: limit.source,
    low: limit.mb > 0 && totalMb > limit.mb * MEMORY_WARN_SHARE,
  };
}

export async function currentMemoryReport(): Promise<PluginMemoryReport> {
  const { getSandboxSupervisor } = await import("./supervisor.js");
  return buildMemoryReport(
    getSandboxSupervisor().status(),
    process.memoryUsage().rss,
    readMemoryLimit(),
  );
}

let timer: NodeJS.Timeout | null = null;
let lastAlertAt = Number.NEGATIVE_INFINITY;

/** Checks every few minutes and tells admins once a day while it stays low. */
export async function checkMemoryOnce(
  report: () => Promise<PluginMemoryReport> = currentMemoryReport,
  now: () => number = Date.now,
): Promise<boolean> {
  const current = await report();
  if (!current.low || now() - lastAlertAt < ALERT_EVERY_MS) return false;
  lastAlertAt = now();
  const { sendCoreAlert } = await import("../../notify/core-notify.js");
  await sendCoreAlert({
    title: "This server is low on memory",
    body:
      `Termix and its plugins use ${current.totalMb} MB of ${current.limitMb} MB. ` +
      "Give the server more memory or turn off plugins you do not use. " +
      "The plugins page shows what each one uses.",
    severity: "warning",
    category: "termix.memory",
    audience: "admins",
  });
  return true;
}

export function startMemoryWatch(): void {
  if (timer) return;
  timer = setInterval(() => void checkMemoryOnce().catch(() => {}), CHECK_MS);
  timer.unref?.();
}

export function stopMemoryWatch(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Test seam. */
export function resetMemoryAlerts(): void {
  lastAlertAt = Number.NEGATIVE_INFINITY;
}
