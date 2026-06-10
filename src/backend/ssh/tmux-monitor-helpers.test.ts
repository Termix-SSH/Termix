import { describe, it, expect } from "vitest";
import {
  SEP,
  parseSessions,
  parseWindows,
  parsePanes,
  parsePsOutput,
  parseGpuOutput,
  buildPaneMetrics,
  attachPanesToWindows,
  shellEscape,
} from "./tmux-monitor-helpers.js";

function join(...fields: (string | number)[]): string {
  return fields.join(SEP);
}

describe("parseSessions", () => {
  it("parses tmux list-sessions output", () => {
    const output = [
      join("training", 1760000000, 1760001000, 1),
      join("lab|with|pipes", 1760000500, 1760002000, 0),
    ].join("\n");

    const sessions = parseSessions(output);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toEqual({
      name: "training",
      created: 1760000000,
      lastActivity: 1760001000,
      attachedClients: 1,
    });
    // Session names containing "|" survive because SEP is a multi-char token
    expect(sessions[1].name).toBe("lab|with|pipes");
    expect(sessions[1].attachedClients).toBe(0);
  });

  it("returns empty array for empty output", () => {
    expect(parseSessions("")).toEqual([]);
  });
});

describe("parseWindows", () => {
  it("groups windows by session", () => {
    const output = [
      join("training", 0, 1, "vim"),
      join("training", 1, 0, "logs"),
      join("api", 0, 1, "server"),
    ].join("\n");

    const windows = parseWindows(output);
    expect(windows.get("training")).toHaveLength(2);
    expect(windows.get("training")![0]).toMatchObject({
      index: 0,
      name: "vim",
      active: true,
    });
    expect(windows.get("api")![0].name).toBe("server");
  });
});

describe("parsePanes", () => {
  it("parses full pane lines including free-text fields", () => {
    const output = join(
      "training",
      0,
      "%3",
      1,
      12345,
      1,
      120,
      40,
      "python",
      "/home/user/my|dir",
      "gpu01: train.py",
    );

    const panes = parsePanes(output);
    expect(panes).toHaveLength(1);
    expect(panes[0]).toEqual({
      sessionName: "training",
      windowIndex: 0,
      id: "%3",
      index: 1,
      pid: 12345,
      active: true,
      width: 120,
      height: 40,
      command: "python",
      path: "/home/user/my|dir",
      title: "gpu01: train.py",
    });
  });
});

describe("parsePsOutput", () => {
  it("parses ps -eo pid,ppid,pcpu,pmem,rss,comm output", () => {
    const output = [
      "    1     0  0.0  0.1  1234 systemd",
      "12345     1  2.5  1.0 50000 bash",
      "12400 12345 95.3 12.5 800000 python3",
      "garbage line",
    ].join("\n");

    const procs = parsePsOutput(output);
    expect(procs).toHaveLength(3);
    expect(procs[2]).toEqual({
      pid: 12400,
      ppid: 12345,
      cpu: 95.3,
      mem: 12.5,
      rss: 800000,
      comm: "python3",
    });
  });
});

describe("parseGpuOutput", () => {
  it("parses nvidia-smi csv output and sums per pid", () => {
    const output = ["12400, 8000", "12400, 2000", "99999, 512"].join("\n");
    const gpu = parseGpuOutput(output);
    expect(gpu.get(12400)).toBe(10000);
    expect(gpu.get(99999)).toBe(512);
  });

  it("handles empty output (no GPU)", () => {
    expect(parseGpuOutput("").size).toBe(0);
  });
});

describe("buildPaneMetrics", () => {
  const panes = parsePanes(
    [
      join("training", 0, "%1", 0, 100, 1, 80, 24, "bash", "/", "t"),
      join("idle", 0, "%2", 0, 200, 1, 80, 24, "bash", "/", "t"),
    ].join("\n"),
  );

  const processes = parsePsOutput(
    [
      // pane %1: bash(100) -> python3(110) -> worker(111)
      "  100     1  0.1  0.1  4000 bash",
      "  110   100 90.0 10.0 700000 python3",
      "  111   110  9.5  2.0 100000 dataloader",
      // pane %2: bash(200) only
      "  200     1  0.0  0.1  4000 bash",
      // unrelated process
      "  300     1 50.0  5.0 200000 chrome",
    ].join("\n"),
  );

  it("aggregates descendant trees per pane", () => {
    const metrics = buildPaneMetrics(panes, processes, new Map());
    const m1 = metrics.find((m) => m.paneId === "%1")!;
    expect(m1.processCount).toBe(3);
    expect(m1.cpuPercent).toBeCloseTo(99.6, 1);
    expect(m1.memRssKb).toBe(804000);
    expect(m1.topCommand).toBe("python3");

    const m2 = metrics.find((m) => m.paneId === "%2")!;
    expect(m2.processCount).toBe(1);
    expect(m2.cpuPercent).toBe(0);
    // Unrelated process is never attributed
    expect(m2.memRssKb).toBe(4000);
  });

  it("attributes GPU memory through the process tree", () => {
    const gpu = new Map([
      [110, 8000],
      [300, 4000],
    ]);
    const metrics = buildPaneMetrics(panes, processes, gpu);
    expect(metrics.find((m) => m.paneId === "%1")!.gpuMemMb).toBe(8000);
    expect(metrics.find((m) => m.paneId === "%2")!.gpuMemMb).toBe(0);
  });

  it("handles a pane whose pid is missing from ps output", () => {
    const orphan = parsePanes(
      join("gone", 0, "%9", 0, 99999, 0, 80, 24, "bash", "/", "t"),
    );
    const metrics = buildPaneMetrics(orphan, processes, new Map());
    expect(metrics[0].processCount).toBe(0);
    expect(metrics[0].cpuPercent).toBe(0);
    expect(metrics[0].topCommand).toBeNull();
  });

  it("does not loop on cyclic ppid data", () => {
    const cyclic = parsePsOutput(
      ["  100   101 1.0 0.1 1000 a", "  101   100 1.0 0.1 1000 b"].join("\n"),
    );
    const pane = parsePanes(
      join("s", 0, "%1", 0, 100, 1, 80, 24, "a", "/", "t"),
    );
    const metrics = buildPaneMetrics(pane, cyclic, new Map());
    expect(metrics[0].processCount).toBe(2);
  });
});

describe("attachPanesToWindows", () => {
  it("places panes into their windows", () => {
    const windows = parseWindows(
      [join("s1", 0, 1, "main"), join("s1", 1, 0, "logs")].join("\n"),
    );
    const panes = parsePanes(
      [
        join("s1", 0, "%1", 0, 100, 1, 80, 24, "bash", "/", "t"),
        join("s1", 1, "%2", 0, 200, 0, 80, 24, "tail", "/", "t"),
        join("unknown", 5, "%3", 0, 300, 0, 80, 24, "bash", "/", "t"),
      ].join("\n"),
    );

    attachPanesToWindows(windows, panes);
    expect(windows.get("s1")![0].panes).toHaveLength(1);
    expect(windows.get("s1")![0].panes[0].id).toBe("%1");
    expect(windows.get("s1")![1].panes[0].id).toBe("%2");
  });
});

describe("shellEscape", () => {
  it("wraps in single quotes and escapes embedded quotes", () => {
    expect(shellEscape("simple")).toBe("'simple'");
    expect(shellEscape("it's")).toBe("'it'\\''s'");
    expect(shellEscape("$(rm -rf /)")).toBe("'$(rm -rf /)'");
  });
});
