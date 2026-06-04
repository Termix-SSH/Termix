import { describe, it, expect } from "vitest";
import {
  supportsMetrics,
  isTcpPingEnabled,
  createConnectionLog,
} from "./server-stats-helpers.js";

describe("supportsMetrics", () => {
  it("supports plain ssh hosts", () => {
    expect(
      supportsMetrics({ connectionType: "ssh", authType: "password" }),
    ).toBe(true);
  });

  it("defaults missing connectionType to ssh", () => {
    expect(supportsMetrics({ authType: "key" })).toBe(true);
  });

  it("rejects non-ssh connection types", () => {
    expect(supportsMetrics({ connectionType: "rdp" })).toBe(false);
    expect(supportsMetrics({ connectionType: "vnc" })).toBe(false);
  });

  it("rejects ssh hosts that cannot run shell commands", () => {
    expect(supportsMetrics({ connectionType: "ssh", authType: "none" })).toBe(
      false,
    );
    expect(supportsMetrics({ connectionType: "ssh", authType: "opkssh" })).toBe(
      false,
    );
  });
});

describe("isTcpPingEnabled", () => {
  it("is enabled when status checks are on and tcp ping is not disabled", () => {
    expect(
      isTcpPingEnabled({ statusCheckEnabled: true, disableTcpPing: false }),
    ).toBe(true);
    expect(isTcpPingEnabled({ statusCheckEnabled: true })).toBe(true);
  });

  it("is disabled when status checks are off", () => {
    expect(isTcpPingEnabled({ statusCheckEnabled: false })).toBe(false);
  });

  it("is disabled when tcp ping is explicitly disabled", () => {
    expect(
      isTcpPingEnabled({ statusCheckEnabled: true, disableTcpPing: true }),
    ).toBe(false);
  });
});

describe("createConnectionLog", () => {
  it("builds a log entry without id/timestamp", () => {
    const entry = createConnectionLog("info", "connection", "Connecting", {
      hostId: 1,
    });
    expect(entry).toEqual({
      type: "info",
      stage: "connection",
      message: "Connecting",
      details: { hostId: 1 },
    });
    expect("id" in entry).toBe(false);
    expect("timestamp" in entry).toBe(false);
  });
});
