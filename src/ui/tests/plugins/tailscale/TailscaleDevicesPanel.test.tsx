import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getTailscaleDevicesMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../../plugins/tailscale/frontend/tailscale-api", () => ({
  getTailscaleDevices: getTailscaleDevicesMock,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { TailscaleDevicesPanel } from "../../../../../plugins/tailscale/frontend/TailscaleDevicesPanel";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TailscaleDevicesPanel", () => {
  it("shows the no-api-key message when hasApiKey is false", async () => {
    getTailscaleDevicesMock.mockResolvedValue({
      devices: [],
      hasApiKey: false,
    });

    render(<TailscaleDevicesPanel onConnect={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText("hosts.tailscaleNoApiKey")).toBeTruthy(),
    );
  });

  it("shows the empty-devices message when the tailnet has no devices", async () => {
    getTailscaleDevicesMock.mockResolvedValue({ devices: [], hasApiKey: true });

    render(<TailscaleDevicesPanel onConnect={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText("hosts.tailscaleNoDevices")).toBeTruthy(),
    );
  });

  it("renders devices and connects with an ephemeral tailscale host", async () => {
    const user = userEvent.setup();
    getTailscaleDevicesMock.mockResolvedValue({
      hasApiKey: true,
      devices: [
        {
          id: "d1",
          name: "box",
          hostname: "box",
          addresses: ["100.64.0.1"],
          os: "linux",
          lastSeen: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const onConnect = vi.fn();
    render(<TailscaleDevicesPanel onConnect={onConnect} />);

    await waitFor(() => expect(screen.getByText("box")).toBeTruthy());
    await user.click(
      screen.getByText("newUi.sidebar.quickConnect.connectToTerminal"),
    );

    expect(onConnect).toHaveBeenCalledOnce();
    const [host, type] = onConnect.mock.calls[0];
    expect(type).toBe("terminal");
    expect(host.ip).toBe("100.64.0.1");
    expect(host.authType).toBe("tailscale");
    expect(host.username).toBe("root");
  });
});
