import { describe, it, expect } from "vitest";
import {
  connectionLog,
  sudoPasswordOf,
  supportsMetrics,
  type MetricsHost,
} from "../../src/backend/helpers.js";
import { createFakeContext } from "@termix/plugin-sdk/testing";

const ssh = createFakeContext().ctx.ssh;

describe("supportsMetrics", () => {
  it("supports plain ssh hosts", () => {
    expect(
      supportsMetrics({ connectionType: "ssh", authType: "password" }, ssh),
    ).toBe(true);
  });

  it("defaults missing connectionType to ssh", () => {
    expect(supportsMetrics({ authType: "key" }, ssh)).toBe(true);
  });

  it("rejects remote desktop only hosts", () => {
    expect(supportsMetrics({ connectionType: "rdp" }, ssh)).toBe(false);
    expect(supportsMetrics({ connectionType: "vnc" }, ssh)).toBe(false);
    expect(supportsMetrics({ connectionType: "telnet" }, ssh)).toBe(false);
  });

  it("accepts a remote desktop host that also has ssh on", () => {
    expect(
      supportsMetrics(
        { connectionType: "rdp", enableSsh: true, authType: "password" },
        ssh,
      ),
    ).toBe(true);
  });

  it("rejects ssh hosts that cannot connect unattended", () => {
    expect(
      supportsMetrics({ connectionType: "ssh", authType: "none" }, ssh),
    ).toBe(false);
    expect(
      supportsMetrics({ connectionType: "ssh", authType: "opkssh" }, ssh),
    ).toBe(false);
  });
});

describe("connectionLog", () => {
  it("builds a log entry without id or timestamp", () => {
    const entry = connectionLog("info", "connection", "Connecting", {
      hostId: 1,
    });
    expect(entry).toEqual({
      type: "info",
      stage: "connection",
      message: "Connecting",
      details: { hostId: 1 },
    });
  });
});

describe("sudoPasswordOf", () => {
  const host = (extra: Partial<MetricsHost>) =>
    ({
      id: 1,
      ip: "h",
      port: 22,
      username: "u",
      userId: "o",
      ...extra,
    }) as MetricsHost;

  it("prefers the host's sudo password", () => {
    expect(
      sudoPasswordOf(
        host({ sudoPassword: "a", terminalConfig: { sudoPassword: "b" } }),
      ),
    ).toBe("a");
  });

  it("falls back to the terminal config", () => {
    expect(
      sudoPasswordOf(host({ terminalConfig: { sudoPassword: "b" } })),
    ).toBe("b");
    expect(sudoPasswordOf(host({}))).toBeUndefined();
  });
});
