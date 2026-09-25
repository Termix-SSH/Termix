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
    const panels = [...declared(contributes.panels), ...tabs];
    for (const id of rendered.registered.tabs()) expect(tabs).toContain(id);
    for (const id of rendered.registered.panels()) expect(panels).toContain(id);
  });

  it("registers the files and sftp tabs", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.tabs().sort()).toEqual(["files", "sftp"]);
  });

  it("registers the sftp rail item pointing at the sftp tab", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    const railItems = rendered.registered.railItems();
    expect(railItems.map((item) => item.id)).toContain("sftp");
  });

  it("registers a files host action opening the files tab", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    const hostActions = rendered.registered.hostActions();
    expect(hostActions).toContainEqual(
      expect.objectContaining({ id: "files", tabType: "files" }),
    );
  });

  it("leaves its host fields to the schema-driven Plugins tab", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.hostEditorSections()).toEqual([]);
  });

  it("registers files.openHost and files.openEditor actions", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.actions().sort()).toEqual([
      "files.openEditor",
      "files.openHost",
    ]);
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
