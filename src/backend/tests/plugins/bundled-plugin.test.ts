/**
 * The real bundled ssh-terminal plugin, as it ships.
 *
 * This reads plugins/ in the repo rather than a fixture: the manifest is a
 * checked-in artifact, and a typo in it would otherwise only show up at boot.
 */

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getBundledPluginsDir } from "../../plugins/paths.js";
import { parseManifest } from "../../plugins/manifest.js";
import {
  isFirstParty,
  runsInProcess,
  TRANSPORT_OWNER_CAPABILITY,
} from "../../plugins/first-party.js";

vi.mock("../../utils/logger.js", () => ({
  pluginLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

function readBundledManifest(pluginId: string): Record<string, unknown> {
  const file = path.join(getBundledPluginsDir(), pluginId, "manifest.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

describe("bundled ssh-terminal plugin", () => {
  it("ships a directory with a manifest and both entry points", () => {
    const dir = path.join(getBundledPluginsDir(), "ssh-terminal");

    expect(fs.existsSync(path.join(dir, "manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "backend", "index.mjs"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "frontend", "index.mjs"))).toBe(true);
  });

  it("has a manifest that passes the real validator", () => {
    const { manifest, errors } = parseManifest(
      readBundledManifest("ssh-terminal"),
    );

    expect(errors).toEqual([]);
    expect(manifest?.id).toBe("ssh-terminal");
    expect(manifest?.category).toBe("Terminal");
  });

  it("declares the transport-owner capability and qualifies for the tier", () => {
    const { manifest } = parseManifest(readBundledManifest("ssh-terminal"));

    expect(manifest?.permissions).toContain(TRANSPORT_OWNER_CAPABILITY);
    expect(isFirstParty("ssh-terminal")).toBe(true);
    expect(runsInProcess("ssh-terminal", manifest!.permissions)).toBe(true);
  });

  it("contributes the terminal tab the shell registers", () => {
    const { manifest } = parseManifest(readBundledManifest("ssh-terminal"));
    const tab = manifest?.contributes?.tabs?.[0];

    // The shell keys tab content off this id, so it has to stay "terminal".
    expect(tab?.id).toBe("terminal");
    expect(tab?.openFrom).toContain("rail");
  });

  it("exports activate and deactivate from its backend entry", () => {
    const entry = path.join(
      getBundledPluginsDir(),
      "ssh-terminal",
      "backend",
      "index.mjs",
    );
    const source = fs.readFileSync(entry, "utf8");

    // A first-party plugin owns a listening port, so deactivate is not
    // optional here the way it is for an ordinary plugin.
    expect(source).toMatch(/export async function activate/);
    expect(source).toMatch(/export async function deactivate/);
  });
});

describe("bundled docker plugin", () => {
  it("ships a directory with a manifest and both entry points", () => {
    const dir = path.join(getBundledPluginsDir(), "docker");

    expect(fs.existsSync(path.join(dir, "manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "backend", "index.mjs"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "frontend", "index.mjs"))).toBe(true);
  });

  it("has a manifest that passes the real validator", () => {
    const { manifest, errors } = parseManifest(readBundledManifest("docker"));

    expect(errors).toEqual([]);
    expect(manifest?.id).toBe("docker");
    expect(manifest?.category).toBe("Infrastructure");
  });

  it("declares the transport-owner capability and qualifies for the tier", () => {
    const { manifest } = parseManifest(readBundledManifest("docker"));

    expect(manifest?.permissions).toContain(TRANSPORT_OWNER_CAPABILITY);
    expect(isFirstParty("docker")).toBe(true);
    expect(runsInProcess("docker", manifest!.permissions)).toBe(true);
  });

  it("contributes the docker tab the shell registers", () => {
    const { manifest } = parseManifest(readBundledManifest("docker"));
    const tab = manifest?.contributes?.tabs?.[0];

    // The shell keys tab content off this id, so it has to stay "docker".
    expect(tab?.id).toBe("docker");
    expect(tab?.openFrom).toContain("host-context-menu");
  });

  it("declares the enableDocker host capability", () => {
    const { manifest } = parseManifest(readBundledManifest("docker"));

    expect(manifest?.contributes?.hostCapability?.key).toBe("enableDocker");
  });

  it("exports activate and deactivate from its backend entry", () => {
    const entry = path.join(
      getBundledPluginsDir(),
      "docker",
      "backend",
      "index.mjs",
    );
    const source = fs.readFileSync(entry, "utf8");

    expect(source).toMatch(/export async function activate/);
    expect(source).toMatch(/export async function deactivate/);
  });
});

describe("bundled host-metrics plugin", () => {
  it("ships a directory with a manifest and both entry points", () => {
    const dir = path.join(getBundledPluginsDir(), "host-metrics");

    expect(fs.existsSync(path.join(dir, "manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "backend", "index.mjs"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "frontend", "index.mjs"))).toBe(true);
  });

  it("has a manifest that passes the real validator", () => {
    const { manifest, errors } = parseManifest(
      readBundledManifest("host-metrics"),
    );

    expect(errors).toEqual([]);
    expect(manifest?.id).toBe("host-metrics");
    expect(manifest?.category).toBe("Monitoring");
  });

  it("declares the transport-owner capability and qualifies for the tier", () => {
    const { manifest } = parseManifest(readBundledManifest("host-metrics"));

    expect(manifest?.permissions).toContain(TRANSPORT_OWNER_CAPABILITY);
    expect(isFirstParty("host-metrics")).toBe(true);
    expect(runsInProcess("host-metrics", manifest!.permissions)).toBe(true);
  });

  it("contributes the host-metrics tab the shell registers", () => {
    const { manifest } = parseManifest(readBundledManifest("host-metrics"));
    const tab = manifest?.contributes?.tabs?.[0];

    // The shell keys tab content off this id, so it has to stay "host-metrics".
    expect(tab?.id).toBe("host-metrics");
    expect(tab?.openFrom).toContain("host-context-menu");
  });

  it("exports activate and deactivate from its backend entry", () => {
    const entry = path.join(
      getBundledPluginsDir(),
      "host-metrics",
      "backend",
      "index.mjs",
    );
    const source = fs.readFileSync(entry, "utf8");

    expect(source).toMatch(/export async function activate/);
    expect(source).toMatch(/export async function deactivate/);
  });
});

describe("bundled remote-desktop plugin", () => {
  it("ships a directory with a manifest and both entry points", () => {
    const dir = path.join(getBundledPluginsDir(), "remote-desktop");

    expect(fs.existsSync(path.join(dir, "manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "backend", "index.mjs"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "frontend", "index.mjs"))).toBe(true);
  });

  it("has a manifest that passes the real validator", () => {
    const { manifest, errors } = parseManifest(
      readBundledManifest("remote-desktop"),
    );

    expect(errors).toEqual([]);
    expect(manifest?.id).toBe("remote-desktop");
    expect(manifest?.category).toBe("Terminal");
  });

  it("declares the transport-owner capability and qualifies for the tier", () => {
    const { manifest } = parseManifest(readBundledManifest("remote-desktop"));

    expect(manifest?.permissions).toContain(TRANSPORT_OWNER_CAPABILITY);
    expect(isFirstParty("remote-desktop")).toBe(true);
    expect(runsInProcess("remote-desktop", manifest!.permissions)).toBe(true);
  });

  it("contributes the rdp/vnc/telnet tabs the shell registers", () => {
    const { manifest } = parseManifest(readBundledManifest("remote-desktop"));
    const tabIds = manifest?.contributes?.tabs?.map((tab) => tab.id);

    expect(tabIds).toEqual(["rdp", "vnc", "telnet"]);
  });

  it("declares three host capabilities as an array", () => {
    const { manifest } = parseManifest(readBundledManifest("remote-desktop"));
    const hostCapability = manifest?.contributes?.hostCapability;

    expect(Array.isArray(hostCapability)).toBe(true);
    expect(
      (hostCapability as Array<{ key: string }>).map((entry) => entry.key),
    ).toEqual(["enableRdp", "enableVnc", "enableTelnet"]);
  });

  it("exports activate and deactivate from its backend entry", () => {
    const entry = path.join(
      getBundledPluginsDir(),
      "remote-desktop",
      "backend",
      "index.mjs",
    );
    const source = fs.readFileSync(entry, "utf8");

    expect(source).toMatch(/export async function activate/);
    expect(source).toMatch(/export async function deactivate/);
  });
});

describe("bundled fleets plugin", () => {
  it("ships a directory with a manifest and both entry points", () => {
    const dir = path.join(getBundledPluginsDir(), "fleets");

    expect(fs.existsSync(path.join(dir, "manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "backend", "index.mjs"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "frontend", "index.mjs"))).toBe(true);
  });

  it("has a manifest that passes the real validator", () => {
    const { manifest, errors } = parseManifest(readBundledManifest("fleets"));

    expect(errors).toEqual([]);
    expect(manifest?.id).toBe("fleets");
    expect(manifest?.category).toBe("Infrastructure");
  });

  it("declares the transport-owner capability and qualifies for the tier", () => {
    const { manifest } = parseManifest(readBundledManifest("fleets"));

    expect(manifest?.permissions).toContain(TRANSPORT_OWNER_CAPABILITY);
    expect(isFirstParty("fleets")).toBe(true);
    expect(runsInProcess("fleets", manifest!.permissions)).toBe(true);
  });

  it("exports activate and deactivate from its backend entry", () => {
    const entry = path.join(
      getBundledPluginsDir(),
      "fleets",
      "backend",
      "index.mjs",
    );
    const source = fs.readFileSync(entry, "utf8");

    expect(source).toMatch(/export async function activate/);
    expect(source).toMatch(/export async function deactivate/);
  });
});

describe("bundled automations plugin", () => {
  it("ships a directory with a manifest and both entry points", () => {
    const dir = path.join(getBundledPluginsDir(), "automations");

    expect(fs.existsSync(path.join(dir, "manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "backend", "index.mjs"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "frontend", "index.mjs"))).toBe(true);
  });

  it("has a manifest that passes the real validator", () => {
    const { manifest, errors } = parseManifest(
      readBundledManifest("automations"),
    );

    expect(errors).toEqual([]);
    expect(manifest?.id).toBe("automations");
    expect(manifest?.category).toBe("Infrastructure");
  });

  it("declares the transport-owner capability and qualifies for the tier", () => {
    const { manifest } = parseManifest(readBundledManifest("automations"));

    expect(manifest?.permissions).toContain(TRANSPORT_OWNER_CAPABILITY);
    expect(isFirstParty("automations")).toBe(true);
    expect(runsInProcess("automations", manifest!.permissions)).toBe(true);
  });

  it("exports activate and deactivate from its backend entry", () => {
    const entry = path.join(
      getBundledPluginsDir(),
      "automations",
      "backend",
      "index.mjs",
    );
    const source = fs.readFileSync(entry, "utf8");

    expect(source).toMatch(/export async function activate/);
    expect(source).toMatch(/export async function deactivate/);
  });
});

describe("bundled network-topology plugin", () => {
  it("ships a directory with a manifest and both entry points", () => {
    const dir = path.join(getBundledPluginsDir(), "network-topology");

    expect(fs.existsSync(path.join(dir, "manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "backend", "index.mjs"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "frontend", "index.mjs"))).toBe(true);
  });

  it("has a manifest that passes the real validator", () => {
    const { manifest, errors } = parseManifest(
      readBundledManifest("network-topology"),
    );

    expect(errors).toEqual([]);
    expect(manifest?.id).toBe("network-topology");
    expect(manifest?.category).toBe("Infrastructure");
  });

  it("declares the transport-owner capability and qualifies for the tier", () => {
    const { manifest } = parseManifest(readBundledManifest("network-topology"));

    expect(manifest?.permissions).toContain(TRANSPORT_OWNER_CAPABILITY);
    expect(isFirstParty("network-topology")).toBe(true);
    expect(runsInProcess("network-topology", manifest!.permissions)).toBe(true);
  });

  it("contributes the network_graph tab the shell registers", () => {
    const { manifest } = parseManifest(readBundledManifest("network-topology"));
    const tab = manifest?.contributes?.tabs?.[0];

    // The shell keys tab content off this id, so it has to stay "network_graph".
    expect(tab?.id).toBe("network_graph");
    expect(tab?.openFrom).toContain("rail");
  });

  it("exports activate and deactivate from its backend entry", () => {
    const entry = path.join(
      getBundledPluginsDir(),
      "network-topology",
      "backend",
      "index.mjs",
    );
    const source = fs.readFileSync(entry, "utf8");

    expect(source).toMatch(/export async function activate/);
    expect(source).toMatch(/export async function deactivate/);
  });
});

describe("bundled workspaces plugin", () => {
  it("ships a directory with a manifest and both entry points", () => {
    const dir = path.join(getBundledPluginsDir(), "workspaces");

    expect(fs.existsSync(path.join(dir, "manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "backend", "index.mjs"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "frontend", "index.mjs"))).toBe(true);
  });

  it("has a manifest that passes the real validator", () => {
    const { manifest, errors } = parseManifest(
      readBundledManifest("workspaces"),
    );

    expect(errors).toEqual([]);
    expect(manifest?.id).toBe("workspaces");
    expect(manifest?.category).toBe("Productivity");
  });

  it("declares the transport-owner capability and qualifies for the tier", () => {
    const { manifest } = parseManifest(readBundledManifest("workspaces"));

    expect(manifest?.permissions).toContain(TRANSPORT_OWNER_CAPABILITY);
    expect(isFirstParty("workspaces")).toBe(true);
    expect(runsInProcess("workspaces", manifest!.permissions)).toBe(true);
  });

  it("exports activate and deactivate from its backend entry", () => {
    const entry = path.join(
      getBundledPluginsDir(),
      "workspaces",
      "backend",
      "index.mjs",
    );
    const source = fs.readFileSync(entry, "utf8");

    expect(source).toMatch(/export async function activate/);
    expect(source).toMatch(/export async function deactivate/);
  });
});
