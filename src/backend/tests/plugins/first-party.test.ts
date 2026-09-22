/**
 * The first-party tier is the one place in the plugin system where code runs
 * without the worker boundary, so the thing most worth testing is that it
 * cannot be entered by a plugin that says it should be.
 */

import { describe, expect, it } from "vitest";
import {
  FIRST_PARTY_PLUGIN_IDS,
  isFirstParty,
  runsInProcess,
  TRANSPORT_OWNER_CAPABILITY,
} from "../../plugins/first-party.js";
import {
  parseManifest,
  SUPPORTED_PLUGIN_API_VERSION,
} from "../../plugins/manifest.js";

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    id: "sample-plugin",
    name: "Sample Plugin",
    version: "1.0.0",
    description: "A plugin.",
    author: { name: "Someone" },
    license: "MIT",
    category: "Productivity",
    engine: { termix: ">=2.9.0", api: SUPPORTED_PLUGIN_API_VERSION },
    capabilities: {
      backend: true,
      frontend: false,
      electron: false,
      platforms: ["linux"],
    },
    permissions: [] as string[],
    sidecars: [],
    ...overrides,
  };
}

describe("first-party allowlist", () => {
  it("contains only ssh-terminal, docker, host-metrics, ai, proxmox, remote-desktop, fleets, automations, network-topology, tailscale, workspaces and web-endpoint", () => {
    expect([...FIRST_PARTY_PLUGIN_IDS].sort()).toEqual([
      "ai",
      "automations",
      "docker",
      "fleets",
      "host-metrics",
      "network-topology",
      "proxmox",
      "remote-desktop",
      "ssh-terminal",
      "tailscale",
      "web-endpoint",
      "workspaces",
    ]);
  });

  it("recognises ssh-terminal, docker, host-metrics, ai, proxmox, remote-desktop, fleets, automations, network-topology, tailscale, workspaces and web-endpoint and nothing else", () => {
    expect(isFirstParty("ssh-terminal")).toBe(true);
    expect(isFirstParty("docker")).toBe(true);
    expect(isFirstParty("host-metrics")).toBe(true);
    expect(isFirstParty("ai")).toBe(true);
    expect(isFirstParty("proxmox")).toBe(true);
    expect(isFirstParty("remote-desktop")).toBe(true);
    expect(isFirstParty("fleets")).toBe(true);
    expect(isFirstParty("automations")).toBe(true);
    expect(isFirstParty("network-topology")).toBe(true);
    expect(isFirstParty("tailscale")).toBe(true);
    expect(isFirstParty("workspaces")).toBe(true);
    expect(isFirstParty("web-endpoint")).toBe(true);
    expect(isFirstParty("ssh-terminal-pro")).toBe(false);
    expect(isFirstParty("community-plugin")).toBe(false);
    expect(isFirstParty("")).toBe(false);
  });
});

describe("runsInProcess", () => {
  it("requires both the allowlist and the declared capability", () => {
    expect(runsInProcess("ssh-terminal", [TRANSPORT_OWNER_CAPABILITY])).toBe(
      true,
    );
    expect(runsInProcess("docker", [TRANSPORT_OWNER_CAPABILITY])).toBe(true);
    expect(runsInProcess("host-metrics", [TRANSPORT_OWNER_CAPABILITY])).toBe(
      true,
    );
    expect(runsInProcess("ai", [TRANSPORT_OWNER_CAPABILITY])).toBe(true);
    expect(runsInProcess("proxmox", [TRANSPORT_OWNER_CAPABILITY])).toBe(true);
    expect(runsInProcess("remote-desktop", [TRANSPORT_OWNER_CAPABILITY])).toBe(
      true,
    );
    expect(runsInProcess("fleets", [TRANSPORT_OWNER_CAPABILITY])).toBe(true);
    expect(runsInProcess("automations", [TRANSPORT_OWNER_CAPABILITY])).toBe(
      true,
    );
    expect(
      runsInProcess("network-topology", [TRANSPORT_OWNER_CAPABILITY]),
    ).toBe(true);
    expect(runsInProcess("tailscale", [TRANSPORT_OWNER_CAPABILITY])).toBe(true);
    expect(runsInProcess("workspaces", [TRANSPORT_OWNER_CAPABILITY])).toBe(
      true,
    );
    expect(runsInProcess("web-endpoint", [TRANSPORT_OWNER_CAPABILITY])).toBe(
      true,
    );

    // On the list but not asking for it: stays in a worker, so the manifest
    // remains an honest description of what the plugin does.
    expect(runsInProcess("ssh-terminal", ["hosts.read"])).toBe(false);
    expect(runsInProcess("docker", ["hosts.read"])).toBe(false);
    expect(runsInProcess("host-metrics", ["hosts.read"])).toBe(false);
    expect(runsInProcess("ai", ["hosts.read"])).toBe(false);
    expect(runsInProcess("proxmox", ["hosts.read"])).toBe(false);
    expect(runsInProcess("remote-desktop", ["hosts.read"])).toBe(false);
    expect(runsInProcess("fleets", ["hosts.read"])).toBe(false);
    expect(runsInProcess("automations", ["hosts.read"])).toBe(false);
    expect(runsInProcess("network-topology", ["hosts.read"])).toBe(false);
    expect(runsInProcess("tailscale", ["hosts.read"])).toBe(false);
    expect(runsInProcess("workspaces", ["hosts.read"])).toBe(false);
    expect(runsInProcess("web-endpoint", ["hosts.read"])).toBe(false);

    // Asking for it but not on the list.
    expect(
      runsInProcess("community-plugin", [TRANSPORT_OWNER_CAPABILITY]),
    ).toBe(false);

    expect(runsInProcess("community-plugin", ["hosts.read"])).toBe(false);
  });
});

