import { describe, expect, it } from "vitest";
import {
  advanceMaintenance,
  beginMaintenance,
  nextOccurrence,
  parsePlan,
  plansOverlap,
} from "../../src/backend/maintenance-time.js";
import {
  emptyMaintenance,
  type MaintenancePlan,
} from "../../src/maintenance.js";

const at = (value: string) => Date.parse(value);
const plan = (overrides: Partial<MaintenancePlan> = {}): MaintenancePlan => ({
  id: "one",
  reason: "Upgrade",
  start: "2026-01-31T21:00:00.000Z",
  nextStart: "2026-01-31T21:00:00.000Z",
  durationMinutes: 60,
  recurrence: "once",
  graceMinutes: 20,
  notifyOverdue: true,
  ...overrides,
});

describe("maintenance calendar", () => {
  it("keeps weekly UTC time across DST and skips missing monthly days", () => {
    expect(
      new Date(
        nextOccurrence(
          plan({ recurrence: "weekly" }),
          at("2026-03-28T21:00Z"),
        )!,
      ).toISOString(),
    ).toBe("2026-04-04T21:00:00.000Z");
    expect(
      new Date(
        nextOccurrence(
          plan({ recurrence: "monthly" }),
          at("2026-01-31T21:00Z"),
        )!,
      ).toISOString(),
    ).toBe("2026-03-31T21:00:00.000Z");
    expect(nextOccurrence(plan(), at("2026-01-31T21:00Z"))).toBeNull();
  });
  it("rejects actual overlaps and accepts touching windows", () => {
    expect(plansOverlap(plan(), plan({ start: "2026-01-31T21:59:00Z" }))).toBe(
      true,
    );
    expect(plansOverlap(plan(), plan({ start: "2026-01-31T22:00:00Z" }))).toBe(
      false,
    );
    expect(
      plansOverlap(
        plan({ recurrence: "monthly" }),
        plan({ start: "2030-03-31T21:30:00Z" }),
      ),
    ).toBe(true);
    expect(
      plansOverlap(
        plan({ recurrence: "weekly" }),
        plan({ recurrence: "monthly", start: "2026-03-31T21:30:00Z" }),
      ),
    ).toBe(true);
    expect(
      plansOverlap(
        plan({ recurrence: "weekly" }),
        plan({ recurrence: "monthly", start: "2026-03-31T23:00:00Z" }),
      ),
    ).toBe(false);
  });
  it("does not end at ETM and merges a later nonoverlapping schedule", () => {
    const state = emptyMaintenance();
    state.plans = [
      plan(),
      plan({
        id: "two",
        reason: "Firmware",
        start: "2026-01-31T22:30:00Z",
        nextStart: "2026-01-31T22:30:00Z",
      }),
    ];
    advanceMaintenance(state, at("2026-01-31T22:15Z"));
    expect(state.active?.estimatedEnd).toBe("2026-01-31T22:00:00.000Z");
    advanceMaintenance(state, at("2026-01-31T22:45Z"));
    expect(state.active?.startedAt).toBe("2026-01-31T21:00:00.000Z");
    expect(state.active?.estimatedEnd).toBe("2026-01-31T23:30:00.000Z");
    expect(state.active?.reasons).toEqual(["Upgrade", "Firmware"]);
    advanceMaintenance(state, at("2026-02-02T00:00Z"));
    expect(state.active).not.toBeNull();
  });
  it("catches up after restart and never re-enters a consumed one-time plan", () => {
    const state = emptyMaintenance();
    state.plans = [plan({ recurrence: "monthly" })];
    advanceMaintenance(state, at("2026-05-01T00:00Z"));
    expect(state.active?.startedAt).toBe("2026-03-31T21:00:00.000Z");
    expect(state.plans[0].nextStart).toBe("2026-05-31T21:00:00.000Z");
    state.active = null;
    advanceMaintenance(state, at("2026-05-01T00:00Z"));
    expect(state.active).toBeNull();
  });
  it("preserves a delivered reminder unless a later estimate extends maintenance", () => {
    const state = emptyMaintenance();
    beginMaintenance(state, plan(), at("2026-01-31T21:00Z"));
    state.active!.notified = true;
    beginMaintenance(
      state,
      plan({ durationMinutes: 10 }),
      at("2026-01-31T21:05Z"),
    );
    expect(state.active!.notified).toBe(true);
    beginMaintenance(state, plan(), at("2026-01-31T22:30Z"));
    expect(state.active!.notified).toBe(false);
  });
  it.each([
    { reason: " " },
    { durationMinutes: 0 },
    { durationMinutes: 10081 },
    { graceMinutes: -1 },
    { recurrence: "daily" },
    { notifyOverdue: "true" },
    { start: "2020-01-01T00:00Z" },
    { start: "2026-01-31T21:00:01Z" },
  ])("rejects invalid input %j", (override) => {
    expect(() =>
      parsePlan(plan(override as never), at("2026-01-01T00:00Z")),
    ).toThrow();
  });
});
