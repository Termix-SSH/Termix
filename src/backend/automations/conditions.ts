import type { MetricPath, Operator } from "../../types/automations.js";

/**
 * Operator evaluation and metric extraction.
 *
 * Pure: no database, no SSH, no clock. Everything here is driven by values the
 * caller already has, which keeps the comparison rules testable on their own.
 */

/** Shape of the metrics snapshot this module reads. Mirrors collectMetrics(). */
export interface MetricsSnapshot {
  cpu?: {
    percent?: number | null;
    load?: [number, number, number] | null;
  } | null;
  memory?: { percent?: number | null; usedGiB?: number | null } | null;
  disk?: {
    percent?: number | null;
    filesystems?: Array<{
      mount?: string;
      percent?: number | null;
      availableBytes?: number | null;
    }> | null;
  } | null;
  network?: {
    interfaces?: Array<{
      name?: string;
      rxBytes?: string | number | null;
      txBytes?: string | number | null;
    }> | null;
  } | null;
  temperature?: { highestCelsius?: number | null } | null;
  uptime?: { seconds?: number | null } | null;
  processes?: { total?: number | null } | null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Pulls the value a trigger watches out of a metrics snapshot.
 *
 * The mount and iface selectors are what let a rule watch one filesystem or
 * one interface. Without a selector the aggregate is used, which for disk is
 * the primary (root) mount, matching what the metrics UI shows.
 */
export function extractMetricValue(
  metrics: MetricsSnapshot | null | undefined,
  metric: MetricPath,
): number | null {
  if (!metrics) return null;

  switch (metric.path) {
    case "cpu.percent":
      return toNumber(metrics.cpu?.percent);
    case "cpu.load1":
      return toNumber(metrics.cpu?.load?.[0]);
    case "cpu.load5":
      return toNumber(metrics.cpu?.load?.[1]);
    case "cpu.load15":
      return toNumber(metrics.cpu?.load?.[2]);
    case "memory.percent":
      return toNumber(metrics.memory?.percent);
    case "memory.usedGiB":
      return toNumber(metrics.memory?.usedGiB);
    case "disk.percent": {
      if (!metric.mount) return toNumber(metrics.disk?.percent);
      const fs = findMount(metrics, metric.mount);
      return fs ? toNumber(fs.percent) : null;
    }
    case "disk.availableBytes": {
      const fs = metric.mount ? findMount(metrics, metric.mount) : null;
      if (metric.mount) return fs ? toNumber(fs.availableBytes) : null;
      const first = metrics.disk?.filesystems?.[0];
      return first ? toNumber(first.availableBytes) : null;
    }
    case "temperature.highestCelsius":
      return toNumber(metrics.temperature?.highestCelsius);
    case "uptime.seconds":
      return toNumber(metrics.uptime?.seconds);
    case "processes.total":
      return toNumber(metrics.processes?.total);
    case "network.rxBytes":
      return toNumber(findInterface(metrics, metric.iface)?.rxBytes);
    case "network.txBytes":
      return toNumber(findInterface(metrics, metric.iface)?.txBytes);
    default:
      return null;
  }
}

function findMount(metrics: MetricsSnapshot, mount: string) {
  return (
    metrics.disk?.filesystems?.find((entry) => entry.mount === mount) ?? null
  );
}

function findInterface(metrics: MetricsSnapshot, iface?: string) {
  const interfaces = metrics.network?.interfaces;
  if (!interfaces || interfaces.length === 0) return null;
  if (!iface) return interfaces[0];
  return interfaces.find((entry) => entry.name === iface) ?? null;
}

/**
 * The key a trigger's durable state is stored under. Including the mount or
 * container is what allows a sustained-breach window per filesystem rather
 * than per host.
 */
export function metricStateKey(hostId: number, metric: MetricPath): string {
  if ("mount" in metric && metric.mount) return `${hostId}:${metric.mount}`;
  if ("iface" in metric && metric.iface) return `${hostId}:${metric.iface}`;
  return String(hostId);
}

/**
 * Compares two values. Numeric when both sides look numeric, so "90" and 90
 * behave the same; string comparison otherwise. `changed` is handled by the
 * caller, which is the only place that knows the previous value.
 */
export function compare(
  left: unknown,
  operator: Operator,
  right: unknown,
): boolean {
  if (operator === "contains" || operator === "not_contains") {
    const haystack = String(left ?? "");
    const needle = String(right ?? "");
    const found = haystack.includes(needle);
    return operator === "contains" ? found : !found;
  }

  const leftNumber = toNumber(left);
  const rightNumber = toNumber(right);
  const numeric = leftNumber !== null && rightNumber !== null;

  switch (operator) {
    case ">":
      return numeric && leftNumber > rightNumber;
    case "<":
      return numeric && leftNumber < rightNumber;
    case ">=":
      return numeric && leftNumber >= rightNumber;
    case "<=":
      return numeric && leftNumber <= rightNumber;
    case "==":
      return numeric
        ? leftNumber === rightNumber
        : String(left ?? "") === String(right ?? "");
    case "!=":
      return numeric
        ? leftNumber !== rightNumber
        : String(left ?? "") !== String(right ?? "");
    case "changed":
      return String(left ?? "") !== String(right ?? "");
    default:
      return false;
  }
}

/** Whether a cooldown window is still open. */
export function isCoolingDown(
  lastFiredAt: string | null | undefined,
  cooldownMinutes: number,
  now: number = Date.now(),
): boolean {
  if (!lastFiredAt) return false;
  const last = Date.parse(lastFiredAt);
  if (Number.isNaN(last)) return false;
  return now - last < Math.max(cooldownMinutes, 0) * 60_000;
}

/** Whether a sustained breach has been held long enough to fire. */
export function hasDwelled(
  breachStartedAt: string | null | undefined,
  forSeconds: number | undefined,
  now: number = Date.now(),
): boolean {
  if (!forSeconds) return true;
  if (!breachStartedAt) return false;
  const started = Date.parse(breachStartedAt);
  if (Number.isNaN(started)) return false;
  return now - started >= forSeconds * 1000;
}

/** Severity for a threshold breach, matching the old engine's behaviour. */
export function severityForValue(
  value: number | null,
  explicit?: "info" | "warning" | "critical",
): "info" | "warning" | "critical" {
  if (explicit) return explicit;
  if (value !== null && value >= 95) return "critical";
  return "warning";
}
