import { describe, expect, it } from "vitest";
import { tmuxMonitorEnabled } from "../../src/frontend/host-tmux-monitor";

describe("tmuxMonitorEnabled", () => {
  it("is false when there is no pluginSettings", () => {
    expect(tmuxMonitorEnabled(undefined)).toBe(false);
    expect(
      tmuxMonitorEnabled({ id: "1", name: "a", ip: "1.2.3.4", port: 22 }),
    ).toBe(false);
  });

  it("is false when another plugin's settings are present but not this one's", () => {
    expect(
      tmuxMonitorEnabled({
        id: "1",
        name: "a",
        ip: "1.2.3.4",
        port: 22,
        pluginSettings: { tunnels: { enableTunnel: true } },
      }),
    ).toBe(false);
  });

  it("is true only when enableTmuxMonitor is exactly true", () => {
    expect(
      tmuxMonitorEnabled({
        id: "1",
        name: "a",
        ip: "1.2.3.4",
        port: 22,
        pluginSettings: { "tmux-monitor": { enableTmuxMonitor: true } },
      }),
    ).toBe(true);
    expect(
      tmuxMonitorEnabled({
        id: "1",
        name: "a",
        ip: "1.2.3.4",
        port: 22,
        pluginSettings: { "tmux-monitor": { enableTmuxMonitor: "true" } },
      }),
    ).toBe(false);
  });
});
