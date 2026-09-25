import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Puzzle } from "lucide-react";
import type { FrontendModule, TermixApp } from "@termix/plugin-sdk/frontend";
import type { PluginSummary } from "@/api/plugins-api";
import {
  configurePluginLoader,
  isPluginFrontendActive,
  orderForActivation,
  resetPluginLoader,
  syncPlugins,
} from "@/plugin-host/loader";
import {
  getPluginRecord,
  getPluginStoreState,
  resetPluginStore,
} from "@/plugin-host/plugin-store";
import {
  resetRegisteredRailItems,
  visibleRailItems,
} from "@/sidebar/rail-items";
import { getTabType, resetTabTypes } from "@/shell/tab-registry";

function summary(
  id: string,
  overrides: Partial<PluginSummary> = {},
): PluginSummary {
  return {
    id,
    name: id,
    version: "1.0.0",
    enabled: true,
    state: "active",
    frontend: true,
    assetVersion: "v1",
    contributes: { panels: [{ id: `${id}-panel`, titleKey: "nav.hosts" }] },
    ...overrides,
  };
}

/** A plugin that registers a rail item named after itself. */
function railPlugin(id: string, calls: string[] = []): FrontendModule {
  return {
    activate(app: TermixApp) {
      calls.push(`activate:${id}`);
      app.registerRailItem({
        id: `${id}-panel`,
        icon: Puzzle,
        titleKey: "nav.hosts",
      });
    },
    deactivate() {
      calls.push(`deactivate:${id}`);
    },
  };
}

function railIds(): string[] {
  return visibleRailItems().map((item) => item.id);
}

let plugins: PluginSummary[] = [];
let modules: Record<string, FrontendModule> = {};

beforeEach(() => {
  plugins = [];
  modules = {};
  configurePluginLoader({
    fetchPlugins: async () => plugins,
    importFrontend: async (entry) => {
      const module = modules[entry.id];
      if (!module) throw new Error(`no module for ${entry.id}`);
      return module;
    },
    loadLocale: async () => null,
    injectCss: () => null,
  });
});

afterEach(async () => {
  await resetPluginLoader();
  resetPluginStore();
  resetRegisteredRailItems();
  resetTabTypes();
  vi.restoreAllMocks();
});

describe("plugin loader", () => {
  it("activates an enabled plugin and deactivates it when disabled, without a reload", async () => {
    const calls: string[] = [];
    modules.alpha = railPlugin("alpha", calls);
    plugins = [summary("alpha")];

    await syncPlugins();
    expect(railIds()).toContain("alpha-panel");
    expect(isPluginFrontendActive("alpha")).toBe(true);

    plugins = [summary("alpha", { enabled: false })];
    await syncPlugins();
    expect(railIds()).not.toContain("alpha-panel");
    expect(calls).toEqual(["activate:alpha", "deactivate:alpha"]);
    expect(getPluginRecord("alpha")?.frontend).toBe("inactive");
  });

  it("re-activates the same module after disable then enable", async () => {
    const calls: string[] = [];
    modules.alpha = railPlugin("alpha", calls);

    plugins = [summary("alpha")];
    await syncPlugins();
    plugins = [summary("alpha", { enabled: false })];
    await syncPlugins();
    plugins = [summary("alpha")];
    await syncPlugins();

    expect(railIds()).toContain("alpha-panel");
    expect(calls).toEqual([
      "activate:alpha",
      "deactivate:alpha",
      "activate:alpha",
    ]);
  });

  it("disposes registrations even when deactivate throws", async () => {
    modules.alpha = {
      activate: railPlugin("alpha").activate,
      deactivate: () => {
        throw new Error("boom");
      },
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    plugins = [summary("alpha")];
    await syncPlugins();
    plugins = [];
    await syncPlugins();
    expect(railIds()).not.toContain("alpha-panel");
  });

  it("isolates a plugin whose activate throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    modules.broken = {
      activate(app) {
        app.registerRailItem({
          id: "broken-panel",
          icon: Puzzle,
          titleKey: "nav.hosts",
        });
        throw new Error("activate failed");
      },
    };
    modules.healthy = railPlugin("healthy");
    plugins = [summary("broken"), summary("healthy")];

    await syncPlugins();

    expect(getPluginRecord("broken")?.frontend).toBe("failed");
    expect(getPluginRecord("broken")?.error).toBe("activate failed");
    // What it registered before throwing is cleaned up.
    expect(railIds()).not.toContain("broken-panel");
    expect(railIds()).toContain("healthy-panel");
  });

  it("marks a plugin failed when its bundle cannot be imported", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    plugins = [summary("missing")];
    await syncPlugins();
    expect(getPluginRecord("missing")?.frontend).toBe("failed");
  });

  it("does not retry the same broken bundle, but does a new one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const activate = vi.fn(() => {
      throw new Error("nope");
    });
    modules.flaky = { activate };
    plugins = [summary("flaky")];
    await syncPlugins();
    await syncPlugins();
    expect(activate).toHaveBeenCalledTimes(1);

    modules.flaky = railPlugin("flaky");
    plugins = [summary("flaky", { assetVersion: "v2" })];
    await syncPlugins();
    expect(getPluginRecord("flaky")?.frontend).toBe("active");
  });

  it("refuses to register a view the manifest does not declare", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    modules.sneaky = {
      activate(app) {
        app.registerTab("undeclared", () => null);
      },
    };
    plugins = [summary("sneaky")];
    await syncPlugins();
    expect(getTabType("undeclared")).toBeUndefined();
    expect(getPluginRecord("sneaky")?.error).toMatch(/not declared/);
  });

  it("skips server-failed and frontend-less plugins", async () => {
    modules.down = railPlugin("down");
    modules.headless = railPlugin("headless");
    plugins = [
      summary("down", { state: "failed" }),
      summary("headless", { frontend: false }),
    ];
    await syncPlugins();
    expect(railIds()).not.toContain("down-panel");
    expect(railIds()).not.toContain("headless-panel");
  });

  it("settles even when the plugin list cannot be fetched", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    configurePluginLoader({
      fetchPlugins: async () => {
        throw new Error("offline");
      },
    });
    await syncPlugins();
    expect(getPluginStoreState().settled).toBe(true);
  });
});

