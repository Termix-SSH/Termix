import { describe, expect, it } from "vitest";
import {
  formatSqlTimestamp,
  sqlTimestampDaysAgo,
} from "../../../database/repositories/sql-timestamp.js";

describe("sql timestamps", () => {
  it("matches the CURRENT_TIMESTAMP text format", () => {
    expect(formatSqlTimestamp(new Date("2026-07-28T01:23:45.678Z"))).toBe(
      "2026-07-28 01:23:45",
    );
  });

  it("subtracts whole days in UTC", () => {
    const now = new Date("2026-07-28T01:23:45.000Z");

    expect(sqlTimestampDaysAgo(7, now)).toBe("2026-07-21 01:23:45");
    expect(sqlTimestampDaysAgo(30, now)).toBe("2026-06-28 01:23:45");
    expect(sqlTimestampDaysAgo(0, now)).toBe("2026-07-28 01:23:45");
  });

  it("crosses month and year boundaries", () => {
    expect(sqlTimestampDaysAgo(1, new Date("2026-01-01T00:00:00.000Z"))).toBe(
      "2025-12-31 00:00:00",
    );
  });

  it("stays lexicographically ordered, which is what the cutoff comparison relies on", () => {
    const now = new Date("2026-07-28T01:23:45.000Z");
    const older = sqlTimestampDaysAgo(30, now);
    const newer = sqlTimestampDaysAgo(7, now);

    expect(older < newer).toBe(true);
    expect(newer < formatSqlTimestamp(now)).toBe(true);
  });
});
