import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetShellBridge,
  setShellCallbacks,
  setShellHosts,
  shell,
  withShellHost,
} from "@/plugin-host/shell-bridge";
import type { Host } from "@/types/ui-types";

const saved = {
  id: "5",
  name: "db",
  ip: "10.0.0.5",
  port: 22,
  username: "root",
  useSocks5: true,
  socks5Host: "proxy",
} as unknown as Host;

afterEach(() => resetShellBridge());

describe("withShellHost", () => {
  it("fills a typed record back in from the shell's own host", () => {
    setShellHosts([saved]);
    const merged = withShellHost({
      id: "5",
      name: "db (renamed)",
      notes: undefined,
    } as unknown as Host);
    expect(merged).toMatchObject({
      name: "db (renamed)",
      useSocks5: true,
      socks5Host: "proxy",
    });
  });

  it("keeps a host the shell does not list as it is", () => {
    setShellHosts([saved]);
    const quick = { id: "quick-connect-1", ip: "1.2.3.4" } as unknown as Host;
    expect(withShellHost(quick)).toBe(quick);
    expect(withShellHost(null)).toBeNull();
  });

  it("is what shell.openTab hands the mounted shell", () => {
    setShellHosts([saved]);
    const openTab = vi.fn();
    setShellCallbacks({ openTab } as never);
    shell.openTab({ id: "5", name: "db" } as unknown as Host, "terminal");
    expect(openTab.mock.calls[0][0]).toMatchObject({ socks5Host: "proxy" });
  });
});