describe("activation order", () => {
  it("activates a dependency before its dependent", async () => {
    const calls: string[] = [];
    modules.child = railPlugin("child", calls);
    modules.parent = railPlugin("parent", calls);
    plugins = [
      summary("child", { dependencies: { parent: "^1.0.0" } }),
      summary("parent"),
    ];
    await syncPlugins();
    expect(calls).toEqual(["activate:parent", "activate:child"]);
  });

  it("blocks a plugin whose hard dependency is off", async () => {
    modules.child = railPlugin("child");
    plugins = [
      summary("child", { dependencies: { parent: "^1.0.0" } }),
      summary("parent", { enabled: false }),
    ];
    await syncPlugins();
    expect(getPluginRecord("child")?.frontend).toBe("blocked");
    expect(railIds()).not.toContain("child-panel");
  });

  it("runs without an optional dependency", () => {
    const { order, blocked } = orderForActivation([
      summary("child", { optionalDependencies: { gone: "^1.0.0" } }),
    ]);
    expect(order.map((entry) => entry.id)).toEqual(["child"]);
    expect(blocked.size).toBe(0);
  });

  it("blocks both sides of a dependency cycle", () => {
    const { order, blocked } = orderForActivation([
      summary("a", { dependencies: { b: "*" } }),
      summary("b", { dependencies: { a: "*" } }),
    ]);
    expect(order).toEqual([]);
    expect([...blocked.keys()].sort()).toEqual(["a", "b"]);
  });

  it("activates independent plugins concurrently rather than one at a time", async () => {
    modules.alpha = railPlugin("alpha");
    modules.beta = railPlugin("beta");
    plugins = [summary("alpha"), summary("beta")];

    // Each import blocks until the other has started, which only resolves
    // if both imports were kicked off before either finished.
    let releaseAlpha: () => void;
    let releaseBeta: () => void;
    const alphaStarted = new Promise<void>((resolve) => {
      releaseAlpha = resolve;
    });
    const betaStarted = new Promise<void>((resolve) => {
      releaseBeta = resolve;
    });
    configurePluginLoader({
      fetchPlugins: async () => plugins,
      importFrontend: async (entry) => {
        if (entry.id === "alpha") {
          releaseAlpha!();
          await betaStarted;
        } else if (entry.id === "beta") {
          releaseBeta!();
          await alphaStarted;
        }
        const module = modules[entry.id];
        if (!module) throw new Error(`no module for ${entry.id}`);
        return module;
      },
      loadLocale: async () => null,
      injectCss: () => null,
    });

    await syncPlugins();

    expect(railIds()).toContain("alpha-panel");
    expect(railIds()).toContain("beta-panel");
  });
});
