import { describe, expect, it } from "vitest";
import { parseProxmoxJumpHosts } from "../../src/backend/proxmox-jump-hosts.js";

describe("Proxmox jump-host persistence", () => {
  it("reads a resolved array or a stored JSON string", () => {
    expect(parseProxmoxJumpHosts([{ hostId: 7 }])).toEqual([{ hostId: 7 }]);
    expect(parseProxmoxJumpHosts('[{"hostId":7}]')).toEqual([{ hostId: 7 }]);
  });

  it("turns missing or malformed values into null", () => {
    expect(parseProxmoxJumpHosts(null)).toBeNull();
    expect(parseProxmoxJumpHosts("invalid")).toBeNull();
  });
});
