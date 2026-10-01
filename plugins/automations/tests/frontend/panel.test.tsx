import { afterEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
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

const rows = [
  {
    id: 1,
    name: "Restart app",
    description: null,
    enabled: 1,
    definition: {
      version: 1,
      trigger: { kind: "schedule", intervalSeconds: 300 },
      steps: [],
    },
    concurrency_policy: "skip",
    last_run_at: null,
    last_run_status: null,
    channels: [],
    missingPlugins: ["docker"],
  },
];

function stubApi(): PluginApiClient {
  return {
    get: vi.fn(async (path: string) => {
      if (path === "/editor-options") {
        return {
          data: {
            hosts: [],
            snippets: [],
            fleets: [],
            channels: [],
            providers: { snippets: true },
          },
        };
      }
      return { data: path === "/" ? rows : [] };
    }),
    post: vi.fn(async () => ({ data: {} })),
    put: vi.fn(async () => ({ data: {} })),
    patch: vi.fn(async () => ({ data: {} })),
    delete: vi.fn(async () => ({ data: {} })),
  } as unknown as PluginApiClient;
}

describe("automations panel", () => {
  it("lists automations from the plugin API and marks one that needs a plugin", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: stubApi(),
    });
    const element = rendered.renderPanel("automations") as HTMLElement;

    await waitFor(() => {
      expect(element.textContent).toContain("Restart app");
      expect(element.textContent).toContain("Needs docker");
    });
  });
});
