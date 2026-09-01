import { describe, expect, it } from "vitest";
import {
  computeNextDueAt,
  isValidCron,
  isValidTimezone,
  nextCronRun,
  parseCron,
} from "../../automations/cron.js";

describe("parseCron", () => {
  it("rejects anything that is not five fields", () => {
    expect(() => parseCron("* * * *")).toThrow(/five fields/);
    expect(() => parseCron("* * * * * *")).toThrow(/five fields/);
  });

  it("expands wildcards, lists, ranges and steps", () => {
    const fields = parseCron("0,30 9-17 * * 1-5");
    expect([...fields.minutes]).toEqual([0, 30]);
    expect([...fields.hours]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect([...fields.daysOfWeek]).toEqual([1, 2, 3, 4, 5]);
    expect(fields.dowRestricted).toBe(true);
    expect(fields.domRestricted).toBe(false);
  });

  it("supports step syntax", () => {
    expect([...parseCron("*/15 * * * *").minutes]).toEqual([0, 15, 30, 45]);
  });

  it("accepts month and day names", () => {
    expect([...parseCron("0 0 1 jan *").months]).toEqual([1]);
    expect([...parseCron("0 0 * * sun").daysOfWeek]).toEqual([0]);
  });

  it("treats day 7 as Sunday", () => {
    expect([...parseCron("0 0 * * 7").daysOfWeek]).toEqual([0]);
  });

  it("rejects out of range values", () => {
    expect(() => parseCron("60 * * * *")).toThrow(/out of range/);
    expect(() => parseCron("* 24 * * *")).toThrow(/out of range/);
    expect(() => parseCron("* * 0 * *")).toThrow(/out of range/);
  });

  it("reports validity without throwing", () => {
    expect(isValidCron("*/5 * * * *")).toBe(true);
    expect(isValidCron("nonsense")).toBe(false);
  });
});

describe("nextCronRun", () => {
  it("finds the next matching minute", () => {
    const from = new Date(2026, 0, 1, 10, 3, 30);
    expect(nextCronRun("*/15 * * * *", from)).toEqual(
      new Date(2026, 0, 1, 10, 15, 0, 0),
    );
  });

  it("never returns the starting minute", () => {
    const from = new Date(2026, 0, 1, 10, 0, 0);
    expect(nextCronRun("0 * * * *", from)).toEqual(
      new Date(2026, 0, 1, 11, 0, 0, 0),
    );
  });

  it("rolls into the next day", () => {
    const from = new Date(2026, 0, 1, 23, 45, 0);
    expect(nextCronRun("0 2 * * *", from)).toEqual(
      new Date(2026, 0, 2, 2, 0, 0, 0),
    );
  });

  it("unions day-of-month and day-of-week when both are set", () => {
    // The 15th, or any Monday.
    const from = new Date(2026, 0, 1, 0, 0, 0);
    const next = nextCronRun("0 0 15 * 1", from);
    expect(next).not.toBeNull();
    const isFifteenth = next!.getDate() === 15;
    const isMonday = next!.getDay() === 1;
    expect(isFifteenth || isMonday).toBe(true);
  });

  it("gives up on a date that can never match", () => {
    expect(nextCronRun("0 0 30 2 *", new Date(2026, 0, 1))).toBeNull();
  });
});

describe("computeNextDueAt", () => {
  it("prefers an interval over a cron expression", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    expect(
      computeNextDueAt({ intervalSeconds: 300, cron: "0 0 * * *" }, from),
    ).toBe("2026-01-01T00:05:00.000Z");
  });

  it("falls back to cron", () => {
    const from = new Date(2026, 0, 1, 10, 0, 0);
    const due = computeNextDueAt({ cron: "30 10 * * *" }, from);
    expect(due).toBe(new Date(2026, 0, 1, 10, 30, 0, 0).toISOString());
  });

  it("returns null when nothing is scheduled", () => {
    expect(computeNextDueAt({})).toBeNull();
  });

  it("passes the zone through to the cron evaluation", () => {
    // 02:00 in Tokyo on 2026-06-02 is 17:00 UTC on 2026-06-01.
    const from = new Date("2026-06-01T00:00:00.000Z");
    expect(
      computeNextDueAt({ cron: "0 2 * * *", timezone: "Asia/Tokyo" }, from),
    ).toBe("2026-06-01T17:00:00.000Z");
  });

  it("ignores the zone for interval schedules", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    expect(
      computeNextDueAt({ intervalSeconds: 600, timezone: "Asia/Tokyo" }, from),
    ).toBe("2026-01-01T00:10:00.000Z");
  });
});

describe("time zone handling", () => {
  it("resolves a daily cron against the given zone", () => {
    const from = new Date("2026-06-01T00:00:00.000Z");
    // 09:30 New York in June (UTC-4) is 13:30 UTC.
    const next = nextCronRun("30 9 * * *", from, "America/New_York");
    expect(next?.toISOString()).toBe("2026-06-01T13:30:00.000Z");
  });

  it("tracks daylight saving, so the UTC instant shifts by an hour", () => {
    const summer = nextCronRun(
      "0 12 * * *",
      new Date("2026-07-01T00:00:00.000Z"),
      "America/New_York",
    );
    const winter = nextCronRun(
      "0 12 * * *",
      new Date("2026-01-01T00:00:00.000Z"),
      "America/New_York",
    );

    // Noon local both times, but UTC-4 in July and UTC-5 in January.
    expect(summer?.toISOString()).toBe("2026-07-01T16:00:00.000Z");
    expect(winter?.toISOString()).toBe("2026-01-01T17:00:00.000Z");
  });

  it("matches the day of week in the target zone, not the server's", () => {
    // 23:00 UTC Sunday is already Monday in Tokyo.
    const next = nextCronRun(
      "0 8 * * mon",
      new Date("2026-06-07T22:00:00.000Z"),
      "Asia/Tokyo",
    );
    expect(next?.toISOString()).toBe("2026-06-07T23:00:00.000Z");
  });

  it("falls back to server time for an unknown zone instead of throwing", () => {
    const from = new Date(2026, 0, 1, 10, 0, 0);
    const next = nextCronRun("30 10 * * *", from, "Not/AZone");
    expect(next).toEqual(new Date(2026, 0, 1, 10, 30, 0, 0));
  });

  it("handles midnight, which some hour cycles format as 24", () => {
    const next = nextCronRun(
      "0 0 * * *",
      new Date("2026-06-01T10:00:00.000Z"),
      "UTC",
    );
    expect(next?.toISOString()).toBe("2026-06-02T00:00:00.000Z");
  });
});

describe("isValidTimezone", () => {
  it("accepts real zones", () => {
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("Europe/London")).toBe(true);
  });

  it("rejects made-up ones", () => {
    expect(isValidTimezone("Middle/Earth")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });
});
