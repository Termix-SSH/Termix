import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { ConnectionScreen } from "../../../components/connection/ConnectionScreen";
import { ConnectionLogProvider } from "../../../ssh/connection-log/ConnectionLogContext";

afterEach(cleanup);

describe("ConnectionScreen", () => {
  // Loading and host-not-found screens render before the provider is mounted,
  // which used to throw and take down the whole RDP/VNC/Telnet tab.
  it("renders without a ConnectionLogProvider", () => {
    expect(() =>
      render(<ConnectionScreen status="connecting" message="common.loading" />),
    ).not.toThrow();

    expect(screen.getByText("common.loading")).toBeTruthy();
    const status = screen.getByRole("status");
    expect(status.getAttribute("data-status")).toBe("connecting");
    expect(status.querySelector(".animate-spin")).toBeTruthy();
  });

  it("renders the disconnected state without a provider", () => {
    render(
      <ConnectionScreen
        status="disconnected"
        message="common.loading"
        disconnectedMessage="terminal.connectionLost"
      />,
    );

    expect(screen.getByText("terminal.connectionLost")).toBeTruthy();
    expect(screen.queryByText("common.loading")).toBeNull();
    expect(screen.getByRole("status").getAttribute("data-status")).toBe(
      "disconnected",
    );
  });

  it("still shows the connection log when a provider is present", () => {
    render(
      <ConnectionLogProvider>
        <ConnectionScreen status="connecting" message="common.loading" />
      </ConnectionLogProvider>,
    );

    expect(screen.getByText(/sshAuth\.connectionLogTitle/)).toBeTruthy();
  });

  it("offers retry and the reason once a connect fails", () => {
    const retry = vi.fn();
    render(
      <ConnectionScreen
        status="error"
        message="common.loading"
        errorDetail="Authentication failed"
        onManualRetry={retry}
      />,
    );

    expect(screen.getByText("connection.failed")).toBeTruthy();
    expect(screen.getByText("Authentication failed")).toBeTruthy();
    fireEvent.click(screen.getByText("connection.reconnect"));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("lets the user skip the wait while it retries on its own", () => {
    const retry = vi.fn();
    render(
      <ConnectionScreen
        status="error"
        attempt={2}
        maxAttempts={8}
        nextRetryInMs={4000}
        onManualRetry={retry}
      />,
    );

    expect(screen.getByText("connection.failedRetrying")).toBeTruthy();
    expect(screen.getByText("connection.retryingIn")).toBeTruthy();
    fireEvent.click(screen.getByText("connection.retryNow"));
    expect(retry).toHaveBeenCalled();
  });

  it("shows an unavailable state with its hint, action and retry", () => {
    render(
      <ConnectionScreen
        status="connected"
        unavailable={{
          title: "docker.notEnabled",
          hint: "docker.notEnabledHint",
          action: <button>open editor</button>,
        }}
        onManualRetry={() => {}}
      />,
    );

    expect(screen.getByRole("status").getAttribute("data-status")).toBe(
      "unavailable",
    );
    expect(screen.getByText("docker.notEnabled")).toBeTruthy();
    expect(screen.getByText("docker.notEnabledHint")).toBeTruthy();
    expect(screen.getByText("open editor")).toBeTruthy();
    expect(screen.getByText("connection.reconnect")).toBeTruthy();
  });

  it("renders nothing once connected", () => {
    const { container } = render(<ConnectionScreen status="connected" />);
    expect(container.innerHTML).toBe("");
  });
});