describe("manifest gate on the reserved capability", () => {
  it("refuses the capability for a plugin that is not first-party", () => {
    const { manifest: parsed, errors } = parseManifest(
      manifest({ permissions: [TRANSPORT_OWNER_CAPABILITY] }),
    );

    expect(parsed).toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(TRANSPORT_OWNER_CAPABILITY);
    expect(errors[0]).toContain("reserved for first-party plugins");
  });

  it("refuses it even when mixed in with ordinary permissions", () => {
    const { manifest: parsed } = parseManifest(
      manifest({
        permissions: ["hosts.read", TRANSPORT_OWNER_CAPABILITY, "storage.own"],
      }),
    );
    expect(parsed).toBeUndefined();
  });

  it("allows it for ssh-terminal", () => {
    const { manifest: parsed, errors } = parseManifest(
      manifest({
        id: "ssh-terminal",
        permissions: [TRANSPORT_OWNER_CAPABILITY],
      }),
    );

    expect(errors).toEqual([]);
    expect(parsed?.id).toBe("ssh-terminal");
  });

  it("allows it for docker", () => {
    const { manifest: parsed, errors } = parseManifest(
      manifest({
        id: "docker",
        permissions: [TRANSPORT_OWNER_CAPABILITY],
      }),
    );

    expect(errors).toEqual([]);
    expect(parsed?.id).toBe("docker");
  });

  it("allows it for host-metrics", () => {
    const { manifest: parsed, errors } = parseManifest(
      manifest({
        id: "host-metrics",
        permissions: [TRANSPORT_OWNER_CAPABILITY],
      }),
    );

    expect(errors).toEqual([]);
    expect(parsed?.id).toBe("host-metrics");
  });

  it("allows it for ai", () => {
    const { manifest: parsed, errors } = parseManifest(
      manifest({
        id: "ai",
        permissions: [TRANSPORT_OWNER_CAPABILITY],
      }),
    );

    expect(errors).toEqual([]);
    expect(parsed?.id).toBe("ai");
  });

  it("allows it for proxmox", () => {
    const { manifest: parsed, errors } = parseManifest(
      manifest({
        id: "proxmox",
        permissions: [TRANSPORT_OWNER_CAPABILITY],
      }),
    );

    expect(errors).toEqual([]);
    expect(parsed?.id).toBe("proxmox");
  });

  it("allows it for automations", () => {
    const { manifest: parsed, errors } = parseManifest(
      manifest({
        id: "automations",
        permissions: [TRANSPORT_OWNER_CAPABILITY],
      }),
    );

    expect(errors).toEqual([]);
    expect(parsed?.id).toBe("automations");
  });

  it("allows it for network-topology", () => {
    const { manifest: parsed, errors } = parseManifest(
      manifest({
        id: "network-topology",
        permissions: [TRANSPORT_OWNER_CAPABILITY],
      }),
    );

    expect(errors).toEqual([]);
    expect(parsed?.id).toBe("network-topology");
  });

  it("allows it for tailscale", () => {
    const { manifest: parsed, errors } = parseManifest(
      manifest({
        id: "tailscale",
        permissions: [TRANSPORT_OWNER_CAPABILITY],
      }),
    );

    expect(errors).toEqual([]);
    expect(parsed?.id).toBe("tailscale");
  });

  it("allows it for workspaces", () => {
    const { manifest: parsed, errors } = parseManifest(
      manifest({
        id: "workspaces",
        permissions: [TRANSPORT_OWNER_CAPABILITY],
      }),
    );

    expect(errors).toEqual([]);
    expect(parsed?.id).toBe("workspaces");
  });

  it("allows it for web-endpoint", () => {
    const { manifest: parsed, errors } = parseManifest(
      manifest({
        id: "web-endpoint",
        permissions: [TRANSPORT_OWNER_CAPABILITY],
      }),
    );

    expect(errors).toEqual([]);
    expect(parsed?.id).toBe("web-endpoint");
  });

  it("still accepts an ordinary manifest that never mentions it", () => {
    const { manifest: parsed, errors } = parseManifest(
      manifest({ permissions: ["hosts.read"] }),
    );
    expect(errors).toEqual([]);
    expect(parsed?.id).toBe("sample-plugin");
  });
});
