import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hostStatus,
  provideHostStatus,
  registerBuiltinHostStatusProvider,
  type HostStatusProvider,
} from "../../plugins/host-status-provider.js";

function fakeProvider(label: string): HostStatusProvider & {
  ports: string[];
} {
  const ports: string[] = [];
  return {
    ports,
    start: vi.fn(),
    stop: vi.fn(),
    get: (hostId) => ({ status: "online", lastChecked: `${label}:${hostId}` }),
    statusesFor: async () => new Map(),
    refresh: vi.fn(async () => {}),
    check: async (hostId) => ({
      status: "offline",
      lastChecked: `${label}:${hostId}`,
    }),
    reportLogin: vi.fn(),
    registerPort: (type) => {
      ports.push(`+${type}`);
      return () => ports.push(`-${type}`);
    },
    getIntervalSeconds: async () => 45,
    setIntervalSeconds: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  hostStatus.stop();
  registerBuiltinHostStatusProvider(null);
});

describe("host status provider", () => {
  it("answers unknown when nothing provides status", async () => {
    expect(hostStatus.get(1)).toBeNull();
    expect((await hostStatus.statusesFor("u", null)).size).toBe(0);
    expect(await hostStatus.check(1)).toBeNull();
    expect(await hostStatus.getIntervalSeconds()).toBe(30);
  });

  it("uses the built-in until a plugin provides", () => {
    const builtin = fakeProvider("builtin");
    registerBuiltinHostStatusProvider(builtin);
    expect(hostStatus.get(1)?.lastChecked).toBe("builtin:1");

    const plugin = fakeProvider("plugin");
    const remove = provideHostStatus("host-status", plugin);
    expect(hostStatus.get(1)?.lastChecked).toBe("plugin:1");

    remove();
    expect(hostStatus.get(1)?.lastChecked).toBe("builtin:1");
  });

  it("refuses a second provider", () => {
    const remove = provideHostStatus("one", fakeProvider("one"));
    expect(() => provideHostStatus("two", fakeProvider("two"))).toThrow(
      /already provided by plugin "one"/,
    );
    remove();
  });

  it("hands lifecycle over when the provider changes", () => {
    const builtin = fakeProvider("builtin");
    registerBuiltinHostStatusProvider(builtin);
    hostStatus.start();
    expect(builtin.start).toHaveBeenCalledTimes(1);

    const plugin = fakeProvider("plugin");
    const remove = provideHostStatus("host-status", plugin);
    expect(builtin.stop).toHaveBeenCalledTimes(1);
    expect(plugin.start).toHaveBeenCalledTimes(1);

    remove();
    expect(plugin.stop).toHaveBeenCalledTimes(1);
    expect(builtin.start).toHaveBeenCalledTimes(2);
  });

  it("keeps registered ports across a provider change", () => {
    const builtin = fakeProvider("builtin");
    registerBuiltinHostStatusProvider(builtin);
    const drop = hostStatus.registerPort("rdp", () => 3389);
    expect(builtin.ports).toEqual(["+rdp"]);

    const plugin = fakeProvider("plugin");
    const remove = provideHostStatus("host-status", plugin);
    expect(builtin.ports).toEqual(["+rdp", "-rdp"]);
    expect(plugin.ports).toEqual(["+rdp"]);

    drop();
    expect(plugin.ports).toEqual(["+rdp", "-rdp"]);
    remove();
  });
});
