import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
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

  it("registers the snippets.resolveForTerminal action", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.actions()).toContain(
      "snippets.resolveForTerminal",
    );
  });

  it("removes everything it registered on deactivate", async () => {
    const app = await renderWithApp(plugin, { manifest, locales });
    await app.deactivate();
    expect(app.registered.panels()).toEqual([]);
    expect(app.registered.railItems()).toEqual([]);
    expect(app.registered.actions()).toEqual([]);
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
