import { afterEach, describe, expect, it } from "vitest";
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
    const tabs = declared(contributes.tabs);
    const panels = [...declared(contributes.panels), ...tabs];

    expect(rendered.registered.tabs()).toEqual(["serial"]);
    for (const id of rendered.registered.tabs()) expect(tabs).toContain(id);
    for (const id of rendered.registered.panels()) expect(panels).toContain(id);
    expect(rendered.registered.railItems().map((item) => item.id)).toContain(
      "serial",
    );
  });

  it("removes everything it registered on deactivate", async () => {
    const app = await renderWithApp(plugin, { manifest, locales });
    await app.deactivate();
    expect(app.registered.tabs()).toEqual([]);
    expect(app.registered.panels()).toEqual([]);
    expect(app.registered.railItems()).toEqual([]);
  });

  it("renders the connect form in the rail panel", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    rendered.renderPanel("serial", { active: true });
    // jsdom has no Web Serial API and isn't Electron, so the panel falls
    // back to its "not supported" message rather than a live form.
    expect(
      await screen.findByText(locales.serial.notSupportedTitle),
    ).toBeTruthy();
  });
});
