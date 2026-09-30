import type { ComponentProps } from "react";
import type { PanePreview } from "../../src/frontend/PanePreview";
import type { SessionTree } from "../../src/frontend/SessionTree";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TmuxMonitor } from "../../src/frontend/TmuxMonitor";
import * as api from "../../src/frontend/api";

const state = vi.hoisted(() => ({
  hosts: [1, 2].map((id) => ({
    id,
    name: `Host ${id}`,
    ip: `host${id}`,
    enableSsh: true,
    pluginSettings: { "tmux-monitor": { enableTmuxMonitor: true } },
  })),
  toast: { success: vi.fn(), error: vi.fn() },
  t: (key: string) => key,
}));
vi.mock("@termix/plugin-sdk/frontend", async (original) => ({
  ...(await original<object>()),
  useHosts: () => ({ hosts: state.hosts, loaded: true }),
  useToast: () => state.toast,
  useTranslation: () => ({ t: state.t }),
}));
vi.mock("../../src/frontend/api", () => ({
  getTmuxOverview: vi.fn(),
  getTmuxMetrics: vi.fn(),
  focusTmuxPane: vi.fn(),
  searchTmux: vi.fn(),
  setTmuxSessionTags: vi.fn(),
  createTmuxSession: vi.fn(),
  createTmuxWindow: vi.fn(),
  renameTmuxSession: vi.fn(),
  killTmuxSession: vi.fn(),
  killTmuxWindow: vi.fn(),
  killTmuxPane: vi.fn(),
  splitTmuxPane: vi.fn(),
}));
vi.mock("../../src/frontend/use-adaptive-polling", async () => {
  const { useEffect, useRef } = await import("react");
  return {
    useAdaptivePolling: (
      poll: () => Promise<unknown>,
      _policy: unknown,
      enabled: boolean,
      options?: { runImmediately?: boolean },
    ) => {
      const ref = useRef(poll);
      ref.current = poll;
      useEffect(() => {
        if (enabled && options?.runImmediately !== false)
          void Promise.resolve(ref.current()).catch(() => {});
      }, [enabled, options?.runImmediately]);
    },
  };
});
vi.mock("../../src/frontend/PanePreview", () => ({
  PanePreview: ({
    host,
    pane,
    metrics,
  }: ComponentProps<typeof PanePreview>) => (
    <div data-testid="preview">
      {host.id}:{pane.paneId}:{metrics?.cpuPercent ?? "none"}
    </div>
  ),
}));
vi.mock("../../src/frontend/SessionTree", () => ({
  SessionTree: (props: ComponentProps<typeof SessionTree>) => (
    <div>
      <span>cpu:{props.metricsByPane.get("%0")?.cpuPercent ?? "none"}</span>
      <span>
        {props.expandedSessions.has("same") ? "expanded" : "collapsed"}
      </span>
      <button
        onClick={() =>
          props.onSelectPane({
            paneId: "%0",
            sessionName: "same",
            windowIndex: 0,
          })
        }
      >
        pane
      </button>
      <button onClick={() => props.onSelectSession?.("same")}>session</button>
      <button onClick={() => props.onNewWindow("same")}>new window</button>
      <button onClick={() => props.onKillSession("same")}>kill session</button>
      <button onClick={() => props.onToggleSession("same")}>
        toggle session
      </button>
    </div>
  ),
}));

function overview(): api.TmuxOverview {
  return {
    available: true,
    sessions: [
      {
        name: "same",
        created: 1,
        lastActivity: 1,
        attachedClients: 0,
        tags: [],
        windows: [
          {
            index: 0,
            name: "window",
            active: true,
            panes: [
              {
                id: "%0",
                index: 0,
                pid: 1,
                active: true,
                width: 80,
                height: 24,
                command: "bash",
                path: "/",
                title: "",
              },
            ],
          },
        ],
      },
    ],
  };
}
function metrics(id: number): api.TmuxPaneMetrics[] {
  return [
    {
      paneId: "%0",
      sessionName: "same",
      pid: 1,
      processCount: 1,
      cpuPercent: id * 10,
      memRssKb: id,
      gpuMemMb: 0,
      topCommand: "bash",
    },
  ];
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const host = (id: number) =>
  within(screen.getByRole("region", { name: `Host ${id}` }));
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(api.getTmuxOverview).mockImplementation(async () => overview());
  vi.mocked(api.getTmuxMetrics).mockImplementation(async (id) => metrics(id));
  vi.mocked(api.focusTmuxPane).mockResolvedValue();
  vi.mocked(api.createTmuxWindow).mockResolvedValue();
});
afterEach(cleanup);

