import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { PluginApiClient } from "@termix/plugin-sdk/frontend";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix/plugin-sdk/testing";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";

const manifest = manifestJson as unknown as PluginManifest;

const declared = (views?: Array<{ id: string }>) =>
  (views ?? []).map((view) => view.id).sort();

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

describe(`${manifest.id} activate`, () => {
  it("activates and registers only views its manifest declares", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    const contributes = manifest.contributes as unknown as Record<
      string,
      Array<{ id: string }> | undefined
    >;
    const tabs = declared(contributes.tabs);
    // A rail panel may reuse one of the plugin's tab ids.
    const panels = [...declared(contributes.panels), ...tabs];
    const cards = declared(contributes.dashboardCards);
    for (const id of rendered.registered.tabs()) expect(tabs).toContain(id);
    for (const id of rendered.registered.panels()) expect(panels).toContain(id);
    for (const id of rendered.registered.dashboardCards()) {
      expect(cards).toContain(id);
    }
  });

  it("removes everything it registered on deactivate", async () => {
    const app = await renderWithApp(plugin, { manifest, locales });
    await app.deactivate();
    expect(app.registered.tabs()).toEqual([]);
    expect(app.registered.panels()).toEqual([]);
    expect(app.registered.railItems()).toEqual([]);
    expect(app.registered.hostActions()).toEqual([]);
    expect(app.registered.hostEditorSections()).toEqual([]);
    expect(app.registered.dashboardCards()).toEqual([]);
    expect(app.registered.settingsComponents()).toEqual([]);
    expect(app.registered.actions()).toEqual([]);
  });
});

function workspace(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: "user-1",
    name: "Prod",
    color: "#ef4444",
    icon: null,
    kind: "manual",
    isDefault: false,
    payload: {
      version: 1,
      tabs: [{ slotId: "s1", type: "network_graph", label: "Graph" }],
      activeSlotId: "s1",
      splitMode: "none",
      paneTabIds: [],
      rowSizes: [],
      rowColSizes: [],
    },
    syncId: "sync-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastUsedAt: null,
    tabCount: 1,
    ...overrides,
  };
}

function stubApi(workspaces: unknown[]) {
  return {
    get: vi.fn(async () => ({ data: workspaces })),
    post: vi.fn(async () => ({ data: workspaces[0] })),
    put: vi.fn(async () => ({ data: {} })),
    patch: vi.fn(async () => ({ data: {} })),
    delete: vi.fn(async () => ({ data: { success: true } })),
  };
}

async function applyThroughPanel(app: RenderedPluginApp, name: string) {
  app.renderPanel("workspaces", { active: true });
  fireEvent.click(await screen.findByText(name));
  fireEvent.click(
    await screen.findByText("Apply Workspace", { selector: "button" }),
  );
  await waitFor(() =>
    expect(app.shellCalls.some((call) => call.method === "applyLayout")).toBe(
      true,
    ),
  );
}

describe("workspaces panel", () => {
  it("gates its rail item on workspaces.use", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.railItems()).toEqual([
      expect.objectContaining({
        id: "workspaces",
        permission: "workspaces.use",
      }),
    ]);
  });

  it("lists the user's workspaces", async () => {
    const api = stubApi([
      workspace(),
      workspace({ id: 2, name: "Last Session", kind: "last_session" }),
    ]);
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api as unknown as PluginApiClient,
    });
    rendered.renderPanel("workspaces", { active: true });

    expect(await screen.findByText("Prod")).toBeTruthy();
    expect(
      screen.getByText(locales.newUi.sidebar.workspaces.lastSession),
    ).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith("/");
  });

  it("applies a workspace to the tabs and marks it used", async () => {
    const saved = workspace();
    const api = stubApi([saved]);
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api as unknown as PluginApiClient,
    });

    await applyThroughPanel(rendered, "Prod");

    const call = rendered.shellCalls.find((c) => c.method === "applyLayout");
    expect(call?.args[0]).toEqual(saved.payload);
    expect(call?.args[1]).toEqual({ name: "Prod" });
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/1/apply"));
  });

  it("keeps a tab from a plugin that is not running and shows its placeholder", async () => {
    const saved = workspace({
      payload: {
        version: 1,
        tabs: [{ slotId: "s1", type: "not-installed-view", label: "Gone" }],
        activeSlotId: "s1",
        splitMode: "none",
        paneTabIds: [],
        rowSizes: [],
        rowColSizes: [],
      },
    });
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: stubApi([saved]) as unknown as PluginApiClient,
    });

    await applyThroughPanel(rendered, "Prod");

    expect(rendered.openedTabs()).toEqual([
      { type: "not-installed-view", hostId: undefined, label: "Gone" },
    ]);
    const tab = rendered.renderOpenedTab(0);
    expect(
      tab.querySelector('[data-testid="plugin-view-placeholder"]'),
    ).not.toBeNull();
  });

  it("restores the default workspace once the shell is ready", async () => {
    const saved = workspace({ isDefault: true });
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      permissions: ["workspaces.use"],
      ready: true,
      api: stubApi([saved]) as unknown as PluginApiClient,
    });

    await waitFor(() =>
      expect(
        rendered!.shellCalls.find((c) => c.method === "applyLayout")?.args[0],
      ).toEqual(saved.payload),
    );
  });

  it("does not restore or autosave for a user without workspaces.use", async () => {
    const api = stubApi([workspace({ isDefault: true })]);
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      permissions: [],
      ready: true,
      api: api as unknown as PluginApiClient,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.get).not.toHaveBeenCalled();
    expect(rendered.shellCalls.some((c) => c.method === "applyLayout")).toBe(
      false,
    );
  });
});
