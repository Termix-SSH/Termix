import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix/plugin-sdk/testing";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import type { PluginApiClient } from "@termix/plugin-sdk/frontend";
import * as plugin from "../../src/frontend/index";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";

const manifest = manifestJson as unknown as PluginManifest;
const TARGET = { headers: { "X-Admin-Target-User": "u2" } };

function fakeApi(rows: unknown[]) {
  const api = {
    get: vi.fn(async () => ({ data: rows })),
    post: vi.fn(async () => ({ data: {} })),
    put: vi.fn(async () => ({ data: {} })),
    patch: vi.fn(async () => ({ data: {} })),
    delete: vi.fn(async () => ({ data: {} })),
  };
  return api as typeof api & PluginApiClient;
}

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

describe("snippet.list", () => {
  it("lists the user's own snippets", async () => {
    const api = fakeApi([{ id: 1, name: "a", content: "ls", isNote: true }]);
    rendered = await renderWithApp(plugin, { manifest, locales, api });
    const rows = await rendered.app.invokeAction("snippet.list");
    expect(api.get).toHaveBeenCalledWith("/");
    expect(rows).toEqual([
      { id: 1, name: "a", content: "ls", folder: null, isNote: true },
    ]);
  });

  it("lists another user's snippets for an admin", async () => {
    const api = fakeApi([]);
    rendered = await renderWithApp(plugin, { manifest, locales, api });
    await rendered.app.invokeAction("snippet.list", { targetUserId: "u2" });
    expect(api.get).toHaveBeenCalledWith("/", TARGET);
  });
});

describe("admin user snippets tab", () => {
  it("fills the admin.userTabs slot", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.slot("admin.userTabs")).toEqual([
      "snippets.adminUserTab",
    ]);
  });

  it("creates a snippet for the target user", async () => {
    const api = fakeApi([]);
    rendered = await renderWithApp(plugin, { manifest, locales, api });
    rendered.renderSlot("admin.userTabs", {
      user: { id: "u2", username: "bob" },
    });

    fireEvent.click(await screen.findByText("Add Snippet"));
    fireEvent.change(screen.getByPlaceholderText("Snippet name"), {
      target: { value: "restart" },
    });
    fireEvent.change(screen.getByPlaceholderText("Command content"), {
      target: { value: "systemctl restart nginx" },
    });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/",
        { name: "restart", content: "systemctl restart nginx", folder: null },
        TARGET,
      ),
    );
  });
});