describe("multi-host tmux monitor", () => {
  it("isolates duplicate session/pane IDs and routes preview and management to their host", async () => {
    render(<TmuxMonitor initialHostId={1} />);
    await waitFor(() =>
      expect(host(1).getByText("cpu:10")).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(host(2).getByText("cpu:20")).toBeInTheDocument(),
    );
    fireEvent.click(host(2).getByText("pane"));
    await waitFor(() =>
      expect(screen.getByTestId("preview")).toHaveTextContent("2:%0:20"),
    );
    expect(api.focusTmuxPane).toHaveBeenLastCalledWith(2, "%0");
    await waitFor(() =>
      expect(host(1).getByText("new window")).toBeInTheDocument(),
    );
    fireEvent.click(host(1).getByText("new window"));
    await waitFor(() =>
      expect(api.createTmuxWindow).toHaveBeenCalledExactlyOnceWith(1, "same"),
    );
  });

  it("restores the last host, pane, filter and expanded sessions", async () => {
    const first = render(<TmuxMonitor initialHostId={1} />);
    await waitFor(() => expect(host(2).getByText("pane")).toBeInTheDocument());
    fireEvent.click(host(2).getByText("pane"));
    await waitFor(() =>
      expect(screen.getByTestId("preview")).toHaveTextContent("2:%0"),
    );
    fireEvent.click(host(2).getByText("toggle session"));
    fireEvent.change(screen.getByLabelText("tmuxMonitor.filterHosts"), {
      target: { value: "Host 2" },
    });
    first.unmount();
    render(<TmuxMonitor />);
    await waitFor(() =>
      expect(screen.getByTestId("preview")).toHaveTextContent("2:%0"),
    );
    expect(screen.getByLabelText("tmuxMonitor.filterHosts")).toHaveValue(
      "Host 2",
    );
    expect(host(2).getByText("collapsed")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Host 1" }),
    ).not.toBeInTheDocument();
  });

  it("ignores late metrics from a previously selected host", async () => {
    const old = deferred<api.TmuxPaneMetrics[]>();
    vi.mocked(api.getTmuxMetrics).mockImplementation((id) =>
      id === 1 ? old.promise : Promise.resolve(metrics(id)),
    );
    render(<TmuxMonitor initialHostId={1} />);
    await waitFor(() => expect(host(2).getByText("pane")).toBeInTheDocument());
    fireEvent.click(host(2).getByText("pane"));
    await waitFor(() =>
      expect(screen.getByTestId("preview")).toHaveTextContent("2:%0:20"),
    );
    await act(async () => old.resolve(metrics(9)));
    expect(screen.getByTestId("preview")).toHaveTextContent("2:%0:20");
  });

  it("does not execute an abandoned cross-host action after its overview arrives", async () => {
    const delayed = deferred<api.TmuxOverview>();
    render(<TmuxMonitor initialHostId={1} />);
    await waitFor(() => expect(host(2).getByText("pane")).toBeInTheDocument());
    vi.mocked(api.getTmuxOverview).mockImplementation((id) =>
      id === 2 ? delayed.promise : Promise.resolve(overview()),
    );
    fireEvent.click(host(2).getByText("new window"));
    fireEvent.click(host(1).getByRole("button", { name: "Host 1" }));
    await act(async () => delayed.resolve(overview()));
    expect(api.createTmuxWindow).not.toHaveBeenCalled();
  });

  it("isolates an unavailable host and stops loading collapsed, filtered and hidden hosts", async () => {
    localStorage.setItem("termix-tmux-monitor-collapsed-hosts", '["2"]');
    const app = render(<TmuxMonitor initialHostId={1} />);
    await waitFor(() => expect(host(1).getByText("pane")).toBeInTheDocument());
    expect(api.getTmuxOverview).not.toHaveBeenCalledWith(2);
    vi.mocked(api.getTmuxOverview).mockImplementation(async (id) => {
      if (id === 2) throw new Error("offline");
      return overview();
    });
    fireEvent.click(host(2).getByLabelText("tmuxMonitor.toggleHost"));
    await waitFor(() =>
      expect(host(2).getByRole("status")).toHaveTextContent(
        "tmuxMonitor.failedToLoad",
      ),
    );
    expect(host(1).getByText("pane")).toBeInTheDocument();
    app.rerender(<TmuxMonitor initialHostId={1} isVisible={false} />);
    expect(host(2).queryByRole("status")).not.toBeInTheDocument();
  });

  it("confirms a destructive action on the host selected from the background tree", async () => {
    render(<TmuxMonitor initialHostId={1} />);
    await waitFor(() =>
      expect(host(2).getByText("kill session")).toBeInTheDocument(),
    );
    fireEvent.click(host(2).getByText("kill session"));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "tmuxMonitor.kill",
      }),
    );
    await waitFor(() =>
      expect(api.killTmuxSession).toHaveBeenCalledExactlyOnceWith(2, "same"),
    );
  });

  it("does not restore a pane removed from the server", async () => {
    localStorage.setItem(
      "termix-tmux-monitor-pane-1",
      JSON.stringify({ paneId: "%99", sessionName: "same", windowIndex: 0 }),
    );
    render(<TmuxMonitor initialHostId={1} />);
    await waitFor(() => expect(host(1).getByText("pane")).toBeInTheDocument());
    expect(screen.queryByTestId("preview")).not.toBeInTheDocument();
    expect(api.focusTmuxPane).not.toHaveBeenCalled();
  });

  it("ignores an old overview after switching away and back to the same host", async () => {
    const old = deferred<api.TmuxOverview>();
    let first = true;
    vi.mocked(api.getTmuxOverview).mockImplementation((id) => {
      if (id === 1 && first) {
        first = false;
        return old.promise;
      }
      return Promise.resolve(overview());
    });
    render(<TmuxMonitor initialHostId={1} />);
    await waitFor(() => expect(host(2).getByText("pane")).toBeInTheDocument());
    fireEvent.click(host(2).getByText("pane"));
    await waitFor(() =>
      expect(screen.getByTestId("preview")).toHaveTextContent("2:%0"),
    );
    fireEvent.click(host(1).getByRole("button", { name: "Host 1" }));
    await waitFor(() => expect(host(1).getByText("pane")).toBeInTheDocument());
    await act(async () => old.resolve({ available: false, sessions: [] }));
    expect(host(1).getByText("pane")).toBeInTheDocument();
  });

  it("honors a repeated host action after switching manually", async () => {
    const app = render(
      <TmuxMonitor initialHostId={1} initialHostRequest={1} />,
    );
    await waitFor(() => expect(host(2).getByText("pane")).toBeInTheDocument());
    fireEvent.click(host(2).getByText("pane"));
    await waitFor(() =>
      expect(screen.getByTestId("preview")).toHaveTextContent("2:%0"),
    );
    app.rerender(<TmuxMonitor initialHostId={1} initialHostRequest={2} />);
    await waitFor(() =>
      expect(host(1).getByRole("button", { name: "Host 1" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
  });

  it("retains single-host mode without loading other hosts", async () => {
    localStorage.setItem("termix-tmux-monitor-scope", '"single"');
    render(<TmuxMonitor initialHostId={1} />);
    await waitFor(() => expect(host(1).getByText("pane")).toBeInTheDocument());
    expect(api.getTmuxOverview).not.toHaveBeenCalledWith(2);
    fireEvent.change(screen.getByLabelText("tmuxMonitor.selectHost"), {
      target: { value: "2" },
    });
    await waitFor(() => expect(host(2).getByText("pane")).toBeInTheDocument());
    fireEvent.click(host(2).getByText("session"));
    await waitFor(() =>
      expect(screen.getByTestId("preview")).toHaveTextContent("2:%0"),
    );
  });
});
