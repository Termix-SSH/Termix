import { describe, expect, it } from "vitest";
import {
  getProxmoxSource,
  indexImportedGuests,
  proxmoxSourceKey,
} from "../../src/backend/guest-sync.js";

const source = {
  source: "proxmox",
  sourceHostId: 1,
  node: "pve",
  vmid: 101,
  type: "qemu",
};

describe("getProxmoxSource", () => {
  it("reads the source from an object or a JSON string", () => {
    expect(getProxmoxSource({ source })).toEqual(source);
    expect(getProxmoxSource(JSON.stringify({ source }))).toEqual(source);
  });

  it("refuses a malformed source", () => {
    expect(getProxmoxSource(null)).toBeNull();
    expect(getProxmoxSource({ source: { ...source, vmid: "101" } })).toBeNull();
    expect(getProxmoxSource({ source: { ...source, type: "vm" } })).toBeNull();
  });
});

describe("indexImportedGuests", () => {
  // The host row carries no proxmoxConfig since 2.9.0; the source only
  // exists in the plugin's host settings.
  const hosts = [
    { id: 10, name: "guest-a" },
    { id: 11, name: "guest-b" },
    { id: 12, name: "manual" },
  ];

  it("matches hosts to guests through their settings", () => {
    const index = indexImportedGuests(
      hosts,
      [
        { hostId: 10, value: { source, lastSyncAt: "x" } },
        { hostId: 11, value: { source: { ...source, sourceHostId: 2 } } },
      ],
      1,
    );
    expect([...index.keys()]).toEqual([proxmoxSourceKey(source as never)]);
    const entry = index.get("1:pve:qemu:101")!;
    expect(entry.host.id).toBe(10);
    expect(entry.config.lastSyncAt).toBe("x");
  });

  it("ignores settings for hosts the user does not own", () => {
    const index = indexImportedGuests(
      hosts,
      [{ hostId: 99, value: { source } }],
      1,
    );
    expect(index.size).toBe(0);
  });
});
