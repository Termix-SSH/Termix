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
  it("contains only ssh-terminal", () => {
    expect([...FIRST_PARTY_PLUGIN_IDS]).toEqual(["ssh-terminal"]);
  });

  it("recognises ssh-terminal and nothing else", () => {
    expect(isFirstParty("ssh-terminal")).toBe(true);
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

    // On the list but not asking for it: stays in a worker, so the manifest
    // remains an honest description of what the plugin does.
    expect(runsInProcess("ssh-terminal", ["hosts.read"])).toBe(false);

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

  it("still accepts an ordinary manifest that never mentions it", () => {
    const { manifest: parsed, errors } = parseManifest(
      manifest({ permissions: ["hosts.read"] }),
    );
    expect(errors).toEqual([]);
    expect(parsed?.id).toBe("sample-plugin");
  });
});
