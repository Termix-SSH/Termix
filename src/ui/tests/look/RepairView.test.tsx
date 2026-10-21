import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && typeof options === "object" && !("defaultValue" in options)
        ? `${key}:${JSON.stringify(options)}`
        : ((options?.defaultValue as string | undefined) ?? key),
    i18n: { language: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const permissions = vi.hoisted(() => ({ isAdmin: true }));
vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => ({
    isAdmin: permissions.isAdmin,
    permissions: [],
    loaded: true,
    has: () => permissions.isAdmin,
  }),
}));

vi.mock("@/shell/controller/ShellControllerProvider", () => ({
  ShellConfirmCapture: () => null,
}));

const plugins = vi.hoisted(() => ({
  restoreBundledPlugin: vi.fn(async () => {}),
}));
vi.mock("@/api/plugins-api", () => plugins);
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const look = vi.hoisted(() => ({
  chooseLayout: vi.fn(async () => {}),
  chooseThemeForAccount: vi.fn(async () => {}),
  chooseDefaultLook: vi.fn(async () => {}),
  chooseTheme: vi.fn(),
}));
vi.mock("@/look/look-store", () => ({
  chooseLayout: look.chooseLayout,
  chooseThemeForAccount: look.chooseThemeForAccount,
  chooseDefaultLook: look.chooseDefaultLook,
}));
vi.mock("@/look/use-look-theme", () => ({
  useChooseTheme: () => look.chooseTheme,
}));

const fancy = vi.hoisted(() => ({ enabled: true }));

const manager = vi.hoisted(() => ({
  requestUpdate: vi.fn(),
  requestInstall: vi.fn(),
  toggle: vi.fn(),
  setConsent: vi.fn(),
  confirmConsent: vi.fn(),
}));
vi.mock("@/plugins/use-plugins-manager", () => ({
  usePluginsManager: () => ({
    ...manager,
    loading: false,
    registryError: null,
    consent: null,
    busy: new Set<string>(),
    plugins: [
      {
        id: "fancy-layout",
        name: "Fancy",
        installed: true,
        enabled: fancy.enabled,
        updateAvailable: true,
        latestVersion: "1.1.0",
        managedByServer: false,
        bundled: true,
        versions: [],
      },
      {
        id: "paper-themes",
        name: "Paper themes",
        description: "Light themes",
        installed: false,
        enabled: false,
        updateAvailable: false,
        latestVersion: "1.0.0",
        versions: [{ version: "1.0.0", capabilities: ["ui:theme"] }],
      },
      {
        id: "docker",
        name: "Docker",
        installed: false,
        versions: [{ version: "1.0.0", capabilities: ["ui:surface"] }],
      },
    ],
  }),
}));

import { RepairView } from "@/look/RepairView";
import { setPluginLayouts } from "@/look/layout-registry";

const status = {
  kind: "repair" as const,
  reason: "failed" as const,
  layoutId: "fancy",
  pluginId: "fancy-layout",
  version: "1.0.0",
  error: "activate threw",
};

const onRetry = vi.fn();

beforeEach(() => {
  permissions.isAdmin = true;
  fancy.enabled = true;
  for (const fn of [
    ...Object.values(look),
    ...Object.values(manager),
    plugins.restoreBundledPlugin,
    onRetry,
  ]) {
    fn.mockClear();
  }
  setPluginLayouts([
    { id: "fancy", label: "Fancy", pluginId: "fancy-layout" },
    { id: "classic", label: "Classic", pluginId: "classic-layout" },
  ]);
});
afterEach(cleanup);

