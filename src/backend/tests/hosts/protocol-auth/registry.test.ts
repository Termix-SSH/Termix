import { afterEach, describe, expect, it } from "vitest";
import {
  findHostProtocol,
  isAuthOverrideProtocol,
  listHostProtocols,
  plainFieldKeys,
  secretFieldKeys,
  setHostProtocolSource,
  type DeclaredHostProtocol,
} from "../../../hosts/protocol-auth/registry.js";

const SPICE: DeclaredHostProtocol = {
  id: "spice",
  credentialFields: [{ key: "display" }, { key: "ticket", secret: true }],
  pluginId: "spice-plugin",
  pluginName: "Spice",
};

afterEach(() => setHostProtocolSource(() => []));

describe("the host protocol registry", () => {
  it("knows nothing until a manifest declares it", () => {
    expect(listHostProtocols()).toEqual([]);
    expect(findHostProtocol("spice")).toBeUndefined();
  });

  it("keeps the first plugin to declare an id", () => {
    setHostProtocolSource(() => [
      SPICE,
      { ...SPICE, pluginId: "late", pluginName: "Late" },
    ]);
    expect(listHostProtocols()).toHaveLength(1);
    expect(findHostProtocol("spice")?.pluginId).toBe("spice-plugin");
  });

  it("allows overrides for ssh and declared protocols only", () => {
    setHostProtocolSource(() => [SPICE]);
    expect(isAuthOverrideProtocol("ssh")).toBe(true);
    expect(isAuthOverrideProtocol("spice")).toBe(true);
    expect(isAuthOverrideProtocol("rdp")).toBe(false);
    expect(isAuthOverrideProtocol(7)).toBe(false);
  });

  it("splits declared fields into plain and secret", () => {
    expect(plainFieldKeys(SPICE)).toEqual(["display"]);
    expect(secretFieldKeys(SPICE)).toEqual(["ticket"]);
  });
});
