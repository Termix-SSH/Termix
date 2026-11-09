import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { withPluginScope } from "@/plugin-host/scope";
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

afterEach(() => {
  cleanup();
  resetShellBridge();
});

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

describe("shell.editHost", () => {
  it("forwards saved host editing to the current shell", () => {
    const editHost = vi.fn();
    const openHostEditor = vi.fn();
    setShellCallbacks({ editHost, openHostEditor } as never);
    expect(shell.editHost).toBeTypeOf("function");
    const edit = shell.editHost!;
    edit(5);
    expect(editHost).toHaveBeenCalledWith(5);
    expect(openHostEditor).not.toHaveBeenCalled();
    const next = vi.fn();
    setShellCallbacks({ editHost: next } as never);
    edit(7);
    expect(next).toHaveBeenCalledWith(7);
    resetShellBridge();
    expect(() => edit(5)).not.toThrow();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("preserves editing through the scoped plugin view without exposing other settings", () => {
    const editHost = vi.fn();
    setShellCallbacks({ editHost } as never);
    let seen: Host | undefined;
    const View = withPluginScope(
      "fixture",
      ({ host, shell: bridge }: { host: Host; shell: typeof shell }) => {
        seen = host;
        return bridge.editHost
          ? createElement(
              "button",
              {
                onClick: () => bridge.editHost?.(Number(host.id)),
              },
              "Edit host",
            )
          : null;
      },
    );
    render(
      createElement(View, {
        host: {
          ...saved,
          pluginSettings: {
            fixture: { enabled: true },
            other: { enabled: false },
          },
        },
        shell,
      }),
    );
    fireEvent.click(screen.getByText("Edit host"));
    expect(editHost).toHaveBeenCalledWith(5);
    expect(seen?.id).toBe("5");
    expect(seen?.pluginSettings).toEqual({ fixture: { enabled: true } });
  });

  it("does not advertise editing when the mounted shell cannot edit hosts", () => {
    setShellCallbacks({ openHostEditor: vi.fn() } as never);
    expect(shell.editHost).toBeUndefined();
  });
});