describe("RepairView", () => {
  it("names the layout and the error, and copies the details", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    render(<RepairView status={status} onRetry={onRetry} />);
    expect(screen.getByText("activate threw")).toBeTruthy();
    expect(screen.getByText("looks.repair.reasons.failed")).toBeTruthy();
    fireEvent.click(screen.getByText("looks.repair.copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = String((writeText.mock.calls[0] as unknown[])[0]);
    expect(copied).toContain("fancy");
    expect(copied).toContain("activate threw");
  });

  it("retries", () => {
    render(<RepairView status={status} onRetry={onRetry} />);
    fireEvent.click(screen.getByText("looks.repair.retry"));
    expect(onRetry).toHaveBeenCalled();
  });

  it("switches to another layout or theme", () => {
    render(<RepairView status={status} onRetry={onRetry} />);
    fireEvent.click(screen.getByText("Classic"));
    expect(look.chooseLayout).toHaveBeenCalledWith("classic");
    fireEvent.click(
      screen.getAllByTitle("newUi.sidebar.userProfile.themeLight")[0],
    );
    expect(look.chooseTheme).toHaveBeenCalledWith("light");
  });

  it("resets to the default look", async () => {
    localStorage.setItem("vite-ui-theme", "dracula");
    render(<RepairView status={status} onRetry={onRetry} />);
    fireEvent.click(screen.getByText("looks.repair.reset"));
    await waitFor(() => expect(look.chooseLayout).toHaveBeenCalledWith(null));
    expect(look.chooseThemeForAccount).toHaveBeenCalledWith(null);
    expect(localStorage.getItem("vite-ui-theme")).toBeNull();
    fireEvent.click(screen.getByText("looks.repair.resetEveryone"));
    expect(look.chooseDefaultLook).toHaveBeenCalledWith({
      layout: null,
      theme: null,
    });
  });

  it("lets an admin update or turn off the plugin", () => {
    render(<RepairView status={status} onRetry={onRetry} />);
    fireEvent.click(
      screen.getByText(
        'looks.repair.update:{"name":"Fancy","version":"1.1.0"}',
      ),
    );
    expect(manager.requestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "fancy-layout" }),
    );
    fireEvent.click(screen.getByText('looks.repair.disable:{"name":"Fancy"}'));
    expect(manager.toggle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "fancy-layout" }),
    );
  });

  it("lets an admin turn the plugin back on and then tries again", async () => {
    fancy.enabled = false;
    manager.toggle.mockResolvedValue(undefined);
    render(
      <RepairView
        status={{ ...status, reason: "disabled", error: null }}
        onRetry={onRetry}
      />,
    );
    expect(screen.queryByText(/looks\.repair\.disable/)).toBeNull();
    fireEvent.click(screen.getByText('looks.repair.enable:{"name":"Fancy"}'));
    expect(manager.toggle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "fancy-layout", enabled: false }),
    );
    await waitFor(() => expect(onRetry).toHaveBeenCalled());
  });

  it("offers to start a failed plugin again", () => {
    fancy.enabled = false;
    render(<RepairView status={status} onRetry={onRetry} />);
    expect(
      screen.getByText('looks.repair.startAgain:{"name":"Fancy"}'),
    ).toBeTruthy();
  });

  it("lets an admin restore the bundled copy and then tries again", async () => {
    render(<RepairView status={status} onRetry={onRetry} />);
    fireEvent.click(screen.getByText('looks.repair.restore:{"name":"Fancy"}'));
    expect(plugins.restoreBundledPlugin).toHaveBeenCalledWith("fancy-layout");
    await waitFor(() => expect(onRetry).toHaveBeenCalled());
  });

  it("names the missing layout when none is set", () => {
    render(
      <RepairView
        status={{
          kind: "repair",
          reason: "missing",
          layoutId: "",
        }}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText("looks.repair.noLayout")).toBeTruthy();
  });

  it("lets an admin install a layout or theme from the registries", () => {
    render(<RepairView status={status} onRetry={onRetry} />);
    fireEvent.click(screen.getByText("looks.repair.install"));
    expect(screen.getByText("Paper themes")).toBeTruthy();
    expect(screen.queryByText("Docker")).toBeNull();
    fireEvent.click(screen.getByText("looks.repair.installButton"));
    expect(manager.requestInstall).toHaveBeenCalledWith(
      expect.objectContaining({ id: "paper-themes" }),
    );
  });

  it("gives everyone else switch and reset, and a note to ask an admin", () => {
    permissions.isAdmin = false;
    render(<RepairView status={status} onRetry={onRetry} />);
    expect(screen.getByText("looks.repair.askAdmin")).toBeTruthy();
    expect(screen.getByText("looks.repair.reset")).toBeTruthy();
    expect(screen.getByText("looks.repair.switchLayout")).toBeTruthy();
    expect(screen.queryByText("looks.repair.resetEveryone")).toBeNull();
    expect(screen.queryByText("looks.repair.install")).toBeNull();
    expect(screen.queryByText(/looks\.repair\.update/)).toBeNull();
    expect(screen.queryByText(/looks\.repair\.disable/)).toBeNull();
  });

  it("offers no retry in safe mode", () => {
    render(
      <RepairView
        status={{ ...status, reason: "safe-url" }}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText("looks.repair.safeTitle")).toBeTruthy();
    expect(screen.queryByText("looks.repair.retry")).toBeNull();
  });
});
