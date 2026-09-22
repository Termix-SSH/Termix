/**
 * Disabling a plugin has to remove the surfaces it owns, and disabling one
 * plugin must not touch another's.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { Puzzle } from "lucide-react";
import {
  applyPluginState,
  isPluginEnabled,
  isTabTypeAvailable,
  resetPluginState,
} from "@/shell/pluginLoader";
import {
  registerRailItem,
  unregisterRailItem,
  visibleRailItems,
} from "@/sidebar/rail-items";
import type { PluginSummary } from "@/api/plugins-api";

vi.mock("@/api/plugins-api", () => ({
  getPlugins: vi.fn().mockResolvedValue([]),
  setPluginEnabled: vi.fn(),
}));

function plugin(overrides: Partial<PluginSummary> = {}): PluginSummary {
  return {
    id: "ssh-terminal",
    name: "SSH Terminal",
    version: "1.0.0",
    tier: "bundled",
    source: "bundled",
    enabled: true,
    state: "active",
    lastError: null,
    contributes: {
      tabs: [
        {
          id: "terminal",
          titleKey: "nav.terminal",
          icon: "SquareTerminal",
          openFrom: ["host-context-menu", "palette"],
        },
      ],
    },
    capabilities: [],
    grantedCapabilities: [],
    ...overrides,
  };
}

function aiPlugin(overrides: Partial<PluginSummary> = {}): PluginSummary {
  return plugin({
    id: "ai",
    name: "AI Assistant",
    contributes: {
      tabs: [
        {
          id: "ai",
          titleKey: "nav.ai",
          icon: "Sparkles",
          openFrom: ["rail", "palette"],
        },
      ],
    },
    ...overrides,
  });
}

function remoteDesktopPlugin(
  overrides: Partial<PluginSummary> = {},
): PluginSummary {
  return plugin({
    id: "remote-desktop",
    name: "Remote Desktop",
    contributes: {
      tabs: [
        {
          id: "rdp",
          titleKey: "hosts.tabRdp",
          icon: "Monitor",
          openFrom: ["host-context-menu", "palette"],
        },
        {
          id: "vnc",
          titleKey: "hosts.tabVnc",
          icon: "MousePointerClick",
          openFrom: ["host-context-menu", "palette"],
        },
        {
          id: "telnet",
          titleKey: "hosts.tabTelnet",
          icon: "Terminal",
          openFrom: ["host-context-menu", "palette"],
        },
      ],
    },
    ...overrides,
  });
}

describe("plugin state applied to the shell", () => {
  afterEach(() => {
    resetPluginState();
    unregisterRailItem("other-plugin-tab");
  });

  it("allows terminal tabs while the plugin is enabled", () => {
    applyPluginState([plugin({ enabled: true })]);
    expect(isTabTypeAvailable("terminal")).toBe(true);
  });

  it("blocks terminal tabs when the plugin is disabled", () => {
    applyPluginState([plugin({ enabled: false })]);
    expect(isTabTypeAvailable("terminal")).toBe(false);
  });

  it("allows them again when the plugin is re-enabled", () => {
    applyPluginState([plugin({ enabled: false })]);
    expect(isTabTypeAvailable("terminal")).toBe(false);

    applyPluginState([plugin({ enabled: true })]);
    expect(isTabTypeAvailable("terminal")).toBe(true);
  });

  it("leaves unrelated tab types alone", () => {
    applyPluginState([plugin({ enabled: false })]);

    // Disabling the terminal must not take the rest of the app with it.
    for (const type of ["files", "docker", "tunnel", "rdp", "host-metrics"]) {
      expect(isTabTypeAvailable(type)).toBe(true);
    }
  });

  it("leaves another plugin's rail item alone when the terminal is disabled", () => {
    registerRailItem({
      id: "other-plugin-tab",
      icon: Puzzle,
      labelKey: "nav.otherPlugin",
      kind: "tab",
    });

    applyPluginState([
      plugin({ enabled: false }),
      plugin({
        id: "other-plugin",
        name: "Other",
        tier: "community",
        source: "registry",
        enabled: true,
        contributes: null,
      }),
    ]);

    expect(isTabTypeAvailable("terminal")).toBe(false);
    // The core ask: disabling one plugin must not disturb another.
    expect(visibleRailItems().map((i) => i.id)).toContain("other-plugin-tab");
  });

  it("unregisters a plugin-registered tab when that plugin is disabled", () => {
    registerRailItem({
      id: "other-plugin-tab",
      icon: Puzzle,
      labelKey: "nav.otherPlugin",
      kind: "tab",
    });
    expect(visibleRailItems().map((i) => i.id)).toContain("other-plugin-tab");

    applyPluginState([
      plugin({
        id: "other-plugin",
        name: "Other",
        enabled: false,
        contributes: {
          tabs: [
            {
              id: "other-plugin-tab",
              titleKey: "nav.otherPlugin",
              icon: "Puzzle",
              openFrom: ["rail"],
            },
          ],
        },
      }),
    ]);

    expect(visibleRailItems().map((i) => i.id)).not.toContain(
      "other-plugin-tab",
    );
  });

  it("allows the ai tab while the plugin is enabled", () => {
    applyPluginState([aiPlugin({ enabled: true })]);
    expect(isTabTypeAvailable("ai")).toBe(true);
  });

  it("blocks the ai tab when the plugin is disabled", () => {
    applyPluginState([aiPlugin({ enabled: false })]);
    expect(isTabTypeAvailable("ai")).toBe(false);
  });

  it("allows the ai tab again when the plugin is re-enabled", () => {
    applyPluginState([aiPlugin({ enabled: false })]);
    expect(isTabTypeAvailable("ai")).toBe(false);

    applyPluginState([aiPlugin({ enabled: true })]);
    expect(isTabTypeAvailable("ai")).toBe(true);
  });

  it("disabling ai does not affect the terminal, and vice versa", () => {
    applyPluginState([aiPlugin({ enabled: false }), plugin({ enabled: true })]);
    expect(isTabTypeAvailable("ai")).toBe(false);
    expect(isTabTypeAvailable("terminal")).toBe(true);
  });

  it("allows rdp/vnc/telnet tabs while remote-desktop is enabled", () => {
    applyPluginState([remoteDesktopPlugin({ enabled: true })]);
    expect(isTabTypeAvailable("rdp")).toBe(true);
    expect(isTabTypeAvailable("vnc")).toBe(true);
    expect(isTabTypeAvailable("telnet")).toBe(true);
  });

  it("blocks rdp/vnc/telnet tabs when remote-desktop is disabled", () => {
    applyPluginState([remoteDesktopPlugin({ enabled: false })]);
    expect(isTabTypeAvailable("rdp")).toBe(false);
    expect(isTabTypeAvailable("vnc")).toBe(false);
    expect(isTabTypeAvailable("telnet")).toBe(false);
  });

  it("allows rdp/vnc/telnet tabs again when remote-desktop is re-enabled", () => {
    applyPluginState([remoteDesktopPlugin({ enabled: false })]);
    expect(isTabTypeAvailable("rdp")).toBe(false);

    applyPluginState([remoteDesktopPlugin({ enabled: true })]);
    expect(isTabTypeAvailable("rdp")).toBe(true);
    expect(isTabTypeAvailable("vnc")).toBe(true);
    expect(isTabTypeAvailable("telnet")).toBe(true);
  });

  it("disabling remote-desktop does not affect the terminal, and vice versa", () => {
    applyPluginState([
      remoteDesktopPlugin({ enabled: false }),
      plugin({ enabled: true }),
    ]);
    expect(isTabTypeAvailable("rdp")).toBe(false);
    expect(isTabTypeAvailable("terminal")).toBe(true);
  });

  it("reports enablement, defaulting to true before the first load", () => {
    expect(isPluginEnabled("ssh-terminal")).toBe(true);

    applyPluginState([plugin({ enabled: false })]);
    expect(isPluginEnabled("ssh-terminal")).toBe(false);
    expect(isPluginEnabled("never-heard-of-it")).toBe(true);
  });
});
