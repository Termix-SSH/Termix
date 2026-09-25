import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix/plugin-sdk/testing";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import { StepCaOverlay } from "../../src/frontend/StepCaOverlay";
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

describe("step-ca activate", () => {
  it("registers the auth editor, the terminal overlay and the settings field", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.settingsComponents()).toEqual(["redirectUri"]);
    expect(rendered.registered.slot("terminal.overlay")).toEqual([
      "step-ca.signIn",
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
      "https://t.example/app/plugin-api/step-ca/callback",
    );
    expect(redirectUri(true, "https://t.example/")).toBe(
      "https://t.example/host/step-ca-callback",
    );
  });
});

describe("StepCaOverlay", () => {
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
    render(<StepCaOverlay {...props} />);
    const emit = (message: { type: string; [key: string]: unknown }) =>
      act(() => listener(message));
    return { props, emit };
  }

  it("starts the sign-in once, then reports a second request as a failure", () => {
    const { props, emit } = setup();
    emit({ type: "stepca_auth_required", hostId: 7 });
    expect(props.send).toHaveBeenCalledWith("stepca_start_auth", { hostId: 7 });
    expect(props.holdConnectTimeout).toHaveBeenCalledWith(true);

    emit({ type: "stepca_auth_required", hostId: 7 });
    expect(props.fail).toHaveBeenCalledWith("errors.authFailed");
  });

  it("opens the identity provider, waits, and reconnects once signed in", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { props, emit } = setup();
    emit({ type: "stepca_auth_required", hostId: 7 });
    emit({
      type: "stepca_status",
      stage: "chooser",
      requestId: "req-1",
      url: "https://idp.test/authorize?state=req-1",
    });
    fireEvent.click(screen.getByText("dialog.openBrowser"));
    expect(open).toHaveBeenCalledWith(
      "https://idp.test/authorize?state=req-1",
      "_blank",
    );
    expect(screen.getByText("dialog.waiting")).toBeTruthy();

    emit({ type: "stepca_completed", requestId: "req-1" });
    expect(props.send).toHaveBeenCalledWith("stepca_auth_completed", {
      hostId: 7,
      cols: 80,
      rows: 24,
    });
    expect(screen.queryByText("dialog.title")).toBeNull();
    open.mockRestore();
  });

  it("cancels a pending sign-in", () => {
    const { props, emit } = setup();
    emit({
      type: "stepca_status",
      stage: "chooser",
      requestId: "req-2",
      url: "https://idp.test/authorize",
    });
    fireEvent.click(screen.getByText("common.cancel"));
    expect(props.send).toHaveBeenCalledWith("stepca_cancel", {
      requestId: "req-2",
    });
  });

  it("shows a config error", () => {
    const { emit } = setup();
    emit({
      type: "stepca_config_error",
      requestId: "",
      error: "Step CA is not configured.",
    });
    expect(screen.getByText("Step CA is not configured.")).toBeTruthy();
  });
});
