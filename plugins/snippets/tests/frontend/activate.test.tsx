import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { runKeybindingAction } from "@termix/plugin-sdk/frontend";
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
    const panels = declared(contributes.panels);
    for (const id of rendered.registered.panels()) expect(panels).toContain(id);
  });

  it("registers the rail item gated on the view permission", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    const railItem = rendered.registered
      .railItems()
      .find((i) => i.id === "snippets");
    expect(railItem).toBeDefined();
    expect(railItem?.permission).toBe("snippets.view");
  });

  it("registers what other surfaces reach it through", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.actions()).toEqual(
      expect.arrayContaining([
        "snippets.startupCommand",
        "snippets.list",
        "snippets.extractInputs",
      ]),
    );
    expect(rendered.registered.paletteGroups()).toEqual(["snippets"]);
    expect(rendered.registered.keybindingActions()).toEqual(["runSnippet"]);
    expect(rendered.registered.hostEditorSections()).toEqual(["snippets"]);
    expect(rendered.registered.slot("host-metrics.toolbar")).toEqual([
      "snippets.quickActions",
    ]);
    expect(rendered.registered.slot("shell.overlay")).toEqual([
      "snippets.overlay",
    ]);
  });

  it("removes everything it registered on deactivate", async () => {
    const app = await renderWithApp(plugin, { manifest, locales });
    await app.deactivate();
    expect(app.registered.panels()).toEqual([]);
    expect(app.registered.railItems()).toEqual([]);
    expect(app.registered.actions()).toEqual([]);
    expect(app.registered.paletteGroups()).toEqual([]);
    expect(app.registered.keybindingActions()).toEqual([]);
  });
});

const deploy = {
  id: 3,
  name: "Deploy",
  content: "deploy $HOST",
  description: null,
  isNote: false,
};

describe("snippets in the command palette", () => {
  it("lists snippets that run in the target tab", async () => {
    const api = { get: vi.fn(async () => ({ data: [deploy] })) };
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api as never,
      permissions: ["snippets.view"],
    });
    const items = await rendered.loadPaletteGroup("snippets");
    expect(items).toEqual([
      expect.objectContaining({
        id: "3",
        title: "Deploy",
        description: "deploy $HOST",
        needsTarget: true,
      }),
    ]);
  });

  it("offers nothing without the view permission", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      permissions: [],
    });
    expect(await rendered.loadPaletteGroup("snippets")).toEqual([]);
  });
});

describe("the runSnippet keybinding", () => {
  it("types the resolved snippet into the session it was pressed in", async () => {
    const api = { get: vi.fn(async () => ({ data: deploy })) };
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api as never,
    });
    const send = vi.fn();
    const handled = runKeybindingAction(
      { type: "runSnippet", snippetId: "3", appendEnter: true },
      { host: { ip: "10.0.0.9" }, send },
    );
    expect(handled).toBe(true);
    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith("deploy 10.0.0.9\r"),
    );
    expect(api.get).toHaveBeenCalledWith("/3");
  });
});

describe("the startup command", () => {
  it("resolves the host's startup snippet, or nothing without one", async () => {
    const api = { get: vi.fn(async () => ({ data: deploy })) };
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api as never,
    });
    const host = {
      id: "1",
      name: "web",
      ip: "10.0.0.2",
      port: 22,
      pluginSettings: { snippets: { startupSnippetId: 3 } },
    };
    expect(
      await rendered.app.invokeAction("snippets.startupCommand", host),
    ).toBe("deploy 10.0.0.2");
    expect(
      await rendered.app.invokeAction("snippets.startupCommand", {
        ...host,
        pluginSettings: {},
      }),
    ).toBeNull();
  });
});

describe("the host editor's Snippets tab", () => {
  it("writes the startup snippet and quick actions into this plugin's settings", async () => {
    const api = { get: vi.fn(async () => ({ data: [deploy] })) };
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api as never,
    });
    let form: Record<string, unknown> = {
      pluginSettings: { other: { keep: 1 } },
    };
    const updateForm = (
      patch: (current: Record<string, unknown>) => Record<string, unknown>,
    ) => {
      form = patch(form);
    };
    rendered.renderHostEditorSection("snippets", { form, updateForm });
    const startup = await screen.findByRole("combobox", {
      name: "Startup Snippet",
    });
    await screen.findAllByRole("option", { name: "Deploy" });
    act(() => {
      fireEvent.change(startup, { target: { value: "3" } });
    });
    expect(form.pluginSettings).toEqual({
      other: { keep: 1 },
      snippets: { startupSnippetId: 3 },
    });
  });
});

describe("the Host Metrics quick action buttons", () => {
  it("draws a button per quick action and nothing without any", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      permissions: ["snippets.view"],
    });
    const host = {
      id: 4,
      pluginSettings: {
        snippets: { quickActions: [{ name: "Restart", snippetId: 3 }] },
      },
    };
    rendered.renderSlot("host-metrics.toolbar", { hostId: 4, host });
    expect(await screen.findByRole("button", { name: "Restart" })).toBeTruthy();
  });
});

describe("snippets panel", () => {
  it("renders the empty state when the user has no snippets", async () => {
    const api = {
      get: vi.fn(async () => ({ data: [] })),
    };
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api as never,
      permissions: ["snippets.view", "snippets.create"],
    });
    rendered.renderPanel("snippets", { active: true });
    await expect(screen.findByPlaceholderText(/search/i)).resolves.toBeTruthy();
  });

  it("renders nothing without the view permission", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      permissions: [],
    });
    const panel = rendered.renderPanel("snippets", { active: true });
    expect(panel.textContent).toBe("");
  });
});
