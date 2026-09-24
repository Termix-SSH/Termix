import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import type { PluginApiClient } from "@termix/plugin-sdk/frontend";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix/plugin-sdk/testing";
import { PluginComponent } from "@termix/plugin-sdk/ui";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import SharedSessionView from "../../src/frontend/SharedSessionView";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";

vi.mock("react-xtermjs", () => ({
  useXTerm: () => ({
    instance: {
      options: {},
      loadAddon: vi.fn(),
      open: vi.fn(),
      write: vi.fn(),
      onData: vi.fn(),
    },
    ref: { current: document.createElement("div") },
  }),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class FitAddon {
    fit() {}
  },
}));

const manifest = manifestJson as unknown as PluginManifest;
const guestView = locales.sessionSharing.guestView;

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status } });
}

/** The shared-link page, rendered as a guest inside the plugin's scope. */
async function renderShared(search: string, get: PluginApiClient["get"]) {
  window.history.pushState({}, "", `/?${search}`);
  rendered = await renderWithApp(plugin, {
    manifest,
    locales,
    guest: true,
    api: { get } as unknown as PluginApiClient,
  });
  rendered.app.registerComponent(
    "session-sharing.testSharedView",
    SharedSessionView as ComponentType<Record<string, unknown>>,
  );
  rendered.app.registerSlotContribution("session.remoteDisplay", {
    actionId: "fixture.display",
    titleKey: "nav.collab",
    kind: "component",
    component: () => <div data-testid="remote-display" />,
  });
  render(<PluginComponent id="session-sharing.testSharedView" />);
}

describe("SharedSessionView", () => {
  it("says the link is invalid when there is no token", async () => {
    const get = vi.fn();
    await renderShared("view=shared", get as never);
    expect(await screen.findByText(guestView.linkInvalid)).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
  });

  it("says the link is invalid for a revoked or expired link", async () => {
    await renderShared(
      "view=shared&token=gone",
      vi.fn(async () => {
        throw httpError(404);
      }) as never,
    );
    expect(await screen.findByText(guestView.linkInvalid)).toBeTruthy();
  });

  it("asks the guest to wait when rate limited", async () => {
    await renderShared(
      "view=shared&token=busy",
      vi.fn(async () => {
        throw httpError(429);
      }) as never,
    );
    expect(await screen.findByText(guestView.rateLimited)).toBeTruthy();
  });

  it("draws a remote desktop share through the display slot", async () => {
    const get = vi.fn(async () => ({
      data: {
        protocol: "rdp",
        permissionLevel: "read-only",
        wsPath: "/plugin-ws/remote-desktop/display",
        connectParams: { token: "t" },
      },
    }));
    await renderShared("view=shared&token=ok", get as never);
    expect(await screen.findByTestId("remote-display")).toBeTruthy();
    expect(screen.getByText(guestView.readOnlyBadge)).toBeTruthy();
    expect(get).toHaveBeenCalledWith("/resolve/ok");
  });
});
