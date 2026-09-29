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
const PERMISSIONS = [
  "snippets.view",
  "snippets.create",
  "snippets.edit",
  "snippets.delete",
  "snippets.share",
];

const HOSTS = [
  { id: "5", name: "web-1", ip: "10.0.0.5", port: 22, username: "root" },
];

function snippet(overrides: Record<string, unknown>) {
  return {
    id: 1,
    userId: "u1",
    name: "List files",
    content: "ls -la",
    description: null,
    folder: null,
    order: 0,
    hostFilter: null,
    isNote: false,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

function fakeApi(snippets: unknown[], folders: unknown[] = []) {
  const api = {
    get: vi.fn(async (path: string) => {
      if (path === "/folders") return { data: folders };
      if (path === "/share-targets/users")
        return { data: { users: [{ id: "u2", username: "bob" }] } };
      if (path === "/share-targets/roles") return { data: { roles: [] } };
      if (path.endsWith("/access")) return { data: [] };
      return { data: snippets };
    }),
    post: vi.fn(async (path: string) => ({
      data: path === "/execute" ? { success: true, output: "up 3 days" } : {},
    })),
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

async function renderPanel(api: PluginApiClient) {
  rendered = await renderWithApp(plugin, {
    manifest,
    locales,
    api,
    permissions: PERMISSIONS,
    hosts: HOSTS as never,
  });
  rendered.renderPanel("snippets", { active: true });
}

describe("snippets panel", () => {
  it("lists root snippets with their command", async () => {
    await renderPanel(fakeApi([snippet({})]));
    expect(await screen.findByText("List files")).toBeTruthy();
    expect(screen.getByText("ls -la")).toBeTruthy();
  });

  it("shows empty folders and opens them on click", async () => {
    const api = fakeApi(
      [snippet({ id: 2, name: "Restart nginx", folder: "Web" })],
      [
        { id: 1, name: "Web", color: null, icon: "server" },
        { id: 2, name: "Empty", color: null, icon: null },
      ],
    );
    await renderPanel(api);
    fireEvent.click(await screen.findByText("Web"));
    expect(await screen.findByText("Restart nginx")).toBeTruthy();
    expect(screen.getByText("Empty")).toBeTruthy();
  });

  it("filters by content and opens matching folders", async () => {
    const api = fakeApi([
      snippet({ id: 1, name: "One", content: "uptime" }),
      snippet({ id: 2, name: "Two", content: "df -h", folder: "Disk" }),
    ]);
    await renderPanel(api);
    await screen.findByText("One");
    fireEvent.change(screen.getByPlaceholderText(/search snippets/i), {
      target: { value: "df" },
    });
    expect(await screen.findByText("Two")).toBeTruthy();
    expect(screen.queryByText("One")).toBeNull();
  });

  it("creates a snippet in the inline editor", async () => {
    const api = fakeApi([]);
    await renderPanel(api);
    await screen.findByText(locales.emptyTitle);
    fireEvent.click(screen.getByTitle(locales.newSnippet));
    fireEvent.change(screen.getByPlaceholderText(locales.namePlaceholder), {
      target: { value: "Uptime" },
    });
    fireEvent.change(screen.getByPlaceholderText(locales.commandPlaceholder), {
      target: { value: "uptime" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: locales.createSnippetButton }),
    );
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/", {
        name: "Uptime",
        content: "uptime",
        description: null,
        folder: null,
        isNote: false,
        hostFilter: null,
      }),
    );
    expect(await screen.findByPlaceholderText(/search snippets/i)).toBeTruthy();
  });

  it("opens the settings page and goes back", async () => {
    await renderPanel(fakeApi([]));
    await screen.findByText(locales.emptyTitle);
    fireEvent.click(screen.getByTitle(locales.settingsTitle));
    expect(
      await screen.findByText(locales.settings.foldersCollapsed.label),
    ).toBeTruthy();
    fireEvent.click(screen.getByText(locales.backToSnippets));
    expect(await screen.findByText(locales.emptyTitle)).toBeTruthy();
  });

  it("shares a snippet with a user", async () => {
    const api = fakeApi([snippet({})]);
    await renderPanel(api);
    await screen.findByText("List files");
    fireEvent.click(screen.getByTitle(locales.shareSnippet));
    fireEvent.click(await screen.findByText("bob"));
    fireEvent.click(screen.getByRole("button", { name: /share with 1/i }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/1/share", {
        targetType: "user",
        targetUserId: "u2",
        expiresAt: null,
      }),
    );
    expect(await screen.findByText(locales.notSharedYet)).toBeTruthy();
    fireEvent.click(screen.getByText(/share "list files"/i));
    expect(await screen.findByText("List files")).toBeTruthy();
  });

  it("runs a snippet with target hosts on those hosts", async () => {
    const api = fakeApi([snippet({ hostFilter: "[5]" })]);
    await renderPanel(api);
    expect(await screen.findByText("web-1")).toBeTruthy();
    fireEvent.click(screen.getByTitle(locales.runOnTargets));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/execute", {
        snippetId: 1,
        hostId: 5,
        inputValues: undefined,
      }),
    );
    expect(await screen.findByText("up 3 days")).toBeTruthy();
  });

  it("reorders snippets by dragging", async () => {
    const api = fakeApi([
      snippet({ id: 1, name: "First", order: 0 }),
      snippet({ id: 2, name: "Second", order: 1 }),
    ]);
    await renderPanel(api);
    const row = (name: string) =>
      screen.getByText(name).closest("[draggable]") as HTMLElement;
    await screen.findByText("First");
    // jsdom has no layout, so a drop always lands below the target row.
    fireEvent.dragStart(row("First"), {
      dataTransfer: { effectAllowed: "" },
    });
    fireEvent.dragOver(row("Second"));
    fireEvent.drop(row("Second"));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/reorder", {
        snippets: [
          { id: 2, order: 0, folder: "" },
          { id: 1, order: 1, folder: "" },
        ],
      }),
    );
  });
});
