import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix/plugin-sdk/testing";
import { hostActionsFor, listHostActions } from "@/sidebar/host-contributions";
import type { Host } from "@/types/ui-types";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import type { WebEndpoint } from "../../src/shared/web-endpoint-config";
import * as plugin from "../../src/frontend/index";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";

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

function host(
  endpoints: WebEndpoint[] | undefined,
  overrides: Partial<Host> = {},
): Host {
  return {
    id: "7",
    ip: "10.0.0.5",
    name: "nas",
    enableSsh: false,
    pluginSettings:
      endpoints === undefined
        ? {}
        : { "web-endpoint": { enableWebUi: true, webUiConfig: { endpoints } } },
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
    const target = host([endpoint()], {
      pluginSettings: {
        "web-endpoint": {
          enableWebUi: false,
          webUiConfig: { endpoints: [endpoint()] },
        },
      },
    });
    expect(await webAction(target)).toBeUndefined();
  });

  it("offers no entry when enabled but no endpoints exist", async () => {
    expect(await webAction(host([]))).toBeUndefined();
  });

  it("offers no entry when the host has no web-endpoint settings at all", async () => {
    expect(await webAction(host(undefined))).toBeUndefined();
  });

  it("appears without SSH", async () => {
    const action = await webAction(host([endpoint()], { enableSsh: false }));
    expect(action).toBeDefined();
  });

  it("labels the entry with the endpoint when there is only one", async () => {
    const target = host([endpoint({ label: "Proxmox" })]);
    const action = await webAction(target);
    expect(action?.label?.(target)).toBe("Proxmox");
    expect(action?.items?.(target).map((item) => item.id)).toEqual(["e1"]);
  });

  it("stays one entry with a picker when there are several", async () => {
    const endpoints = Array.from({ length: 16 }, (_, i) =>
      endpoint({ id: `e${i}`, label: `Endpoint ${i}` }),
    );
    const target = host(endpoints);
    const action = await webAction(target);
    expect(action?.label?.(target)).toBeUndefined();
    expect(action?.items?.(target)).toHaveLength(16);
  });

  it("opens an embedded endpoint as a tab carrying its id", async () => {
    const target = host([endpoint()]);
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

describe("host editor section", () => {
  it("writes into the form's web-endpoint plugin settings", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    let form: Record<string, unknown> = {
      name: "nas",
      pluginSettings: { "web-endpoint": { enableWebUi: false } },
    };
    const updateForm = vi.fn(
      (
        patch: (current: Record<string, unknown>) => Record<string, unknown>,
      ) => {
        form = patch(form);
      },
    );

    const section = rendered.renderHostEditorSection("web-ui", {
      form,
      setField: vi.fn(),
      updateForm,
      protocols: { enableSsh: true },
    });

    // The enable switch is the only button on the section before any
    // endpoint rows exist (which only render once enabled).
    fireEvent.click(section.querySelector("button") as HTMLButtonElement);

    const settings = (form.pluginSettings as Record<string, unknown>)[
      "web-endpoint"
    ] as { enableWebUi: boolean };
    expect(settings.enableWebUi).toBe(true);
  });
});
