import { describe, it, expect } from "vitest";
import type { Host } from "@/types/ui-types";
import { buildStatusTooltip, statusCheckEnabled } from "@/sidebar/tree/HostItem/HostItem";

// Minimal host factory – only the fields buildStatusTooltip reads.
function makeHost(overrides: Partial<Host> = {}): Host {
  return {
    id: 1,
    name: "test-host",
    ip: "127.0.0.1",
    username: "user",
    enableSsh: true,
    enableRdp: false,
    enableVnc: false,
    enableTelnet: false,
    statsConfig: { statusCheckEnabled: true },
    ...overrides,
  } as unknown as Host;
}

// Translator that returns human-readable labels, not key paths.
// This is what the review asked for: assert the rendered labels,
// not the key paths the translator falls back to when a resource is missing.
const t = (key: string): string =>
  ({
    "hosts.status.available": "Available",
    "hosts.status.reachable": "Reachable, not authenticated",
    "hosts.status.offline": "Offline",
    "hosts.status.monitoringDisabled": "Monitoring disabled",
  })[key] ?? key;

describe("buildStatusTooltip", () => {
  it("returns the translated 'Available' label for online status", () => {
    const host = makeHost();
    const tooltip = buildStatusTooltip(host, "online", t);
    expect(tooltip).toContain("Available");
    expect(tooltip).not.toContain("hosts.status.");
  });

  it("returns the translated 'Reachable, not authenticated' label for reachable status", () => {
    const host = makeHost();
    const tooltip = buildStatusTooltip(host, "reachable", t);
    expect(tooltip).toContain("Reachable, not authenticated");
    expect(tooltip).not.toContain("hosts.status.");
  });

  it("returns the translated 'Offline' label for offline status", () => {
    const host = makeHost();
    const tooltip = buildStatusTooltip(host, "offline", t);
    expect(tooltip).toContain("Offline");
    expect(tooltip).not.toContain("hosts.status.");
  });

  it("returns 'Monitoring disabled' when status check is disabled", () => {
    const host = makeHost({
      statsConfig: { statusCheckEnabled: false },
    });
    const tooltip = buildStatusTooltip(host, "online", t);
    expect(tooltip).toBe("Monitoring disabled");
  });

  it("includes protocol names in the tooltip when protocols are enabled", () => {
    const host = makeHost({
      enableSsh: true,
      enableRdp: true,
      enableVnc: false,
      enableTelnet: false,
    });
    const tooltip = buildStatusTooltip(host, "online", t);
    expect(tooltip).toContain("SSH");
    expect(tooltip).toContain("RDP");
    expect(tooltip).toContain("Available");
  });

  it("returns just the status label when no protocols are enabled", () => {
    const host = makeHost({
      enableSsh: false,
      enableRdp: false,
      enableVnc: false,
      enableTelnet: false,
    });
    const tooltip = buildStatusTooltip(host, "online", t);
    expect(tooltip).toBe("Available");
  });

  it("does not render key paths when a translator is supplied", () => {
    const host = makeHost();
    const tooltip = buildStatusTooltip(host, "online", t);
    // The tooltip must never show the raw key path – that means the
    // translation resource is missing, which is the bug #1265 fixed.
    expect(tooltip).not.toMatch(/hosts\.status\./);
  });
});

describe("statusCheckEnabled", () => {
  it("returns true when statusCheckEnabled is not set (default)", () => {
    const host = makeHost({ statsConfig: undefined });
    expect(statusCheckEnabled(host)).toBe(true);
  });

  it("returns false when statusCheckEnabled is explicitly false", () => {
    const host = makeHost({
      statsConfig: { statusCheckEnabled: false },
    });
    expect(statusCheckEnabled(host)).toBe(false);
  });
});
