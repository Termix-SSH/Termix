import { afterEach, describe, expect, it } from "vitest";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix/plugin-sdk/testing";
import { hostActionsFor, listHostActions } from "@/sidebar/host-contributions";
import type { Host } from "@/types/ui-types";
import type { WebEndpoint } from "@/types";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import manifestJson from "../../manifest.json";

const manifest = manifestJson as unknown as PluginManifest;

function endpoint(overrides: Partial<WebEndpoint> = {}): WebEndpoint {
  return {
    id: "e1",
    label: "Proxmox",
    scheme: "https",
    port: 8006,
    path: "/",
    access: "direct",
    render: "embedded",
    ...overrides,
  };
}

function host(overrides: Partial<Host> = {}): Host {
  return {
    id: "7",
    ip: "10.0.0.5",
    name: "nas",
    enableSsh: false,
    enableWebUi: false,
    ...overrides,
  } as unknown as Host;
}

let rendered: RenderedPluginApp | null = null;

async function webAction(target: Host) {
  rendered ??= await renderWithApp(plugin, { manifest });
  return hostActionsFor(listHostActions(), target).find(
    (action) => action.id === "web-endpoint",
  );
}

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

describe("web-endpoint activate", () => {
  it("registers its tab, host action and editor section", async () => {
    rendered = await renderWithApp(plugin, { manifest });
    expect(rendered.registered.tabs()).toEqual(["web-endpoint"]);
    expect(rendered.registered.hostEditorSections()).toEqual(["web-ui"]);
  });

  it("offers no Web UI entry when the feature is off, even with endpoints", async () => {
    expect(
      await webAction(
        host({ enableWebUi: false, webUiConfig: { endpoints: [endpoint()] } }),
      ),
    ).toBeUndefined();
  });

  it("offers no entry when enabled but no endpoints exist", async () => {
    expect(
      await webAction(
        host({ enableWebUi: true, webUiConfig: { endpoints: [] } }),
      ),
    ).toBeUndefined();
  });

  it("appears without SSH", async () => {
    const action = await webAction(
      host({
        enableSsh: false,
        enableWebUi: true,
        webUiConfig: { endpoints: [endpoint()] },
      }),
    );
    expect(action).toBeDefined();
  });

  it("labels the entry with the endpoint when there is only one", async () => {
    const target = host({
      enableWebUi: true,
      webUiConfig: { endpoints: [endpoint({ label: "Proxmox" })] },
    });
    const action = await webAction(target);
    expect(action?.label?.(target)).toBe("Proxmox");
    expect(action?.items?.(target).map((item) => item.id)).toEqual(["e1"]);
  });

  it("stays one entry with a picker when there are several", async () => {
    const endpoints = Array.from({ length: 16 }, (_, i) =>
      endpoint({ id: `e${i}`, label: `Endpoint ${i}` }),
    );
    const target = host({ enableWebUi: true, webUiConfig: { endpoints } });
    const action = await webAction(target);
    expect(action?.label?.(target)).toBeUndefined();
    expect(action?.items?.(target)).toHaveLength(16);
  });

  it("opens an embedded endpoint as a tab carrying its id", async () => {
    const target = host({
      enableWebUi: true,
      webUiConfig: { endpoints: [endpoint()] },
    });
    const action = await webAction(target);
    const calls: unknown[][] = [];
    const shell = {
      openTab: (...args: unknown[]) => calls.push(args),
    } as never;
    action!.items!(target)[0].run(target, shell);
    expect(calls).toEqual([
      [
        target,
        "web-endpoint",
        { label: "Proxmox", data: { endpointId: "e1" } },
      ],
    ]);
  });
});
