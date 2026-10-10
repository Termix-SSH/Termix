import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { ConnectionScreen } from "../../../components/connection/ConnectionScreen";
import {
  ConnectionLogProvider,
  useConnectionLog,
} from "../../../ssh/connection-log/ConnectionLogContext";
import { SurfaceScope } from "../../../components/surface/surface-scope";
import { useEffect } from "react";

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

  it("uses the same headline when retries run out", () => {
    render(<ConnectionScreen status="disconnected" message="common.loading" />);
    expect(screen.getByText("connection.failed")).toBeTruthy();
  });

  it("closes the tab it sits in once it stops", () => {
    const close = vi.fn();
    render(
      <SurfaceScope kind="tab" onClose={close}>
        <ConnectionScreen status="error" onManualRetry={() => {}} />
      </SurfaceScope>,
    );
    fireEvent.click(screen.getByText("connection.close"));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("prefers its own close and can hide it", () => {
    const own = vi.fn();
    const { rerender } = render(
      <SurfaceScope kind="tab" onClose={() => {}}>
        <ConnectionScreen status="error" onClose={own} />
      </SurfaceScope>,
    );
    fireEvent.click(screen.getByText("connection.close"));
    expect(own).toHaveBeenCalledTimes(1);

    rerender(
      <SurfaceScope kind="tab" onClose={() => {}}>
        <ConnectionScreen status="error" onClose={false} />
      </SurfaceScope>,
    );
    expect(screen.queryByText("connection.close")).toBeNull();
  });

  it("shows no close while connecting or outside a tab", () => {
    render(
      <SurfaceScope kind="tab" onClose={() => {}}>
        <ConnectionScreen status="connecting" />
      </SurfaceScope>,
    );
    expect(screen.queryByText("connection.close")).toBeNull();
    cleanup();
    render(<ConnectionScreen status="error" />);
    expect(screen.queryByText("connection.close")).toBeNull();
  });

  it("falls back to the last logged error for the reason", () => {
    function Seed() {
      const { addLog } = useConnectionLog();
      useEffect(() => {
        addLog({ type: "error", stage: "connection", message: "old" });
        addLog({ type: "info", stage: "connection", message: "trying" });
        addLog({
          type: "error",
          stage: "connection",
          message: "Docker not found",
        });
      }, [addLog]);
      return null;
    }
    render(
      <ConnectionLogProvider>
        <Seed />
        <ConnectionScreen status="error" />
      </ConnectionLogProvider>,
    );
    expect(screen.getAllByText("Docker not found").length).toBeGreaterThan(1);
  });

  it("renders nothing once connected", () => {
    const { container } = render(<ConnectionScreen status="connected" />);
    expect(container.innerHTML).toBe("");
  });
});
