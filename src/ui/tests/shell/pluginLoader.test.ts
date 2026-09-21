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
    tier: "first-party",
    source: "bundled",
    enabled: true,
    runtimeState: "active",
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
    permissions: [],
    grantedCapabilities: [],
    ...overrides,
  };
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

  it("reports enablement, defaulting to true before the first load", () => {
    expect(isPluginEnabled("ssh-terminal")).toBe(true);

    applyPluginState([plugin({ enabled: false })]);
    expect(isPluginEnabled("ssh-terminal")).toBe(false);
    expect(isPluginEnabled("never-heard-of-it")).toBe(true);
  });
});
