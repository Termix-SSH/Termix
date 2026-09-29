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
    get: vi.fn(async (path: string) => ({
      data: path === "/folders" ? folders : snippets,
    })),
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

async function renderPanel(api: PluginApiClient) {
  rendered = await renderWithApp(plugin, {
    manifest,
    locales,
    api,
    permissions: PERMISSIONS,
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
});
