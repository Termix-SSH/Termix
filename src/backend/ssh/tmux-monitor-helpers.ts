// Pure parsing/aggregation helpers for the tmux monitor module.
// Kept free of SSH/Express dependencies so they can be unit-tested.

// Field separator used in tmux -F format strings. Session names, pane titles
// and paths may contain "|", and tmux sanitizes control characters (and, under
// non-UTF-8 locales, multibyte characters) in format output to "_", so a
// printable ASCII token is the only separator that survives everywhere.
export const SEP = "<<TMX>>";

export interface TmuxPane {
  id: string;
  index: number;
  pid: number;
  active: boolean;
  width: number;
  height: number;
  command: string;
  path: string;
  title: string;
}

export interface TmuxWindow {
  index: number;
  name: string;
  active: boolean;
  panes: TmuxPane[];
}

export interface TmuxSessionSummary {
  name: string;
  created: number;
  lastActivity: number;
  attachedClients: number;
}

export interface RawPane extends TmuxPane {
  sessionName: string;
  windowIndex: number;
}

export interface ProcessInfo {
  pid: number;
  ppid: number;
  cpu: number;
  mem: number;
  rss: number;
  comm: string;
}

export interface PaneMetrics {
  paneId: string;
  sessionName: string;
  pid: number;
  processCount: number;
  cpuPercent: number;
  memRssKb: number;
  gpuMemMb: number;
  topCommand: string | null;
}

export function parseSessions(output: string): TmuxSessionSummary[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, created, activity, attached] = line.split(SEP);
      return {
        name,
        created: parseInt(created, 10) || 0,
        lastActivity: parseInt(activity, 10) || 0,
        attachedClients: parseInt(attached, 10) || 0,
      };
    });
}

export function parseWindows(output: string): Map<string, TmuxWindow[]> {
  const bySession = new Map<string, TmuxWindow[]>();
  for (const line of output.split("\n").filter(Boolean)) {
    const [session, index, active, name] = line.split(SEP);
    if (!bySession.has(session)) bySession.set(session, []);
    bySession.get(session)!.push({
      index: parseInt(index, 10) || 0,
      name: name || "",
      active: active === "1",
      panes: [],
    });
  }
  return bySession;
}

export function parsePanes(output: string): RawPane[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [
        sessionName,
        windowIndex,
        id,
        index,
        pid,
        active,
        width,
        height,
        command,
        path,
        title,
      ] = line.split(SEP);
      return {
        sessionName,
        windowIndex: parseInt(windowIndex, 10) || 0,
        id,
        index: parseInt(index, 10) || 0,
        pid: parseInt(pid, 10) || 0,
        active: active === "1",
        width: parseInt(width, 10) || 0,
        height: parseInt(height, 10) || 0,
        command: command || "",
        path: path || "",
        title: title || "",
      };
    });
}

export function parsePsOutput(output: string): ProcessInfo[] {
  const processes: ProcessInfo[] = [];
  for (const line of output.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;
    const pid = parseInt(parts[0], 10);
    const ppid = parseInt(parts[1], 10);
    if (isNaN(pid) || isNaN(ppid)) continue;
    processes.push({
      pid,
      ppid,
      cpu: parseFloat(parts[2]) || 0,
      mem: parseFloat(parts[3]) || 0,
      rss: parseInt(parts[4], 10) || 0,
      comm: parts.slice(5).join(" "),
    });
  }
  return processes;
}

export function parseGpuOutput(output: string): Map<number, number> {
  const gpuByPid = new Map<number, number>();
  for (const line of output.split("\n").filter(Boolean)) {
    const [pid, mem] = line.split(",").map((s) => s.trim());
    const pidNum = parseInt(pid, 10);
    const memNum = parseInt(mem, 10);
    if (!isNaN(pidNum) && !isNaN(memNum)) {
      gpuByPid.set(pidNum, (gpuByPid.get(pidNum) || 0) + memNum);
    }
  }
  return gpuByPid;
}

/**
 * Map each pane's shell pid to its descendant process tree and aggregate
 * CPU/RAM/GPU usage per pane.
 */
export function buildPaneMetrics(
  panes: RawPane[],
  processes: ProcessInfo[],
  gpuByPid: Map<number, number>,
): PaneMetrics[] {
  const byPid = new Map<number, ProcessInfo>();
  const childrenOf = new Map<number, number[]>();
  for (const p of processes) {
    byPid.set(p.pid, p);
    if (!childrenOf.has(p.ppid)) childrenOf.set(p.ppid, []);
    childrenOf.get(p.ppid)!.push(p.pid);
  }

  return panes.map((pane) => {
    // Walk the descendant tree starting at (and including) the pane's shell
    const treePids: number[] = [];
    const queue = [pane.pid];
    const seen = new Set<number>();
    while (queue.length > 0) {
      const pid = queue.shift()!;
      if (seen.has(pid)) continue;
      seen.add(pid);
      if (byPid.has(pid)) treePids.push(pid);
      for (const child of childrenOf.get(pid) || []) queue.push(child);
    }

    let cpuPercent = 0;
    let memRssKb = 0;
    let gpuMemMb = 0;
    let topCommand: string | null = null;
    let topCpu = -1;
    for (const pid of treePids) {
      const p = byPid.get(pid)!;
      cpuPercent += p.cpu;
      memRssKb += p.rss;
      gpuMemMb += gpuByPid.get(pid) || 0;
      // The pane shell itself is rarely the interesting process
      if (p.cpu > topCpu && pid !== pane.pid) {
        topCpu = p.cpu;
        topCommand = p.comm;
      }
    }
    if (topCommand === null && treePids.length > 0) {
      topCommand = byPid.get(treePids[0])!.comm;
    }

    return {
      paneId: pane.id,
      sessionName: pane.sessionName,
      pid: pane.pid,
      processCount: treePids.length,
      cpuPercent: Math.round(cpuPercent * 10) / 10,
      memRssKb,
      gpuMemMb,
      topCommand,
    };
  });
}

/**
 * Group panes into their windows (mutates the window objects' pane arrays).
 */
export function attachPanesToWindows(
  windows: Map<string, TmuxWindow[]>,
  panes: RawPane[],
): void {
  for (const pane of panes) {
    const sessionWindows = windows.get(pane.sessionName) || [];
    const window = sessionWindows.find((w) => w.index === pane.windowIndex);
    if (window) {
      const { sessionName: _s, windowIndex: _w, ...paneFields } = pane;
      window.panes.push(paneFields);
    }
  }
}

export function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
