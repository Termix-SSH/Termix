import { tmuxMonitorApi } from "@/main-axios";

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

export interface TmuxSessionOverview {
  name: string;
  created: number;
  lastActivity: number;
  attachedClients: number;
  windows: TmuxWindow[];
  tags: string[];
}

export interface TmuxOverview {
  available: boolean;
  sessions: TmuxSessionOverview[];
}

export interface TmuxSearchMatch {
  paneId: string;
  sessionName: string;
  windowIndex: number;
  line: number;
  text: string;
}

export interface TmuxPaneMetrics {
  paneId: string;
  sessionName: string;
  pid: number;
  processCount: number;
  cpuPercent: number;
  memRssKb: number;
  gpuMemMb: number;
  topCommand: string | null;
}

export async function getTmuxOverview(hostId: number): Promise<TmuxOverview> {
  const response = await tmuxMonitorApi.get(`/${hostId}/overview`);
  return response.data;
}

/** Select a pane's window+pane on the server so the attached terminal
 * (and any other attached client) switches to it. */
export async function focusTmuxPane(
  hostId: number,
  paneId: string,
): Promise<void> {
  await tmuxMonitorApi.post(`/${hostId}/focus`, { paneId });
}

export interface TmuxSearchResult {
  matches: TmuxSearchMatch[];
  /** True when a search limit was hit and the results are partial. */
  truncated: boolean;
  searchedLines: number;
  maxPanes: number;
}

export async function searchTmux(
  hostId: number,
  query: string,
): Promise<TmuxSearchResult> {
  const response = await tmuxMonitorApi.get(`/${hostId}/search`, {
    params: { q: query },
  });
  return {
    matches: response.data.matches ?? [],
    truncated: response.data.truncated ?? false,
    searchedLines: response.data.searchedLines ?? 0,
    maxPanes: response.data.maxPanes ?? 0,
  };
}

export async function getTmuxMetrics(
  hostId: number,
): Promise<TmuxPaneMetrics[]> {
  const response = await tmuxMonitorApi.get(`/${hostId}/metrics`);
  return response.data.panes ?? [];
}

export async function setTmuxSessionTags(
  hostId: number,
  sessionName: string,
  tags: string[],
): Promise<string[]> {
  const response = await tmuxMonitorApi.put(`/${hostId}/tags`, {
    sessionName,
    tags,
  });
  return response.data.tags ?? [];
}
