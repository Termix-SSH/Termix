import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { FolderSearch, Monitor, Server, Terminal } from "lucide-react";

vi.mock("@/api/credentials-api", () => ({
  getCredentials: vi.fn(async () => []),
}));
vi.mock("@/api/auth-methods-api", () => ({
  getSshAuthProviders: vi.fn(async () => []),
}));
const authMocks = vi.hoisted(() => ({
  providers: [] as Record<string, unknown>[],
  editors: [] as Record<string, unknown>[],
}));
vi.mock("@/hooks/useSshAuthProviders", () => ({
  useSshAuthProviders: () => ({ providers: authMocks.providers }),
}));
vi.mock("@/plugin-host/auth-registry", () => ({
  useSshAuthEditors: () => authMocks.editors,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

import { QuickConnectPanel } from "../../sidebar/QuickConnectPanel";
import {
  registerHostAction,
  resetHostContributions,
} from "../../sidebar/host-contributions";

afterEach(() => {
  cleanup();
  authMocks.providers = [];
  authMocks.editors = [];
  resetHostContributions();
});

function registerDefaults() {
  registerHostAction({
    id: "terminal",
    titleKey: "nav.terminal",
    icon: Terminal,
    kind: "connect",
    priority: 100,
    tabType: "terminal",
    when: (host) => !!host.enableSsh,
  });
  registerHostAction({
    id: "files",
    titleKey: "nav.files",
    icon: FolderSearch,
    kind: "open",
    tabType: "files",
    quickConnect: true,
    when: (host) => !!host.enableSsh,
  });
  registerHostAction({
    id: "docker",
    titleKey: "nav.docker",
    icon: Server,
    kind: "open",
    tabType: "docker",
    when: (host) => !!host.enableSsh,
  });
  registerHostAction({
    id: "rdp",
    titleKey: "hosts.tabRdp",
    icon: Monitor,
    kind: "connect",
    priority: 50,
    tabType: "rdp",
    when: () => false,
  });
}

const buttonName = (key: string) =>
  `newUi.sidebar.quickConnect.connectToAction:${JSON.stringify({ name: key })}`;

describe("QuickConnectPanel", () => {
  it("offers every usable connect target and opt-in tool", () => {
    registerDefaults();
    render(<QuickConnectPanel onConnect={vi.fn()} />);
    expect(screen.getByText(buttonName("nav.terminal"))).toBeTruthy();
    expect(screen.getByText(buttonName("nav.files"))).toBeTruthy();
    expect(screen.queryByText(buttonName("nav.docker"))).toBeNull();
    expect(screen.queryByText(buttonName("hosts.tabRdp"))).toBeNull();
  });

  it("opens the chosen tab for the typed address", async () => {
    registerDefaults();
    const onConnect = vi.fn();
    render(<QuickConnectPanel onConnect={onConnect} />);
    fireEvent.change(
      screen.getByPlaceholderText("newUi.sidebar.quickConnect.hostPlaceholder"),
      { target: { value: "10.0.0.1" } },
    );
    fireEvent.click(screen.getByText(buttonName("nav.files")));
    await waitFor(() => expect(onConnect).toHaveBeenCalledTimes(1));
    const [host, type] = onConnect.mock.calls[0];
    expect(type).toBe("files");
    expect(host).toMatchObject({ ip: "10.0.0.1", username: "root", port: 22 });
  });

  it("connects with the top target on Enter", () => {
    registerDefaults();
    const onConnect = vi.fn();
    render(<QuickConnectPanel onConnect={onConnect} />);
    const input = screen.getByPlaceholderText(
      "newUi.sidebar.quickConnect.hostPlaceholder",
    );
    fireEvent.change(input, { target: { value: "example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onConnect).toHaveBeenCalledWith(
      expect.objectContaining({ ip: "example.com" }),
      "terminal",
    );
  });

  it("does nothing without an address", () => {
    registerDefaults();
    const onConnect = vi.fn();
    render(<QuickConnectPanel onConnect={onConnect} />);
    fireEvent.click(screen.getByText(buttonName("nav.terminal")));
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("says so when nothing can connect", () => {
    render(<QuickConnectPanel onConnect={vi.fn()} />);
    expect(
      screen.getByText("newUi.sidebar.quickConnect.noTarget"),
    ).toBeTruthy();
  });

  it("lets a plugin auth editor fill the host address", async () => {
    registerDefaults();
    authMocks.providers = [
      {
        type: "password",
        labelKey: "password",
        available: true,
        quickConnect: true,
      },
      {
        type: "tailnet",
        labelKey: "tailnet",
        available: true,
        quickConnect: true,
      },
    ];
    authMocks.editors = [
      {
        id: "tailnet",
        component: ({
          setField,
        }: {
          setField: (k: string, v: unknown) => void;
        }) => (
          <button type="button" onClick={() => setField("ip", "100.64.0.5")}>
            pick device
          </button>
        ),
      },
    ];
    const onConnect = vi.fn();
    render(<QuickConnectPanel onConnect={onConnect} />);
    fireEvent.change(screen.getByDisplayValue("password"), {
      target: { value: "tailnet" },
    });
    fireEvent.click(screen.getByText("pick device"));
    const input = screen.getByPlaceholderText(
      "newUi.sidebar.quickConnect.hostPlaceholder",
    ) as HTMLInputElement;
    expect(input.value).toBe("100.64.0.5");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onConnect).toHaveBeenCalledWith(
      expect.objectContaining({ ip: "100.64.0.5", authType: "tailnet" }),
      "terminal",
    );
  });
});
