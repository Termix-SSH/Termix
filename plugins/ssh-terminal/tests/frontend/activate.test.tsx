import { afterEach, describe, expect, it } from "vitest";
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

  it("registers the terminal session actions snippets and other plugins call into", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.actions()).toEqual(
      expect.arrayContaining([
        "terminal.listSessions",
        "terminal.sendToActive",
        "terminal.sendToSession",
        "terminal.open",
      ]),
    );
  });

  it("registers the command history panel and its rail item", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.panels()).toContain("history");
    expect(rendered.registered.railItems().map((item) => item.id)).toContain(
      "history",
    );
  });

  it("offers the local terminal only in the desktop app", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.tabs()).not.toContain("local-terminal");
    await rendered.deactivate();

    (window as { IS_ELECTRON?: boolean }).IS_ELECTRON = true;
    try {
      rendered = await renderWithApp(plugin, { manifest, locales });
      expect(rendered.registered.tabs()).toContain("local-terminal");
      expect(rendered.registered.railItems().map((item) => item.id)).toContain(
        "local-terminal",
      );
    } finally {
      delete (window as { IS_ELECTRON?: boolean }).IS_ELECTRON;
    }
  });

  it("terminal.sendToActive and terminal.listSessions report no session when none is registered", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    await expect(
      rendered.app.invokeAction("terminal.listSessions"),
    ).resolves.toEqual([]);
    await expect(
      rendered.app.invokeAction("terminal.sendToActive", "echo hi", {
        run: true,
      }),
    ).resolves.toBe(false);
  });
});
