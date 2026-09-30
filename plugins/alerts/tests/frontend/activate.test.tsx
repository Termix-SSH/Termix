import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
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

const ITEMS = [
  {
    id: 2,
    source: "acme-ssl",
    category: "acme-ssl.renewal_failed",
    severity: "critical",
    title: "Certificate renewal failed",
    body: "rate limited",
    link: null,
    context: null,
    deliveries: [{ channelId: 1, name: "pager", ok: false, error: "HTTP 500" }],
    readAt: null,
    createdAt: new Date().toISOString(),
  },
  {
    id: 1,
    source: "termix",
    category: "termix.announcement",
    severity: "info",
    title: "Termix 2.9 is out",
    body: null,
    link: { url: "https://termix.site" },
    context: { actionText: "Read more" },
    deliveries: null,
    readAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

function stubApi() {
  const calls: Array<[string, string, unknown?]> = [];
  const api = {
    get: vi.fn(async (url: string) => {
      calls.push(["GET", url]);
      if (url.startsWith("/items"))
        return { data: { items: ITEMS, unread: 1 } };
      if (url === "/unread") return { data: { count: 1 } };
      return { data: [] };
    }),
    post: vi.fn(async (url: string, body?: unknown) => {
      calls.push(["POST", url, body]);
      return { data: { count: 0 } };
    }),
    delete: vi.fn(async (url: string) => {
      calls.push(["DELETE", url]);
      return { data: { success: true } };
    }),
    put: vi.fn(),
    patch: vi.fn(),
  } as unknown as PluginApiClient;
  return { api, calls };
}

describe(`${manifest.id} activate`, () => {
  it("registers a footer rail item, its panel and tab, the popups and its actions", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });

    expect(rendered.registered.railItems()).toEqual([
      expect.objectContaining({ id: "alerts", permission: "alerts.use" }),
    ]);
    expect(rendered.registered.panels()).toEqual(["alerts"]);
    expect(rendered.registered.tabs()).toEqual(["alerts"]);
    expect(rendered.registered.slot("shell.overlay")).toEqual([
      "alerts.toaster",
    ]);
    expect(rendered.registered.actions().sort()).toEqual([
      "alerts.open",
      "alerts.openChannels",
    ]);
  });

  it("opens the tab from its actions", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    await rendered.app.invokeAction("alerts.openChannels");
    expect(rendered.shellCalls).toContainEqual({
      method: "openSingletonTab",
      args: ["alerts"],
    });
  });

  it("removes everything it registered on deactivate", async () => {
    const app = await renderWithApp(plugin, { manifest, locales });
    await app.deactivate();
    expect(app.registered.tabs()).toEqual([]);
    expect(app.registered.panels()).toEqual([]);
    expect(app.registered.railItems()).toEqual([]);
    expect(app.registered.actions()).toEqual([]);
    expect(app.registered.slot("shell.overlay")).toEqual([]);
  });
});

describe("the alerts panel", () => {
  it("lists alerts, flags a failed delivery and marks one read", async () => {
    const { api, calls } = stubApi();
    rendered = await renderWithApp(plugin, { manifest, locales, api });

    const panel = rendered.renderPanel("alerts", { active: true });
    await waitFor(() =>
      expect(panel.textContent).toContain("Certificate renewal failed"),
    );
    expect(panel.textContent).toContain("Termix 2.9 is out");
    expect(panel.textContent).toContain("1 channel failed");
    expect(panel.textContent).toContain("Read more");

    fireEvent.click(panel.querySelector('[aria-label="Mark as read"]')!);
    await waitFor(() =>
      expect(calls).toContainEqual([
        "POST",
        "/items/read",
        { ids: [2], read: true },
      ]),
    );
  });

  it("deletes an alert", async () => {
    const { api, calls } = stubApi();
    rendered = await renderWithApp(plugin, { manifest, locales, api });

    const panel = rendered.renderPanel("alerts", { active: true });
    await waitFor(() =>
      expect(panel.textContent).toContain("Certificate renewal failed"),
    );
    fireEvent.click(panel.querySelectorAll('[aria-label="Delete"]')[0]);
    await waitFor(() => expect(calls).toContainEqual(["DELETE", "/items/2"]));
    await waitFor(() =>
      expect(panel.textContent).not.toContain("Certificate renewal failed"),
    );
  });
});
