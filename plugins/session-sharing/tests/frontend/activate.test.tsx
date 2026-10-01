import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import {
  invokeAction,
  type PluginApiClient,
} from "@termix/plugin-sdk/frontend";
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

function stubApi(overrides: Partial<PluginApiClient> = {}): PluginApiClient {
  return {
    get: vi.fn(async (url: string) => ({
      data:
        url === "/directory"
          ? { users: [{ id: "bob", username: "bob" }], roles: [] }
          : url.includes("/active")
            ? { shares: [] }
            : url === "/rooms"
              ? { rooms: [] }
              : {},
    })),
    post: vi.fn(async () => ({
      data: { shareId: "s1", linkToken: "tok", expiresAt: "2999-01-01" },
    })),
    put: vi.fn(async () => ({ data: {} })),
    patch: vi.fn(async () => ({ data: {} })),
    delete: vi.fn(async () => ({ data: {} })),
    ...overrides,
  } as PluginApiClient;
}

describe("session-sharing activate", () => {
  it("registers the rooms rail item, panel and tab, and the share buttons", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: stubApi(),
    });

    expect(rendered.registered.railItems()).toEqual([
      expect.objectContaining({
        id: "collab",
        permission: "session-sharing.use",
      }),
    ]);
    expect(rendered.registered.panels()).toEqual(["collab"]);
    expect(rendered.registered.tabs()).toEqual(["collab"]);
    expect(rendered.registered.slot("terminal.toolbar")).toEqual([
      "session-sharing.share",
    ]);
    expect(rendered.registered.slot("remote-desktop.toolbar")).toEqual([
      "session-sharing.share",
    ]);
    expect(rendered.registered.slot("tab.inline")).toEqual([
      "session-sharing.share",
    ]);
    expect(rendered.registered.slot("shell.overlay")).toHaveLength(2);
    expect(rendered.registered.actions().sort()).toEqual([
      "session-sharing.share",
    ]);
    expect(rendered.registered.slot("connections.sections")).toEqual([
      "session-sharing.sharedWithMe",
    ]);
  });

  it("shows terminal participants and clears them after the last guest leaves or the socket closes", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: stubApi(),
    });
    expect(rendered.registered.slot("terminal.overlay")).toEqual([
      "session-sharing.participants",
    ]);
    let receive: (message: {
      type: string;
      [key: string]: unknown;
    }) => void = () => {};
    const unsubscribe = vi.fn();
    rendered.renderSlot("terminal.overlay", {
      subscribe: (listener: typeof receive) => {
        receive = listener;
        return unsubscribe;
      },
    });
    const owner = { isOwner: true, permissionLevel: "read-write", label: null };
    const guest = {
      isOwner: false,
      permissionLevel: "read-only",
      label: "Guest 1",
    };
    await act(() =>
      receive({ type: "participants", participants: [owner, guest] }),
    );
    expect(
      screen.getByTitle(
        `${locales.sessionSharing.guestView.ownerLabel}, Guest 1`,
      ).textContent,
    ).toBe("2");
    await act(() => receive({ type: "participants", participants: [owner] }));
    expect(screen.queryByText("2")).toBeNull();
    await act(() =>
      receive({ type: "participants", participants: [owner, guest] }),
    );
    await act(() => receive({ type: "session_closed" }));
    expect(screen.queryByText("2")).toBeNull();
    await rendered.deactivate();
    expect(unsubscribe).toHaveBeenCalled();
    rendered = null;
  });

  it("registers only the guest views on a guest page", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: stubApi(),
      guest: true,
    });
    expect(rendered.registered.tabs()).toEqual(["collab"]);
    expect(rendered.registered.railItems()).toEqual([]);
    expect(rendered.registered.actions()).toEqual([]);
  });

  it("opens the share dialog for a terminal's session", async () => {
    const api = stubApi();
    rendered = await renderWithApp(plugin, { manifest, locales, api });
    rendered.renderSlot("shell.overlay");

    await act(() =>
      invokeAction("session-sharing.share", {
        getShareTarget: () => ({
          hostId: 4,
          sessionId: "sess-9",
          protocol: "ssh",
        }),
      }),
    );

    expect(
      await screen.findByText(locales.sessionSharing.modalTitle),
    ).toBeTruthy();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/host/4/active"));
  });

  it("opens the dialog for a remote desktop session once it is up", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: stubApi(),
    });
    rendered.renderSlot("shell.overlay");

    await act(() =>
      invokeAction("session-sharing.share", {
        hostId: 2,
        sessionId: null,
        protocol: "rdp",
      }),
    );
    expect(screen.queryByText(locales.sessionSharing.modalTitle)).toBeNull();

    await act(() =>
      invokeAction("session-sharing.share", {
        hostId: 2,
        sessionId: "guac-1",
        protocol: "rdp",
      }),
    );
    expect(
      await screen.findByText(locales.sessionSharing.modalTitle),
    ).toBeTruthy();
  });

  it("creates a link share from the dialog", async () => {
    const api = stubApi();
    rendered = await renderWithApp(plugin, { manifest, locales, api });
    rendered.renderSlot("shell.overlay");
    await act(() =>
      invokeAction("session-sharing.share", {
        getShareTarget: () => ({
          hostId: 1,
          sessionId: "sess-1",
          protocol: "ssh",
        }),
      }),
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: locales.sessionSharing.createLinkButton,
      }),
    );
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/create",
        expect.objectContaining({
          hostId: 1,
          sessionId: "sess-1",
          shareType: "link",
          permissionLevel: "read-only",
        }),
      ),
    );
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
    expect(app.registered.slot("terminal.toolbar")).toEqual([]);
    expect(app.registered.actions()).toEqual([]);
  });
});
