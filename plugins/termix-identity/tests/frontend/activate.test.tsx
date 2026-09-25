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

let rendered: RenderedPluginApp | null = null;

type ElectronWindow = Window & { electronAPI?: unknown };

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
  delete (window as ElectronWindow).electronAPI;
});

const IDENTITY = {
  id: 1,
  userId: "user-1",
  handle: "alice",
  description: null,
  resolverPath: "/plugin-api/termix-identity/u/alice",
  resolverUrl: "https://termix.test/plugin-api/termix-identity/u/alice",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const KEY = {
  id: 4,
  identityId: 1,
  userId: "user-1",
  publicKey: "ssh-ed25519 AAAAC3Nza",
  keyType: "ssh-ed25519",
  algorithm: "ED25519",
  label: "Laptop",
  comment: null,
  source: "credential",
  credentialId: 9,
  enabled: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function stubApi(options: { identity?: boolean; linked?: number[] } = {}) {
  const routes: Record<string, unknown> = {
    "/me":
      options.identity === false
        ? { identity: null, keys: [] }
        : { identity: IDENTITY, keys: [KEY] },
    "/ca": { ca: null },
    "/linked-credentials": { credentialIds: options.linked ?? [9] },
    "/credentials": { credentials: [{ id: 9, name: "Work key" }] },
    "/check/bob": { available: true, valid: true },
  };
  return {
    get: vi.fn(async (url: string) => ({ data: routes[url] })),
    post: vi.fn(async () => ({ data: IDENTITY })),
    put: vi.fn(async () => ({ data: {} })),
    patch: vi.fn(async () => ({ data: KEY })),
    delete: vi.fn(async () => ({ data: { success: true } })),
  };
}

describe(`${manifest.id} activate`, () => {
  it("registers the rail item, panel, tab and credential badge", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.railItems()).toEqual([
      expect.objectContaining({
        id: "termix-id",
        hidden: false,
        permission: "termix-identity.use",
      }),
    ]);
    expect(rendered.registered.panels()).toEqual(["termix-id"]);
    expect(rendered.registered.tabs()).toEqual(["termix-id"]);
    expect(rendered.registered.slot("credentials.badges")).toEqual([
      "termix-identity.credentialBadge",
    ]);
  });

  it("removes everything it registered on deactivate", async () => {
    const app = await renderWithApp(plugin, { manifest, locales });
    await app.deactivate();
    expect(app.registered.tabs()).toEqual([]);
    expect(app.registered.panels()).toEqual([]);
    expect(app.registered.railItems()).toEqual([]);
    expect(app.registered.slot("credentials.badges")).toEqual([]);
  });

  it("hides the rail item in a standalone desktop app", async () => {
    (window as ElectronWindow).electronAPI = {
      isElectron: true,
      invoke: vi.fn(async () => null),
      onRemoteSyncStatusChanged: () => () => {},
    };
    rendered = await renderWithApp(plugin, { manifest, locales });
    await waitFor(() =>
      expect(rendered!.registered.railItems()).toEqual([
        expect.objectContaining({ id: "termix-id", hidden: true }),
      ]),
    );
  });

  it("shows the rail item once the desktop app has a remote server", async () => {
    let notify = () => {};
    let serverUrl: string | null = null;
    (window as ElectronWindow).electronAPI = {
      isElectron: true,
      invoke: vi.fn(async () => (serverUrl ? { serverUrl } : null)),
      onRemoteSyncStatusChanged: (callback: () => void) => {
        notify = callback;
        return () => {};
      },
    };
    rendered = await renderWithApp(plugin, { manifest, locales });
    await waitFor(() =>
      expect(rendered!.registered.railItems()[0]?.hidden).toBe(true),
    );

    serverUrl = "https://termix.example";
    notify();
    await waitFor(() =>
      expect(rendered!.registered.railItems()).toEqual([
        expect.objectContaining({ id: "termix-id", hidden: false }),
      ]),
    );
  });
});

describe("termix id panel", () => {
  it("offers to claim a handle when the user has none", async () => {
    const api = stubApi({ identity: false });
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api as unknown as PluginApiClient,
    });
    rendered.renderPanel("termix-id");

    expect(await screen.findByText(locales.termixId.claimIntro)).toBeTruthy();
    fireEvent.change(
      screen.getByPlaceholderText(locales.termixId.handlePlaceholder),
      { target: { value: "bob" } },
    );
    expect(await screen.findByText(locales.termixId.available)).toBeTruthy();
    fireEvent.click(screen.getByText(locales.termixId.create));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/", {
        handle: "bob",
        description: undefined,
      }),
    );
  });

  it("shows the handle, the resolver URL and the published keys", async () => {
    const api = stubApi();
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api as unknown as PluginApiClient,
    });
    rendered.renderPanel("termix-id");

    expect(await screen.findByText("@alice")).toBeTruthy();
    expect(screen.getByText(IDENTITY.resolverUrl)).toBeTruthy();
    expect(screen.getByText("Laptop")).toBeTruthy();
    expect(screen.getByText(KEY.publicKey)).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith("/credentials");
  });
});

describe("credential badge", () => {
  it("marks a credential whose key is published", async () => {
    const api = stubApi({ linked: [9] });
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api as unknown as PluginApiClient,
      permissions: ["termix-identity.use"],
    });

    const linked = rendered.renderSlot("credentials.badges", {
      credentialId: 9,
    });
    await waitFor(() =>
      expect(linked.textContent).toContain(locales.credentials.idBadge),
    );
    expect(api.get).toHaveBeenCalledWith("/linked-credentials");
  });

  it("shows nothing for a credential that is not published", async () => {
    const api = stubApi({ linked: [9] });
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api as unknown as PluginApiClient,
      permissions: ["termix-identity.use"],
    });
    const other = rendered.renderSlot("credentials.badges", {
      credentialId: 3,
    });
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith("/linked-credentials"),
    );
    expect(other.textContent).not.toContain(locales.credentials.idBadge);
  });

  it("does not ask without termix-identity.use", async () => {
    const api = stubApi();
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api as unknown as PluginApiClient,
      permissions: [],
    });
    rendered.renderSlot("credentials.badges", { credentialId: 9 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.get).not.toHaveBeenCalledWith("/linked-credentials");
  });
});
