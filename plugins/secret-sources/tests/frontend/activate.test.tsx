import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix/plugin-sdk/testing";
import { PluginComponent } from "@termix/plugin-sdk/ui";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";

const manifest = manifestJson as unknown as PluginManifest;

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

describe(`${manifest.id} activate`, () => {
  it("registers the hint and manager components", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    render(
      <PluginComponent
        id="credentials.secretHint"
        onManage={vi.fn()}
        fallback={<span>fallback</span>}
      />,
    );
    expect(await screen.findByText(locales.hint)).toBeTruthy();
  });

  it("renders the manager and can be closed", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: {
        get: vi.fn(async () => ({ data: { sources: [] } })),
      } as never,
    });
    const onClose = vi.fn();
    render(
      <PluginComponent id="credentials.secretManager" onClose={onClose} />,
    );
    expect(await screen.findByText(locales.title)).toBeTruthy();
  });

  it("removes both components on deactivate", async () => {
    const app = await renderWithApp(plugin, { manifest, locales });
    await app.deactivate();
    render(
      <PluginComponent
        id="credentials.secretHint"
        fallback={<span>gone</span>}
      />,
    );
    expect(await screen.findByText("gone")).toBeTruthy();
  });
});
