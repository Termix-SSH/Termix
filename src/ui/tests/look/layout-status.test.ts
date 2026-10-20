import { describe, expect, it } from "vitest";
import type { PluginSummary } from "@/api/plugins-api";
import type { PluginRecord } from "@/plugin-host/plugin-store";
import {
  layoutStatus,
  MAX_LAYOUT_CRASHES,
  type LayoutStatusInput,
} from "@/look/layout-status";

const Layout = () => null;
const registered = { id: "fancy", pluginId: "fancy-layout", component: Layout };

function owner(
  patch: Partial<PluginSummary> = {},
  frontend: PluginRecord["frontend"] = "active",
  error?: string,
): PluginRecord {
  return {
    summary: {
      id: "fancy-layout",
      name: "Fancy",
      version: "1.2.0",
      enabled: true,
      state: "active",
      contributes: { layouts: [{ id: "fancy", label: "Fancy" }] },
      frontend: true,
      ...patch,
    },
    frontend,
    error,
  };
}

function input(patch: Partial<LayoutStatusInput> = {}): LayoutStatusInput {
  return {
    layoutId: "fancy",
    safeFromUrl: false,
    safeFromEnv: false,
    ready: true,
    registered: undefined,
    owner: undefined,
    unavailable: undefined,
    crashes: 0,
    lastCrash: null,
    ...patch,
  };
}

describe("layoutStatus", () => {
  it("draws a registered layout", () => {
    expect(layoutStatus(input({ registered }))).toEqual({
      kind: "ok",
      layout: registered,
    });
  });

  it("opens the repair view for ?safe-layout=1 and the env var first", () => {
    expect(
      layoutStatus(input({ registered, safeFromUrl: true })),
    ).toMatchObject({ kind: "repair", reason: "safe-url" });
    expect(
      layoutStatus(input({ registered, safeFromEnv: true })),
    ).toMatchObject({ kind: "repair", reason: "safe-env" });
  });

  it("gives up after the boundary trips twice, not once", () => {
    expect(layoutStatus(input({ registered, crashes: 1 }))).toMatchObject({
      kind: "ok",
    });
    expect(
      layoutStatus(
        input({
          registered,
          owner: owner(),
          crashes: MAX_LAYOUT_CRASHES,
          lastCrash: "boom",
        }),
      ),
    ).toEqual({
      kind: "repair",
      reason: "crashed",
      layoutId: "fancy",
      pluginId: "fancy-layout",
      version: "1.2.0",
      error: "boom",
    });
  });

  it("waits until the look and plugins are known", () => {
    expect(layoutStatus(input({ ready: false }))).toEqual({ kind: "loading" });
  });

  it("says missing when nothing provides the layout", () => {
    expect(layoutStatus(input())).toMatchObject({
      kind: "repair",
      reason: "missing",
    });
    // Running, but it never registered what it declares.
    expect(layoutStatus(input({ owner: owner() }))).toMatchObject({
      reason: "missing",
    });
  });

  it("says disabled, blocked or failed from the plugin's state", () => {
    expect(
      layoutStatus(input({ owner: owner({ enabled: false }) })),
    ).toMatchObject({ reason: "disabled", pluginId: "fancy-layout" });
    expect(
      layoutStatus(input({ owner: owner({}, "blocked", "needs x") })),
    ).toMatchObject({ reason: "blocked", error: "needs x" });
    expect(
      layoutStatus(input({ owner: owner({}, "failed", "activate threw") })),
    ).toMatchObject({ reason: "failed", error: "activate threw" });
    expect(
      layoutStatus(
        input({
          owner: owner({ state: "failed", lastError: "server" }, "none"),
        }),
      ),
    ).toMatchObject({ reason: "failed", error: "server" });
  });

  it("says incompatible when the server skipped its plugin", () => {
    expect(
      layoutStatus(
        input({
          unavailable: {
            id: "fancy-layout",
            version: "2.0.0",
            layouts: ["fancy"],
            themes: [],
            error: "needs Termix >=27",
          },
        }),
      ),
    ).toEqual({
      kind: "repair",
      reason: "incompatible",
      layoutId: "fancy",
      pluginId: "fancy-layout",
      version: "2.0.0",
      error: "needs Termix >=27",
    });
  });

  it("waits for a layout plugin that is about to load", () => {
    expect(layoutStatus(input({ owner: owner({}, "loading") }))).toEqual({
      kind: "loading",
    });
    expect(layoutStatus(input({ owner: owner({}, "inactive") }))).toEqual({
      kind: "loading",
    });
  });
});
