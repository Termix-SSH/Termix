import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
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

function stubApi(overrides: Partial<PluginApiClient> = {}): PluginApiClient {
  return {
    get: vi.fn(async () => ({ data: {} })),
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
    const contributes = manifest.contributes as unknown as Record<
      string,
      Array<{ id: string }> | undefined
    >;
    const tabs = declared(contributes.tabs);
    expect(rendered.registered.tabs()).toEqual(["tmux_monitor"]);
    expect(rendered.registered.hostEditorSections()).toEqual(["tmux-monitor"]);
    expect(rendered.registered.hostActions()).toEqual([
      expect.objectContaining({ id: "tmux_monitor", tabType: undefined }),
    ]);
    for (const id of rendered.registered.tabs()) expect(tabs).toContain(id);
  });

  it("removes everything it registered on deactivate", async () => {
    const app = await renderWithApp(plugin, {
      manifest,
      locales,
      api: stubApi(),
    });
    await app.deactivate();
    expect(app.registered.tabs()).toEqual([]);
    expect(app.registered.hostActions()).toEqual([]);
    expect(app.registered.hostEditorSections()).toEqual([]);
  });
});

describe("host editor section", () => {
  it("writes the enable switch into the form's tmux-monitor plugin settings", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: stubApi(),
    });
    let form: Record<string, unknown> = {
      name: "web",
      pluginSettings: { "tmux-monitor": { enableTmuxMonitor: false } },
    };
    const updateForm = vi.fn(
      (
        patch: (current: Record<string, unknown>) => Record<string, unknown>,
      ) => {
        form = patch(form);
      },
    );

    rendered.renderHostEditorSection("tmux-monitor", {
      form,
      setField: vi.fn(),
      updateForm,
      protocols: { ssh: true },
    });

    fireEvent.click(screen.getByRole("button"));

    const settings = (form.pluginSettings as Record<string, unknown>)[
      "tmux-monitor"
    ] as { enableTmuxMonitor: boolean };
    expect(settings.enableTmuxMonitor).toBe(true);
  });
});
