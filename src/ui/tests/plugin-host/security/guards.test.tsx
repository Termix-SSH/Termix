import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Puzzle } from "lucide-react";
import type { FrontendModule } from "@termix/plugin-sdk/frontend";
import type { PluginSummary } from "@/api/plugins-api";
import {
  configurePluginLoader,
  resetPluginLoader,
  syncPlugins,
} from "@/plugin-host/loader";
import { getPluginRecord, resetPluginStore } from "@/plugin-host/plugin-store";
import { guardCallback, withIconBoundary } from "@/plugin-host/scope";
import {
  resetRegisteredRailItems,
  visibleRailItems,
} from "@/sidebar/rail-items";
import {
  listHostActions,
  resetHostContributions,
} from "@/sidebar/host-contributions";

function summary(id: string): PluginSummary {
  return {
    id,
    name: id,
    version: "1.0.0",
    enabled: true,
    state: "active",
    frontend: true,
    assetVersion: "v1",
    contributes: { panels: [{ id: `${id}-panel`, titleKey: "nav.hosts" }] },
  };
}

let plugins: PluginSummary[] = [];
let modules: Record<string, FrontendModule> = {};

beforeEach(() => {
  plugins = [];
  modules = {};
  vi.spyOn(console, "error").mockImplementation(() => {});
  configurePluginLoader({
    fetchPlugins: async () => plugins,
    importFrontend: async (entry) => modules[entry.id],
    loadLocale: async () => null,
    injectCss: () => null,
  });
});

afterEach(async () => {
  vi.useRealTimers();
  await resetPluginLoader();
  resetPluginStore();
  resetRegisteredRailItems();
  resetHostContributions();
  vi.restoreAllMocks();
});

describe("a plugin cannot stall or crash the shell", () => {
  it("fails a plugin whose activate never finishes, and starts the rest", async () => {
    vi.useFakeTimers();
    modules.stuck = { activate: () => new Promise(() => {}) };
    modules.healthy = {
      activate(app) {
        app.registerRailItem({
          id: "healthy-panel",
          icon: Puzzle,
          titleKey: "nav.hosts",
        });
      },
    };
    plugins = [summary("stuck"), summary("healthy")];

    const sync = syncPlugins();
    await vi.advanceTimersByTimeAsync(16_000);
    await sync;

    expect(getPluginRecord("stuck")?.frontend).toBe("failed");
    expect(visibleRailItems().map((item) => item.id)).toContain(
      "healthy-panel",
    );
  });

  it("answers a host action's throwing label and items with nothing", async () => {
    modules.labels = {
      activate(app) {
        app.registerHostAction({
          id: "labels.open",
          titleKey: "open",
          label: () => {
            throw new Error("label broke");
          },
          items: () => {
            throw new Error("items broke");
          },
          run: () => {},
        } as never);
      },
    };
    plugins = [summary("labels")];
    await syncPlugins();

    const action = listHostActions().find(
      (entry) => entry.id === "labels.open",
    );
    expect(action).toBeDefined();
    expect(() => action!.label?.({} as never)).not.toThrow();
    expect(action!.label?.({} as never)).toBeUndefined();
    expect(action!.items?.({} as never)).toBeUndefined();
  });
});

describe("withIconBoundary", () => {
  it("renders nothing for a throwing icon and leaves its neighbours alone", () => {
    const Broken = () => {
      throw new Error("icon broke");
    };
    const Safe = withIconBoundary("demo", Broken)!;
    render(
      <div>
        <Safe />
        <span>still here</span>
      </div>,
    );
    expect(screen.getByText("still here")).toBeTruthy();
  });

  it("passes undefined through", () => {
    expect(withIconBoundary("demo", undefined)).toBeUndefined();
  });
});

describe("guardCallback", () => {
  it("returns the fallback when the plugin's callback throws", () => {
    const guarded = guardCallback(
      "demo",
      () => {
        throw new Error("nope");
      },
      "fallback",
    );
    expect(guarded?.()).toBe("fallback");
  });
});
