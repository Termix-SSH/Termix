import { afterEach, describe, expect, it } from "vitest";
import {
  enabledHostProtocols,
  hostProtocolFlags,
  protocolPort,
  registerHostProtocol,
  withProtocolSettings,
  type HostProtocolDef,
} from "../../sidebar/host-protocols";

const desktop: HostProtocolDef = {
  id: "demo-desktop",
  pluginId: "demo",
  settingKey: "enableDemo",
  portKey: "demoPort",
  defaultPort: 3389,
  titleKey: "demo:title",
  icon: () => null,
};

let dispose: (() => void) | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
});

describe("host protocols", () => {
  it("reads a protocol's switch from its plugin's host settings", () => {
    dispose = registerHostProtocol(desktop);
    const host = {
      enableSsh: false,
      pluginSettings: { demo: { enableDemo: true } },
    };
    expect(hostProtocolFlags(host)).toEqual({
      enableSsh: false,
      enableDemo: true,
    });
    expect(enabledHostProtocols(host).map((p) => p.id)).toEqual([
      "demo-desktop",
    ]);
    expect(hostProtocolFlags(null)).toEqual({
      enableSsh: true,
      enableDemo: false,
    });
  });

  it("falls back to the default port", () => {
    expect(protocolPort({ demo: { demoPort: 3390 } }, desktop)).toBe(3390);
    expect(protocolPort({ demo: { demoPort: "x" } }, desktop)).toBe(3389);
    expect(protocolPort(undefined, desktop)).toBe(3389);
  });

  it("writes the editor's switches into each owner's settings", () => {
    dispose = registerHostProtocol(desktop);
    expect(
      withProtocolSettings(
        { demo: { demoPort: 3390 }, other: { a: 1 } },
        { enableSsh: true, enableDemo: true },
      ),
    ).toEqual({
      demo: { demoPort: 3390, enableDemo: true },
      other: { a: 1 },
    });
  });

  it("forgets a protocol once its plugin unregisters it", () => {
    dispose = registerHostProtocol(desktop);
    dispose();
    dispose = null;
    expect(
      enabledHostProtocols({ pluginSettings: { demo: { enableDemo: true } } }),
    ).toEqual([]);
  });
});
