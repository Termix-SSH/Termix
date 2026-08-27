import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toast, invoke } = vi.hoisted(() => ({
  toast: { error: vi.fn(), success: vi.fn() },
  invoke: vi.fn(),
}));

vi.mock("sonner", () => ({ toast }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/auth/ElectronLoginForm.tsx", () => ({
  ElectronLoginForm: ({ serverUrl }: { serverUrl: string }) => (
    <div data-testid="remote-login">{serverUrl}</div>
  ),
}));

import { RemoteSyncPanel } from "../../settings/RemoteSyncPanel";

const config = {
  serverUrl: "http://192.168.3.175:6060",
  connectedAt: "2026-08-27T00:00:00.000Z",
};
const status = {
  connected: true,
  syncing: false,
  lastSyncedAt: null,
  lastError: "Remote session expired",
  needsReauth: true,
};

beforeEach(() => {
  invoke.mockImplementation((channel: string) => {
    if (channel === "get-remote-sync-config") return Promise.resolve(config);
    if (channel === "get-remote-sync-status") return Promise.resolve(status);
    if (channel === "get-desktop-settings") {
      return Promise.resolve({ defaultConnectionOrigin: "local" });
    }
    if (channel === "remote-sync-now") return Promise.resolve(status);
    return Promise.resolve(null);
  });
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: { invoke, onRemoteSyncStatusChanged: vi.fn() },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RemoteSyncPanel", () => {
  it("opens the configured server login when the banner requests reconnect", async () => {
    const onHandled = vi.fn();
    render(
      <RemoteSyncPanel
        reconnectRequested
        onReconnectRequestHandled={onHandled}
      />,
    );

    expect((await screen.findByTestId("remote-login")).textContent).toBe(
      config.serverUrl,
    );
    expect(onHandled).toHaveBeenCalledOnce();
  });

  it("shows the sync failure returned by the main process", async () => {
    render(<RemoteSyncPanel />);
    const syncButton = await screen.findByRole("button", {
      name: /remoteSync.syncNowButton/,
    });
    fireEvent.click(syncButton);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Remote session expired");
    });
  });
});
