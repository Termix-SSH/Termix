import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix/plugin-sdk/testing";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import { OpksshOverlay } from "../../src/frontend/OpksshOverlay";
import { redirectUri } from "../../src/frontend/RedirectUriSetting";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";

vi.mock("@termix/plugin-sdk/frontend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@termix/plugin-sdk/frontend")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

const manifest = manifestJson as unknown as PluginManifest;

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

describe("opkssh activate", () => {
  it("registers the auth editor, the terminal overlay and the settings field", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.settingsComponents()).toEqual(["redirectUri"]);
    expect(rendered.registered.slot("terminal.overlay")).toEqual([
      "opkssh.signIn",
    ]);
    await rendered.deactivate();
    expect(rendered.registered.settingsComponents()).toEqual([]);
    expect(rendered.registered.slot("terminal.overlay")).toEqual([]);
    rendered = null;
  });
});

describe("redirectUri", () => {
  it("names the plugin callback, or the 2.8 one", () => {
    expect(redirectUri(false, "https://t.example/app/")).toBe(
      "https://t.example/app/plugin-api/opkssh/callback",
    );
    expect(redirectUri(true, "https://t.example/")).toBe(
      "https://t.example/host/opkssh-callback",
    );
  });
});

describe("OpksshOverlay", () => {
  function setup() {
    let listener: (message: {
      type: string;
      [key: string]: unknown;
    }) => void = () => {};
    const props = {
      host: { id: 7 },
      subscribe: vi.fn((next: typeof listener) => {
        listener = next;
        return () => {};
      }),
      holdConnectTimeout: vi.fn(),
      fail: vi.fn(),
      disconnect: vi.fn(),
      send: vi.fn(),
      connectPayload: vi.fn(() => ({ hostId: 7, cols: 80, rows: 24 })),
    };
    render(<OpksshOverlay {...props} />);
    const emit = (message: { type: string; [key: string]: unknown }) =>
      act(() => listener(message));
    return { props, emit };
  }

  it("starts the sign-in once, then reports a second request as a failure", () => {
    const { props, emit } = setup();
    emit({ type: "opkssh_auth_required", hostId: 7 });
    expect(props.send).toHaveBeenCalledWith("opkssh_start_auth", { hostId: 7 });
    expect(props.holdConnectTimeout).toHaveBeenCalledWith(true);

    emit({ type: "opkssh_auth_required", hostId: 7 });
    expect(props.fail).toHaveBeenCalledWith("errors.authFailed");
  });

  it("shows the chooser, cancels it, and reconnects once signed in", () => {
    const { props, emit } = setup();
    emit({ type: "opkssh_auth_required", hostId: 7 });
    emit({
      type: "opkssh_status",
      stage: "chooser",
      requestId: "req-1",
      url: "https://termix.test/plugin-api/opkssh/chooser/req-1",
      providers: [{ alias: "google", issuer: "accounts.google.com" }],
    });
    expect(screen.getByText("dialog.title")).toBeTruthy();

    emit({ type: "opkssh_completed", requestId: "req-1" });
    expect(props.send).toHaveBeenCalledWith("opkssh_auth_completed", {
      hostId: 7,
      cols: 80,
      rows: 24,
    });
    expect(screen.queryByText("dialog.title")).toBeNull();

    emit({
      type: "opkssh_status",
      stage: "chooser",
      requestId: "req-2",
      url: "https://termix.test/plugin-api/opkssh/chooser/req-2",
    });
    fireEvent.click(screen.getByText("common.cancel"));
    expect(props.send).toHaveBeenCalledWith("opkssh_cancel", {
      requestId: "req-2",
    });
  });

  it("shows a config error", () => {
    const { emit } = setup();
    emit({
      type: "opkssh_config_error",
      requestId: "",
      error: "OPKSSH configuration not found.",
    });
    expect(screen.getByText("OPKSSH configuration not found.")).toBeTruthy();
  });
});
