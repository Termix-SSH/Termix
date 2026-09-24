import { afterEach, describe, expect, it, vi } from "vitest";
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
    expect(app.registered.hostProtocols()).toEqual([]);
    expect(app.registered.hostEditorSections()).toEqual([]);
    expect(app.registered.dashboardCards()).toEqual([]);
    expect(app.registered.settingsComponents()).toEqual([]);
    expect(app.registered.actions()).toEqual([]);
  });

  it("adds RDP, VNC and Telnet as host protocols while turned on", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: { get: async () => ({ data: { enabled: true } }) } as never,
    });
    await vi.waitFor(() =>
      expect(rendered!.registered.hostProtocols().sort()).toEqual([
        "rdp",
        "telnet",
        "vnc",
      ]),
    );
    expect(rendered.registered.hostActions().map((a) => a.id)).toEqual(
      expect.arrayContaining(["rdp", "vnc", "telnet"]),
    );
  });

  it("offers no way in while an admin has turned it off", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: { get: async () => ({ data: { enabled: false } }) } as never,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rendered.registered.hostProtocols()).toEqual([]);
    expect(rendered.registered.hostActions()).toEqual([]);
  });
});
