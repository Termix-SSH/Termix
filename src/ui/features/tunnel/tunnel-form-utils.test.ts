import { describe, it, expect } from "vitest";
import {
  getTunnelTypeForMode,
  getTunnelPortLabels,
  getTunnelModeDescription,
} from "./tunnel-form-utils.js";

// A fake translate that echoes the key plus any interpolation args so we can
// assert which translation key + payload the helpers chose.
const t = (key: string, opts?: Record<string, string | number>) =>
  opts ? `${key}:${JSON.stringify(opts)}` : key;

describe("getTunnelTypeForMode", () => {
  it("maps remote to remote and everything else to local", () => {
    expect(getTunnelTypeForMode("remote")).toBe("remote");
    expect(getTunnelTypeForMode("local")).toBe("local");
    expect(getTunnelTypeForMode("dynamic")).toBe("local");
  });
});

describe("getTunnelPortLabels", () => {
  it("labels client local mode source/endpoint ports", () => {
    const labels = getTunnelPortLabels("client", "local", t);
    expect(labels.sourcePortLabel).toBe("tunnels.localPort");
    expect(labels.endpointPortLabel).toBe("tunnels.remotePort");
  });

  it("swaps labels for client remote mode", () => {
    const labels = getTunnelPortLabels("client", "remote", t);
    expect(labels.sourcePortLabel).toBe("tunnels.remotePort");
    expect(labels.endpointPortLabel).toBe("tunnels.localPort");
  });

  it("uses host/endpoint labels in server scope", () => {
    const labels = getTunnelPortLabels("server", "local", t);
    expect(labels.sourcePortLabel).toBe("tunnels.currentHostPort");
    expect(labels.endpointPortLabel).toBe("tunnels.endpointPort");
  });
});

describe("getTunnelModeDescription", () => {
  const ports = { sourcePort: 8080, endpointPort: 9090 };

  it("selects the client dynamic description with only the source port", () => {
    const desc = getTunnelModeDescription("client", "dynamic", ports, t);
    expect(desc).toContain("tunnels.forwardDescriptionClientDynamic");
    expect(desc).toContain("8080");
    expect(desc).not.toContain("9090");
  });

  it("selects the client local description with both ports", () => {
    const desc = getTunnelModeDescription("client", "local", ports, t);
    expect(desc).toContain("tunnels.forwardDescriptionClientLocal");
    expect(desc).toContain("8080");
    expect(desc).toContain("9090");
  });

  it("selects the server remote description", () => {
    const desc = getTunnelModeDescription("server", "remote", ports, t);
    expect(desc).toContain("tunnels.forwardDescriptionServerRemote");
  });
});
