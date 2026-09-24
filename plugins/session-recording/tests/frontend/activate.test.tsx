import { afterEach, describe, expect, it, vi } from "vitest";
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

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

function stubApi(overrides: Partial<PluginApiClient> = {}): PluginApiClient {
  return {
    get: vi.fn(async () => ({ data: { logs: [] } })),
    post: vi.fn(async () => ({ data: {} })),
    put: vi.fn(async () => ({ data: {} })),
    patch: vi.fn(async () => ({ data: {} })),
    delete: vi.fn(async () => ({ data: {} })),
    ...overrides,
  } as PluginApiClient;
}

describe(`${manifest.id} activate`, () => {
  it("registers only views its manifest declares", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: stubApi(),
    });

    expect(rendered.registered.tabs()).toEqual(["session-logs"]);
    expect(rendered.registered.panels()).toEqual(["session-logs"]);
    expect(rendered.registered.railItems()).toEqual([
      expect.objectContaining({ id: "session-logs" }),
    ]);
    expect(rendered.registered.slot("terminal.toolbarStatus")).toEqual([
      "session-recording.terminalStatus",
    ]);
  });

  it("removes everything it registered on deactivate", async () => {
    const app = await renderWithApp(plugin, {
      manifest,
      locales,
      api: stubApi(),
    });
    await app.deactivate();
    expect(app.registered.tabs()).toEqual([]);
    expect(app.registered.panels()).toEqual([]);
    expect(app.registered.railItems()).toEqual([]);
  });

  it("renders the panel without crashing", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: stubApi(),
    });
    const element = rendered.renderPanel("session-logs");
    expect(element).toBeTruthy();
  });
});
