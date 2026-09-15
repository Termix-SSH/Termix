import { describe, expect, it } from "vitest";
import {
  parseProxmoxJumpHosts,
  serializeProxmoxJumpHosts,
} from "../../../database/routes/proxmox-jump-hosts.js";

describe("Proxmox jump-host persistence", () => {
  const jumpHosts = [{ hostId: 7 }, { hostId: 9 }];

  it("serializes resolved arrays before inserting a synced guest", () => {
    expect(serializeProxmoxJumpHosts(jumpHosts)).toBe(
      '[{"hostId":7},{"hostId":9}]',
    );
  });

  it("keeps stored JSON strings stable", () => {
    const stored = '[{"hostId":7}]';
    expect(serializeProxmoxJumpHosts(stored)).toBe(stored);
    expect(parseProxmoxJumpHosts(stored)).toEqual([{ hostId: 7 }]);
  });

  it("turns missing or malformed values into null", () => {
    expect(serializeProxmoxJumpHosts(null)).toBeNull();
    expect(serializeProxmoxJumpHosts("invalid")).toBeNull();
  });
});
