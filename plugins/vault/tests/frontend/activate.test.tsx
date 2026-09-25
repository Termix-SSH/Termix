import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix/plugin-sdk/testing";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import { VaultOverlay } from "../../src/frontend/VaultOverlay";
import { VaultAuthEditor } from "../../src/frontend/VaultAuthEditor";
import { redirectUri } from "../../src/frontend/RedirectUriSetting";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";

const stubs = vi.hoisted(() => ({
  permissions: new Set<string>(["use", "share"]),
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("@termix/plugin-sdk/frontend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@termix/plugin-sdk/frontend")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.name ? `${key}:${options.name}` : key,
  }),
  usePluginApi: () => stubs.api,
  usePermission: (permission: string) => stubs.permissions.has(permission),
  useToast: () => stubs.toast,
}));

const manifest = manifestJson as unknown as PluginManifest;

let rendered: RenderedPluginApp | null = null;

beforeEach(() => {
  stubs.permissions = new Set(["use", "share"]);
  for (const fn of Object.values(stubs.api)) fn.mockReset();
  stubs.api.get.mockResolvedValue({ data: [] });
});

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

describe("vault activate", () => {
  it("registers the terminal overlay and the settings field, and removes them on deactivate", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.settingsComponents()).toEqual(["redirectUri"]);
    expect(rendered.registered.slot("terminal.overlay")).toEqual([
      "vault.signIn",
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
      "https://t.example/app/plugin-api/vault/oidc/callback",
    );
    expect(redirectUri(true, "https://t.example/")).toBe(
      "https://t.example/vault/oidc/callback",
    );
  });
});

describe("VaultAuthEditor", () => {
  const profiles = [
    {
      id: 3,
      name: "Prod",
      vaultAddr: "https://v",
      sshRole: "r",
      shared: false,
      owned: true,
    },
    {
      id: 4,
      name: "Team",
      vaultAddr: "https://v",
      sshRole: "r",
      shared: true,
      owned: false,
    },
  ];

  it("lists the profiles and stores the choice as the profileId host setting", async () => {
    stubs.api.get.mockResolvedValue({ data: profiles });
    const setField = vi.fn();
    render(
      <VaultAuthEditor
        form={{ pluginSettings: { other: { x: 1 } } }}
        setField={setField}
      />,
    );
    await waitFor(() => expect(screen.getByText("Prod")).toBeTruthy());
    expect(stubs.api.get).toHaveBeenCalledWith("/profiles");
    expect(screen.getByText("editor.sharedProfile:Team")).toBeTruthy();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "4" } });
    expect(setField).toHaveBeenCalledWith("pluginSettings", {
      other: { x: 1 },
      vault: { profileId: 4 },
    });
  });

  it("shows the saved profile", async () => {
    stubs.api.get.mockResolvedValue({ data: profiles });
    render(
      <VaultAuthEditor
        form={{ pluginSettings: { vault: { profileId: 3 } } }}
        setField={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
        "3",
      ),
    );
  });

  it("creates a profile from the manager, shared only with the share permission", async () => {
    stubs.api.post.mockResolvedValue({ data: {} });
    render(<VaultAuthEditor form={{}} setField={vi.fn()} />);
    fireEvent.click(screen.getByText("profiles.manage"));
    fireEvent.click(screen.getByText("profiles.new"));
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "Prod" } });
    fireEvent.change(inputs[1], { target: { value: "https://vault:8200" } });
    fireEvent.change(inputs[6], { target: { value: "ops" } });
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => {
      fireEvent.click(screen.getByText("profiles.create"));
    });
    expect(stubs.api.post).toHaveBeenCalledWith(
      "/profiles",
      expect.objectContaining({
        name: "Prod",
        vaultAddr: "https://vault:8200",
        sshRole: "ops",
        shared: true,
      }),
    );
  });

  it("hides sharing without the share permission and managing without use", async () => {
    stubs.permissions = new Set(["use"]);
    const { unmount } = render(
      <VaultAuthEditor form={{}} setField={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("profiles.manage"));
    fireEvent.click(screen.getByText("profiles.new"));
    expect(screen.queryByRole("checkbox")).toBeNull();
    unmount();

    stubs.permissions = new Set();
    stubs.api.get.mockClear();
    render(<VaultAuthEditor form={{}} setField={vi.fn()} />);
    expect(screen.queryByText("profiles.manage")).toBeNull();
    expect(stubs.api.get).not.toHaveBeenCalled();
  });
});

describe("VaultOverlay", () => {
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
    render(<VaultOverlay {...props} />);
    const emit = (message: { type: string; [key: string]: unknown }) =>
      act(() => listener(message));
    return { props, emit };
  }

  it("starts the sign-in once, then reports a second request as a failure", () => {
    const { props, emit } = setup();
    emit({ type: "vault_auth_required", hostId: 7 });
    expect(props.send).toHaveBeenCalledWith("vault_start_auth", { hostId: 7 });
    expect(props.holdConnectTimeout).toHaveBeenCalledWith(true);

    emit({ type: "vault_auth_required", hostId: 7 });
    expect(props.fail).toHaveBeenCalledWith("dialog.failed");
  });

  it("opens Vault's sign-in, waits, and reconnects once signed", () => {
    const close = vi.fn();
    const open = vi
      .spyOn(window, "open")
      .mockReturnValue({ close, focus: vi.fn() } as unknown as Window);
    const { props, emit } = setup();
    emit({ type: "vault_auth_required", hostId: 7 });
    emit({
      type: "vault_auth_url",
      hostId: 7,
      requestId: "st-1",
      url: "https://idp.test/authorize",
    });
    expect(open).toHaveBeenCalledWith(
      "https://idp.test/authorize",
      "termix-vault-oidc",
      "width=540,height=720",
    );
    expect(screen.getByText("dialog.description")).toBeTruthy();

    emit({ type: "vault_completed", hostId: 7 });
    expect(close).toHaveBeenCalled();
    expect(props.send).toHaveBeenCalledWith("vault_auth_completed", {
      hostId: 7,
      cols: 80,
      rows: 24,
    });
    expect(screen.queryByText("dialog.title")).toBeNull();
    open.mockRestore();
  });

  it("cancels a pending sign-in", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { props, emit } = setup();
    emit({
      type: "vault_auth_url",
      hostId: 7,
      requestId: "st-2",
      url: "https://idp.test/authorize",
    });
    fireEvent.click(screen.getByText("common.cancel"));
    expect(props.send).toHaveBeenCalledWith("vault_cancel", {
      hostId: 7,
      requestId: "st-2",
    });
    open.mockRestore();
  });

  it("shows Vault's error", () => {
    const { emit } = setup();
    emit({ type: "vault_error", hostId: 7, error: "permission denied" });
    expect(screen.getByText("permission denied")).toBeTruthy();
  });
});
