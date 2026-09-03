import { describe, expect, it } from "vitest";
import {
  normalizeClientTunnel,
  stripClientTunnelDiagnostics,
  type ClientTunnel,
} from "../../user/c2s-tunnel-config-utils.js";

describe("C2STunnelPresetManager tunnel normalization", () => {
  it("preserves explicit local and remote address fields in saved config", () => {
    const tunnel = normalizeClientTunnel({
      scope: "c2s",
      mode: "local",
      tunnelType: "local",
      localAddress: " 127.0.0.2 ",
      remoteAddress: " 10.10.0.25 ",
      sourceHostId: 42,
      sourceHostSyncId: "host-sync-42",
      sourcePort: 8080,
      endpointPort: 5432,
      maxRetries: 3,
      retryInterval: 10,
      autoStart: true,
    });

    const saved = stripClientTunnelDiagnostics(tunnel);

    expect(saved).toMatchObject({
      localAddress: "127.0.0.2",
      remoteAddress: "10.10.0.25",
      bindHost: "127.0.0.2",
      targetHost: "10.10.0.25",
      sourceHostId: 42,
      sourceHostSyncId: "host-sync-42",
      sourcePort: 8080,
      endpointPort: 5432,
    });
  });

  it("preserves source host sync identity for cross-device C2S presets", () => {
    const tunnel = normalizeClientTunnel({
      scope: "c2s",
      mode: "local",
      tunnelType: "local",
      localAddress: "127.0.0.1",
      remoteAddress: "10.0.0.25",
      sourceHostId: 5,
      sourceHostSyncId: "shared-host-sync-id",
      sourcePort: 8080,
      endpointPort: 80,
      maxRetries: 3,
      retryInterval: 10,
      autoStart: false,
    });

    const saved = stripClientTunnelDiagnostics(tunnel);

    expect(saved).toMatchObject({
      sourceHostId: 5,
      sourceHostSyncId: "shared-host-sync-id",
    });
  });

  it("normalizes legacy bindHost and targetHost configs into address fields", () => {
    const tunnel = normalizeClientTunnel({
      scope: "c2s",
      mode: "local",
      tunnelType: "local",
      bindHost: "127.0.0.3",
      targetHost: "172.16.1.50",
      sourceHostId: 7,
      sourcePort: 9000,
      endpointPort: 9443,
      maxRetries: 1,
      retryInterval: 5,
      autoStart: false,
    });

    expect(tunnel).toMatchObject({
      localAddress: "127.0.0.3",
      remoteAddress: "172.16.1.50",
      bindHost: "127.0.0.3",
      targetHost: "172.16.1.50",
    });
  });

  it("preserves tunnel name spacing while editing", () => {
    const tunnel = normalizeClientTunnel({
      scope: "c2s",
      mode: "local",
      tunnelType: "local",
      displayName: "Axolot ",
    });

    expect(tunnel.displayName).toBe("Axolot ");
  });

  it("trims tunnel names only when saving", () => {
    const tunnel = normalizeClientTunnel({
      scope: "c2s",
      mode: "local",
      tunnelType: "local",
      localAddress: "127.0.0.1",
      remoteAddress: "10.0.0.10",
      sourcePort: 8080,
      endpointPort: 80,
      displayName: " Axolot MO ",
    });

    const saved = stripClientTunnelDiagnostics(tunnel);

    expect(saved).toMatchObject({
      displayName: "Axolot MO",
    });
  });

  it("removes diagnostics without dropping routing fields", () => {
    const tunnel: ClientTunnel = {
      scope: "c2s",
      mode: "local",
      tunnelType: "local",
      localAddress: "127.0.0.1",
      remoteAddress: "10.0.0.10",
      bindHost: "127.0.0.1",
      targetHost: "10.0.0.10",
      sourceHostId: 1,
      sourcePort: 8080,
      endpointPort: 80,
      endpointHost: "edge",
      maxRetries: 3,
      retryInterval: 10,
      autoStart: false,
      displayName: "web",
      lastStartedAt: "2026-07-20T00:00:00.000Z",
      lastTestedAt: "2026-07-20T00:01:00.000Z",
      lastError: "previous error",
    };

    const saved = stripClientTunnelDiagnostics(tunnel);

    expect(saved).not.toHaveProperty("lastStartedAt");
    expect(saved).not.toHaveProperty("lastTestedAt");
    expect(saved).not.toHaveProperty("lastError");
    expect(saved).toMatchObject({
      localAddress: "127.0.0.1",
      remoteAddress: "10.0.0.10",
      sourceHostId: 1,
      sourcePort: 8080,
      endpointPort: 80,
    });
  });
});
