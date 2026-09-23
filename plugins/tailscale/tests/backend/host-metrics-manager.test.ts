import { describe, it, expect } from "vitest";
import { parseTailscaleData } from "../../src/backend/host-metrics-manager.js";

describe("parseTailscaleData", () => {
  it("reports not installed when the probe finds no binary", () => {
    const result = parseTailscaleData("ts_installed=0\n");
    expect(result.installed).toBe(false);
    expect(result.running).toBe(false);
  });

  it("parses a running tailscale status", () => {
    const status = JSON.stringify({
      BackendState: "Running",
      Self: { HostName: "my-server", TailscaleIPs: ["100.1.2.3"] },
      Peer: {
        abc: {
          HostName: "peer-1",
          TailscaleIPs: ["100.1.2.4"],
          Online: true,
          ExitNode: false,
        },
      },
      CurrentExitNode: "",
    });
    const result = parseTailscaleData(`ts_installed=1\n${status}`);

    expect(result.installed).toBe(true);
    expect(result.running).toBe(true);
    expect(result.hostname).toBe("my-server");
    expect(result.tailscaleIPs).toEqual(["100.1.2.3"]);
    expect(result.peers).toHaveLength(1);
    expect(result.peers[0]).toMatchObject({
      hostname: "peer-1",
      online: true,
    });
    expect(result.exitNodeInUse).toBe(false);
  });

  it("reports installed but not running on malformed JSON", () => {
    const result = parseTailscaleData("ts_installed=1\nnot json");
    expect(result.installed).toBe(true);
    expect(result.running).toBe(false);
  });

  it("detects an active exit node", () => {
    const status = JSON.stringify({
      BackendState: "Running",
      Self: {},
      Peer: {},
      CurrentExitNode: "abc123",
    });
    const result = parseTailscaleData(`ts_installed=1\n${status}`);
    expect(result.exitNodeInUse).toBe(true);
  });
});
