import { describe, expect, it } from "vitest";
import { parseServerTime } from "@/lib/server-time";

describe("parseServerTime", () => {
  it("reads a zone-less SQLite timestamp as UTC", () => {
    expect(parseServerTime("2026-10-09 23:11:54").toISOString()).toBe(
      "2026-10-09T23:11:54.000Z",
    );
  });

  it("keeps timestamps that already carry a zone", () => {
    expect(parseServerTime("2026-10-09T22:05:30.871Z").toISOString()).toBe(
      "2026-10-09T22:05:30.871Z",
    );
    expect(parseServerTime("2026-10-09T23:00:00+02:00").toISOString()).toBe(
      "2026-10-09T21:00:00.000Z",
    );
  });
});
