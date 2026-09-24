import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("@termix/plugin-sdk/frontend", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePluginApi: () => api,
  useTranslation: () => ({ t: (key: string) => key, language: "en" }),
}));

vi.mock("@termix/plugin-sdk/ui", () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
  getPollingEnvironmentMultiplier: () => 1,
  runAdaptivePolling: (poll: () => Promise<unknown>) => {
    void poll();
    return () => {};
  },
}));

import { TerminalMetricsStatus } from "../../src/frontend/TerminalMetricsStatus";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TerminalMetricsStatus", () => {
  it("polls the host's metrics while active and shows the bars", async () => {
    api.post.mockResolvedValue({ data: { viewerSessionId: "viewer-1" } });
    api.get.mockResolvedValue({
      data: {
        cpu: { percent: 12 },
        memory: { percent: 40 },
        disk: { percent: 91 },
      },
    });

    render(<TerminalMetricsStatus host={{ id: 7 }} isConnected active />);

    await waitFor(() => expect(screen.getByText("91%")).toBeInTheDocument());
    expect(api.post).toHaveBeenCalledWith("/metrics/start/7");
    expect(screen.getByText("12%")).toBeInTheDocument();
    expect(screen.getByText("hostMetrics.cpu")).toBeInTheDocument();
  });

  it("does not poll while inactive", () => {
    render(
      <TerminalMetricsStatus host={{ id: 7 }} isConnected active={false} />,
    );
    expect(api.post).not.toHaveBeenCalled();
  });

  it("says stats are unavailable when the host needs a second factor", async () => {
    api.post.mockResolvedValue({ data: { requires_totp: true } });
    render(<TerminalMetricsStatus host={{ id: 7 }} isConnected active />);
    await waitFor(() =>
      expect(
        screen.getByText("terminalStatus.unavailable"),
      ).toBeInTheDocument(),
    );
  });

  it("stops its viewer on unmount", async () => {
    api.post.mockResolvedValue({ data: { viewerSessionId: "viewer-2" } });
    api.get.mockResolvedValue({ data: null });
    const view = render(
      <TerminalMetricsStatus host={{ id: 7 }} isConnected active />,
    );
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    view.unmount();
    expect(api.post).toHaveBeenLastCalledWith("/metrics/stop/7", {
      viewerSessionId: "viewer-2",
    });
  });
});
