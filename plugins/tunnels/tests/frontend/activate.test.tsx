import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
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

const savedTunnel = {
  scope: "s2s",
  mode: "local",
  sourcePort: 8080,
  endpointHost: "db",
  endpointPort: 5432,
  maxRetries: 3,
  retryInterval: 10,
  autoStart: false,
};

const webHost = {
  id: "7",
  name: "web",
  ip: "10.0.0.5",
  port: 22,
  username: "root",
  enableSsh: true,
  pluginSettings: {
    tunnels: { enableTunnel: true, tunnelConnections: [savedTunnel] },
  },
};

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
    const panels = [...declared(contributes.panels), ...tabs];
    expect(rendered.registered.tabs()).toEqual(["tunnel"]);
    for (const id of rendered.registered.panels()) expect(panels).toContain(id);
    expect(rendered.registered.hostEditorSections()).toEqual(["tunnels"]);
    expect(rendered.registered.hostActions()).toEqual([
      expect.objectContaining({ id: "tunnel", tabType: "tunnel" }),
    ]);
    expect(rendered.registered.actions().sort()).toEqual(["tunnels.open"]);
    expect(rendered.registered.slot("dashboard.counters")).toEqual([
      "tunnels.open",
    ]);
    const [rail] = rendered.registered.railItems();
    expect(rail).toMatchObject({
      id: "port-forwarding",
      permission: "tunnels.use",
    });
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
    expect(app.registered.hostActions()).toEqual([]);
    expect(app.registered.hostEditorSections()).toEqual([]);
    expect(app.registered.actions()).toEqual([]);
  });
});

describe("tunnel tab", () => {
  it("lists a host's saved tunnels and starts one by name through the plugin api", async () => {
    const api = stubApi();
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api,
      hosts: [webHost],
    });

    rendered.renderTab("tunnel", { host: webHost });
    expect(await screen.findByText("db:5432")).toBeTruthy();

    // "tunnels.start" is still a core string, reached through the fallback.
    fireEvent.click(screen.getByText(/start/i));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/connect",
        expect.objectContaining({
          name: "7::0::web::8080::db::5432",
          sourceHostId: 7,
          tunnelIndex: 0,
          endpointHost: "db",
        }),
      ),
    );
  });
});

describe("host editor section", () => {
  it("writes the tunnel list into the form's tunnels plugin settings", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: stubApi(),
    });
    let form: Record<string, unknown> = {
      name: "web",
      pluginSettings: { tunnels: { enableTunnel: true } },
    };
    const updateForm = vi.fn(
      (
        patch: (current: Record<string, unknown>) => Record<string, unknown>,
      ) => {
        form = patch(form);
      },
    );

    rendered.renderHostEditorSection("tunnels", {
      form,
      setField: vi.fn(),
      updateForm,
      protocols: { ssh: true },
    });
    fireEvent.click(screen.getByText(locales.hosts.addTunnelBtn));

    const settings = (form.pluginSettings as Record<string, unknown>)
      .tunnels as { enableTunnel: boolean; tunnelConnections: unknown[] };
    expect(settings.enableTunnel).toBe(true);
    expect(settings.tunnelConnections).toHaveLength(1);
    expect(settings.tunnelConnections[0]).toMatchObject({
      scope: "s2s",
      mode: "local",
    });
  });
});
