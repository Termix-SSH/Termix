import type { MaintenancePlan, HostMaintenance } from "../maintenance.js";

export class MaintenanceInputError extends Error {}

const DAY = 86_400_000;
const WEEK = 7 * DAY;

/** UTC wall-clock recurrence; monthly dates missing from a month are skipped. */
export function nextOccurrence(
  plan: MaintenancePlan,
  after: number,
): number | null {
  const first = Date.parse(plan.start);
  if (first > after) return first;
  if (plan.recurrence === "once") return null;
  if (plan.recurrence === "weekly") {
    return first + (Math.floor((after - first) / WEEK) + 1) * WEEK;
  }
  const start = new Date(first);
  const from = new Date(after);
  let month = from.getUTCFullYear() * 12 + from.getUTCMonth();
  for (let i = 0; i < 14; i++, month++) {
    const candidate = Date.UTC(
      Math.floor(month / 12),
      month % 12,
      start.getUTCDate(),
      start.getUTCHours(),
      start.getUTCMinutes(),
    );
    if (new Date(candidate).getUTCMonth() === month % 12 && candidate > after)
      return candidate;
  }
  throw new MaintenanceInputError("Cannot calculate maintenance recurrence");
}

/** Exhaust a Gregorian cycle for recurring pairs, not an arbitrary lookahead. */
export function plansOverlap(a: MaintenancePlan, b: MaintenancePlan): boolean {
  const start = Math.max(Date.parse(a.start), Date.parse(b.start));
  const end =
    a.recurrence === "once" || b.recurrence === "once"
      ? start + WEEK
      : start + 146097 * DAY + WEEK;
  let left = nextOccurrence(a, start - WEEK - 1);
  let right = nextOccurrence(b, start - WEEK - 1);
  while (left !== null && right !== null && left <= end && right <= end) {
    const leftEnd = left + a.durationMinutes * 60_000;
    const rightEnd = right + b.durationMinutes * 60_000;
    if (left < rightEnd && right < leftEnd) return true;
    if (leftEnd <= right) left = nextOccurrence(a, left);
    else right = nextOccurrence(b, right);
  }
  return false;
}

export function beginMaintenance(
  state: HostMaintenance,
  plan: MaintenancePlan,
  start: number,
): void {
  const end = new Date(start + plan.durationMinutes * 60_000).toISOString();
  const current = state.active;
  state.active = {
    startedAt: new Date(
      Math.min(start, current ? Date.parse(current.startedAt) : start),
    ).toISOString(),
    reasons: [...new Set([...(current?.reasons ?? []), plan.reason])].slice(
      -20,
    ),
    estimatedEnd:
      current && current.estimatedEnd > end ? current.estimatedEnd : end,
    graceMinutes: Math.max(current?.graceMinutes ?? 0, plan.graceMinutes),
    notifyOverdue: !!current?.notifyOverdue || plan.notifyOverdue,
    notified: current && current.estimatedEnd >= end ? current.notified : false,
  };
}

/** Catch up after downtime, preserving maintenance until explicitly ended. */
export function advanceMaintenance(state: HostMaintenance, now: number): void {
  for (const plan of state.plans) {
    if (!plan.nextStart || Date.parse(plan.nextStart) > now) continue;
    let due = Date.parse(plan.nextStart);
    let next = nextOccurrence(plan, due);
    while (next !== null && next <= now) {
      due = next;
      next = nextOccurrence(plan, due);
    }
    beginMaintenance(state, plan, due);
    plan.nextStart = next === null ? null : new Date(next).toISOString();
  }
}

export function parsePlan(
  input: unknown,
  now: number,
  immediate = false,
): MaintenancePlan {
  if (!input || typeof input !== "object")
    throw new MaintenanceInputError("Invalid maintenance plan");
  const value = input as Record<string, unknown>;
  const reason = typeof value.reason === "string" ? value.reason.trim() : "";
  const start = immediate
    ? now
    : typeof value.start === "string"
      ? Date.parse(value.start)
      : NaN;
  const duration = value.durationMinutes;
  const grace = value.graceMinutes;
  const recurrence = immediate ? "once" : value.recurrence;
  if (!reason || reason.length > 200)
    throw new MaintenanceInputError("Reason must contain 1 to 200 characters");
  if (
    !Number.isFinite(start) ||
    (!immediate && start <= now) ||
    start > now + 366 * 10 * DAY
  ) {
    throw new MaintenanceInputError(
      "Start must be a future time within ten years",
    );
  }
  if (
    typeof duration !== "number" ||
    !Number.isInteger(duration) ||
    duration < 1 ||
    duration > 10080
  ) {
    throw new MaintenanceInputError(
      "Estimated duration must be 1 to 10080 minutes",
    );
  }
  if (
    typeof grace !== "number" ||
    !Number.isInteger(grace) ||
    grace < 0 ||
    grace > 1440
  ) {
    throw new MaintenanceInputError("Grace period must be 0 to 1440 minutes");
  }
  if (!["once", "weekly", "monthly"].includes(String(recurrence)))
    throw new MaintenanceInputError("Invalid recurrence");
  if (typeof value.notifyOverdue !== "boolean")
    throw new MaintenanceInputError("Invalid overdue notification setting");
  const iso = new Date(start).toISOString();
  if (!immediate && start % 60_000 !== 0)
    throw new MaintenanceInputError("Start must use whole minutes");
  return {
    id: "",
    reason,
    start: iso,
    durationMinutes: duration,
    graceMinutes: grace,
    recurrence: recurrence as MaintenancePlan["recurrence"],
    notifyOverdue: value.notifyOverdue,
    nextStart: iso,
  };
}
