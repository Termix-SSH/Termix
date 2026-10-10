import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import {
  ConnectionGate,
  type ConnectionGateController,
} from "@/components/connection/ConnectionGate";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ConnectionGate", () => {
  it("shows the children once connected", async () => {
    render(
      <ConnectionGate
        message="docker.connecting"
        connect={(gate) => gate.markConnected()}
      >
        <span>containers</span>
      </ConnectionGate>,
    );
    await act(async () => {});
    expect(screen.getByText("containers")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps the screen up with the reason and a retry when connect throws", async () => {
    const connect = vi
      .fn<(gate: ConnectionGateController) => Promise<void> | void>()
      .mockRejectedValueOnce(new Error("No route to host"))
      .mockImplementation((gate) => gate.markConnected());
    render(
      <ConnectionGate message="files.connecting" connect={connect}>
        <span>tree</span>
      </ConnectionGate>,
    );
    await act(async () => {});
    expect(screen.queryByText("tree")).toBeNull();
    expect(screen.getAllByText("No route to host").length).toBeGreaterThan(0);
    expect(screen.getByText("connection.failedRetrying")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText("connection.retryNow"));
    });
    expect(screen.getByText("tree")).toBeTruthy();
  });

  it("does not retry on its own when unavailable", async () => {
    const connect = vi.fn((gate: ConnectionGateController) =>
      gate.markUnavailable({ title: "docker.notEnabled" }),
    );
    render(
      <ConnectionGate message="docker.connecting" connect={connect}>
        <span>containers</span>
      </ConnectionGate>,
    );
    await act(async () => {});
    expect(screen.getByText("docker.notEnabled")).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("containers")).toBeNull();
  });

  it("keeps children mounted under the screen when asked", async () => {
    render(
      <ConnectionGate
        message="serial.connecting"
        keepMounted
        connect={() => new Promise(() => {})}
      >
        <span>xterm</span>
      </ConnectionGate>,
    );
    await act(async () => {});
    expect(screen.getByText("xterm")).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
