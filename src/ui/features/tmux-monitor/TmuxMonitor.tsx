import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  ExternalLink,
  Layers,
  MonitorPlay,
  Plus,
  RefreshCw,
  Search,
  Server,
  SquareTerminal,
} from "lucide-react";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/popover";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog";
import { Skeleton } from "@/components/skeleton";
import { ScrollArea } from "@/components/scroll-area";
import { getSSHHosts } from "@/main-axios";
import { isElectron } from "@/lib/electron";
import type { SSHHost } from "@/types/index";
import {
  getTmuxOverview,
  getTmuxMetrics,
  searchTmux,
  setTmuxSessionTags,
  focusTmuxPane,
  createTmuxSession,
  createTmuxWindow,
  renameTmuxSession,
  killTmuxSession,
  killTmuxWindow,
  killTmuxPane,
  splitTmuxPane,
  type TmuxOverview,
  type TmuxPaneMetrics,
  type TmuxSearchMatch,
  type TmuxSearchResult,
} from "@/api/tmux-monitor-api";
import type { TerminalHandle } from "@/features/terminal/Terminal";
import { SessionTree, type SessionMetricsAgg } from "./SessionTree";
import { SearchResults } from "./SearchResults";
import { PanePreview } from "./PanePreview";
import type { SelectedPane } from "./types";

const OVERVIEW_POLL_MS = 10_000;
const METRICS_POLL_MS = 10_000;
const TIME_TICK_MS = 30_000;

const LS_PREFIX = "termix-tmux-monitor-";
const LS_LAST_HOST_KEY = `${LS_PREFIX}last-host`;
const LS_TREE_WIDTH_KEY = `${LS_PREFIX}tree-width`;

const TREE_WIDTH_DEFAULT = 288; // matches the old fixed w-72
const TREE_WIDTH_MIN = 200;
const TREE_WIDTH_MAX = 520;

function expandedStorageKey(hostId: number): string {
  return `${LS_PREFIX}expanded-${hostId}`;
}

function readStoredExpanded(hostId: number): Set<string> | null {
  try {
    const raw = localStorage.getItem(expandedStorageKey(hostId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return null;
  }
}

export function TmuxMonitor({
  initialHostId,
  isVisible = true,
}: {
  initialHostId?: number;
  isVisible?: boolean;
}) {
  const { t } = useTranslation();
  const [hosts, setHosts] = useState<SSHHost[]>([]);
  const [hostsLoading, setHostsLoading] = useState(true);
  const [selectedHostId, setSelectedHostId] = useState<number | null>(null);
  const [overview, setOverview] = useState<TmuxOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(
    new Set(),
  );
  const [selectedPane, setSelectedPane] = useState<SelectedPane | null>(null);
  const [metrics, setMetrics] = useState<TmuxPaneMetrics[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [searchResults, setSearchResults] = useState<TmuxSearchMatch[] | null>(
    null,
  );
  const [searchLimits, setSearchLimits] = useState<Pick<
    TmuxSearchResult,
    "truncated" | "searchedLines" | "maxPanes"
  > | null>(null);
  const [searching, setSearching] = useState(false);
  // Bumped every 30s so relative "Xm ago" labels do not go stale.
  const [now, setNow] = useState(() => Date.now());
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Host whose data is currently on screen; responses for any other host are
  // stale (the user switched away while the request was in flight) and must
  // not overwrite the current tree.
  const activeHostRef = useRef<number | null>(null);
  // True when the expanded-session set for the current host was restored from
  // localStorage (or touched by the user) and must not be overwritten by the
  // default expand-all behavior.
  const expandedRestoredRef = useRef(false);
  // Imperative handle of the preview's embedded terminal. After tmux actions
  // that change the layout (split / kill-pane / new-window) the attached
  // client can render stale borders; a refit forces a PTY resize which makes
  // tmux fully redraw the client.
  const previewTermRef = useRef<TerminalHandle | null>(null);
  const nudgePreviewRedraw = useCallback(() => {
    setTimeout(() => {
      previewTermRef.current?.fit?.();
      previewTermRef.current?.notifyResize?.();
      previewTermRef.current?.refresh?.();
    }, 300);
  }, []);

  // -- resizable tree panel (same pattern as the AppShell host sidebar) -------
  const [treeWidth, setTreeWidth] = useState(() => {
    const saved = Number(localStorage.getItem(LS_TREE_WIDTH_KEY));
    return Number.isFinite(saved) && saved >= TREE_WIDTH_MIN
      ? Math.min(saved, TREE_WIDTH_MAX)
      : TREE_WIDTH_DEFAULT;
  });
  const [treeDragging, setTreeDragging] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(LS_TREE_WIDTH_KEY, String(treeWidth));
    } catch {
      // localStorage may be unavailable
    }
  }, [treeWidth]);
  const onTreeResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setTreeDragging(true);
      const startX = e.clientX;
      const startW = treeWidth;
      function onMove(ev: MouseEvent) {
        setTreeWidth(
          Math.max(
            TREE_WIDTH_MIN,
            Math.min(TREE_WIDTH_MAX, startW + ev.clientX - startX),
          ),
        );
      }
      function onUp() {
        setTreeDragging(false);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [treeWidth],
  );

  // -- hosts ----------------------------------------------------------------
  const loadHosts = useCallback(
    async (initial: boolean) => {
      try {
        const all: SSHHost[] = await getSSHHosts();
        const sshHosts = all.filter(
          (h) =>
            (h.connectionType ?? "ssh") === "ssh" &&
            h.enableTerminal !== false &&
            h.enableTmuxMonitor === true,
        );
        setHosts(sshHosts);
        setSelectedHostId((prev) => {
          if (prev !== null && sshHosts.some((h) => h.id === prev)) return prev;
          if (sshHosts.length === 0) return null;
          if (initial) {
            if (
              initialHostId != null &&
              sshHosts.some((h) => h.id === initialHostId)
            )
              return initialHostId;
            const stored = Number(localStorage.getItem(LS_LAST_HOST_KEY));
            if (
              Number.isFinite(stored) &&
              sshHosts.some((h) => h.id === stored)
            )
              return stored;
          }
          return sshHosts[0].id;
        });
      } catch {
        if (initial) toast.error(t("tmuxMonitor.failedToLoadHosts"));
      } finally {
        if (initial) setHostsLoading(false);
      }
    },
    // initialHostId is only consulted on the initial load; the mount effect
    // already runs once and the follow-initialHostId effect handles updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  );

  useEffect(() => {
    loadHosts(true);
  }, [loadHosts]);

  // The tab stays mounted while hosts are added or removed elsewhere (Host
  // Manager, sidebar), so follow the app-wide change event to keep the list
  // and selection current.
  useEffect(() => {
    const handler = () => loadHosts(false);
    window.addEventListener("termix:hosts-changed", handler);
    return () => window.removeEventListener("termix:hosts-changed", handler);
  }, [loadHosts]);

  // Reopening the singleton tab from a host action updates initialHostId;
  // follow it so the requested host gets selected without a remount.
  useEffect(() => {
    if (initialHostId == null) return;
    if (hosts.some((h) => h.id === initialHostId))
      setSelectedHostId(initialHostId);
    // Intentionally not depending on `hosts`: the mount effect already picks
    // the initial host once hosts load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHostId]);

  // -- relative time refresh --------------------------------------------------
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), TIME_TICK_MS);
    return () => clearInterval(interval);
  }, []);

  // -- overview polling -----------------------------------------------------
  const loadOverview = useCallback(
    async (hostId: number, silent = false) => {
      if (!silent) {
        setOverviewLoading(true);
        setOverviewError(null);
      }
      try {
        const data = await getTmuxOverview(hostId);
        if (activeHostRef.current !== hostId) return true;
        setOverview(data);
        setExpandedSessions((prev) => {
          if (expandedRestoredRef.current || prev.size > 0) return prev;
          return new Set(data.sessions.map((s) => s.name));
        });
        return true;
      } catch (err) {
        if (activeHostRef.current !== hostId) return true;
        if (!silent) {
          const axiosErr = err as {
            code?: string;
            response?: { data?: { error?: string; code?: string } };
          };
          const data = axiosErr.response?.data;
          // The client request can time out before the backend finishes its
          // own SSH connect timeout, so treat that like HOST_UNREACHABLE too.
          const unreachable =
            data?.code === "HOST_UNREACHABLE" ||
            axiosErr.code === "ECONNABORTED";
          if (data?.code === "TMUX_NOT_INSTALLED") {
            // Same friendly empty-state as the overview's available:false.
            setOverview({ available: false, sessions: [] });
            setOverviewError(null);
          } else {
            setOverview(null);
            setOverviewError(
              unreachable
                ? t("tmuxMonitor.hostUnreachable")
                : data?.code === "TMUX_NO_SERVER"
                  ? t("tmuxMonitor.noServer")
                  : data?.error ||
                    (err instanceof Error
                      ? err.message
                      : t("tmuxMonitor.failedToLoad")),
            );
          }
        }
        return false;
      } finally {
        if (!silent && activeHostRef.current === hostId)
          setOverviewLoading(false);
      }
    },
    [t],
  );

  // Manual refresh keeps the current tree on screen (no skeleton flash) and
  // only spins the refresh icons; the skeleton is reserved for the first load
  // of a host. Failures surface as a toast instead of silently keeping stale
  // data.
  const [refreshing, setRefreshing] = useState(false);
  const manualRefresh = useCallback(async () => {
    if (selectedHostId === null || refreshing) return;
    if (overview === null) {
      loadOverview(selectedHostId);
      return;
    }
    setRefreshing(true);
    try {
      const ok = await loadOverview(selectedHostId, true);
      if (!ok) toast.error(t("tmuxMonitor.refreshFailed"));
    } finally {
      setRefreshing(false);
    }
  }, [selectedHostId, refreshing, overview, loadOverview, t]);

  useEffect(() => {
    activeHostRef.current = selectedHostId;
    setOverview(null);
    setSelectedPane(null);
    setSearchResults(null);
    setMetrics([]);
    if (selectedHostId === null) return;
    try {
      localStorage.setItem(LS_LAST_HOST_KEY, String(selectedHostId));
    } catch {
      // localStorage may be unavailable
    }
    const storedExpanded = readStoredExpanded(selectedHostId);
    expandedRestoredRef.current = storedExpanded !== null;
    setExpandedSessions(storedExpanded ?? new Set());
    loadOverview(selectedHostId);
  }, [selectedHostId, loadOverview]);

  // Poll only while this app tab is shown: the component stays mounted when
  // the user switches tabs (AppShell keeps tab content alive) and would
  // otherwise keep running SSH execs against the host forever.
  useEffect(() => {
    if (selectedHostId === null || !isVisible) return;
    const interval = setInterval(() => {
      if (!document.hidden) loadOverview(selectedHostId, true);
    }, OVERVIEW_POLL_MS);
    return () => clearInterval(interval);
  }, [selectedHostId, isVisible, loadOverview]);

  // -- metrics polling ------------------------------------------------------
  useEffect(() => {
    if (selectedHostId === null || !overview?.available || !isVisible) return;
    let cancelled = false;
    const load = () => {
      if (document.hidden) return;
      getTmuxMetrics(selectedHostId)
        .then((m) => {
          if (!cancelled) setMetrics(m);
        })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, METRICS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedHostId, overview?.available, isVisible]);

  // -- keyboard shortcuts -----------------------------------------------------
  // Gated on isVisible: the listener is global, and a hidden-but-mounted tab
  // must not swallow "/" or Escape typed in other tabs.
  useEffect(() => {
    if (!isVisible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/") {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable)
          return;
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === "Escape") {
        if (searchResults !== null) setSearchResults(null);
        else if (selectedPane) setSelectedPane(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [searchResults, selectedPane, isVisible]);

  // -- search ---------------------------------------------------------------
  async function runSearch() {
    if (selectedHostId === null || !searchQuery.trim()) return;
    const query = searchQuery.trim();
    setSearching(true);
    try {
      const result = await searchTmux(selectedHostId, query);
      setSearchResults(result.matches);
      setSearchLimits(result);
      setSearchedQuery(query);
    } catch {
      toast.error(t("tmuxMonitor.searchFailed"));
    } finally {
      setSearching(false);
    }
  }

  const persistExpanded = useCallback((hostId: number, set: Set<string>) => {
    try {
      localStorage.setItem(
        expandedStorageKey(hostId),
        JSON.stringify([...set]),
      );
    } catch {
      // localStorage may be unavailable
    }
  }, []);

  function toggleSession(name: string) {
    const next = new Set(expandedSessions);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setExpandedSessions(next);
    expandedRestoredRef.current = true;
    if (selectedHostId !== null) persistExpanded(selectedHostId, next);
  }

  // Selecting a pane also focuses it on the server so the attached PTY (and
  // any other tmux client) switches to that window/pane.
  const selectPane = useCallback(
    (pane: SelectedPane) => {
      setSelectedPane(pane);
      if (selectedHostId !== null)
        focusTmuxPane(selectedHostId, pane.paneId).catch(() => {});
    },
    [selectedHostId],
  );

  function handleSearchSelect(match: TmuxSearchMatch) {
    selectPane({
      paneId: match.paneId,
      sessionName: match.sessionName,
      windowIndex: match.windowIndex,
    });
    if (!expandedSessions.has(match.sessionName)) {
      const next = new Set(expandedSessions).add(match.sessionName);
      setExpandedSessions(next);
      expandedRestoredRef.current = true;
      if (selectedHostId !== null) persistExpanded(selectedHostId, next);
    }
  }

  // -- create session ---------------------------------------------------------
  const [newSessionName, setNewSessionName] = useState("");
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  // Mirrors the backend's SESSION_NAME_RE (tmux forbids ":" and ".").
  const newSessionNameValid = /^[A-Za-z0-9_@%+=-]{1,64}$/.test(
    newSessionName.trim(),
  );

  async function createSession() {
    if (selectedHostId === null || !newSessionNameValid || creatingSession)
      return;
    const name = newSessionName.trim();
    setCreatingSession(true);
    try {
      await createTmuxSession(selectedHostId, name);
      toast.success(t("tmuxMonitor.sessionCreated", { name }));
      setNewSessionOpen(false);
      setNewSessionName("");
      const next = new Set(expandedSessions).add(name);
      setExpandedSessions(next);
      expandedRestoredRef.current = true;
      persistExpanded(selectedHostId, next);
      loadOverview(selectedHostId, true);
    } catch (err) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast.error(
        axiosErr.response?.data?.error || t("tmuxMonitor.sessionCreateFailed"),
      );
    } finally {
      setCreatingSession(false);
    }
  }

  // -- split ------------------------------------------------------------------
  // Splits the window containing a pane. If the pane is in the previewed
  // session the new pane appears in the attached terminal immediately; the
  // silent overview reload updates the tree.
  const splitPane = useCallback(
    async (paneId: string, direction: "h" | "v") => {
      if (selectedHostId === null) return;
      try {
        await splitTmuxPane(selectedHostId, paneId, direction);
        loadOverview(selectedHostId, true);
        nudgePreviewRedraw();
      } catch {
        toast.error(t("tmuxMonitor.splitFailed"));
      }
    },
    [selectedHostId, loadOverview, nudgePreviewRedraw, t],
  );

  // -- new window ---------------------------------------------------------------
  const newWindow = useCallback(
    async (sessionName: string) => {
      if (selectedHostId === null) return;
      try {
        await createTmuxWindow(selectedHostId, sessionName);
        loadOverview(selectedHostId, true);
        nudgePreviewRedraw();
      } catch {
        toast.error(t("tmuxMonitor.windowCreateFailed"));
      }
    },
    [selectedHostId, loadOverview, nudgePreviewRedraw, t],
  );

  // -- collapse / expand all ----------------------------------------------------
  const anyExpanded = expandedSessions.size > 0;
  function toggleAllSessions() {
    if (selectedHostId === null || !overview) return;
    const next = anyExpanded
      ? new Set<string>()
      : new Set(overview.sessions.map((s) => s.name));
    setExpandedSessions(next);
    expandedRestoredRef.current = true;
    persistExpanded(selectedHostId, next);
  }

  // -- rename / kill ------------------------------------------------------------
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const renameDraftValid = /^[A-Za-z0-9_@%+=-]{1,64}$/.test(renameDraft.trim());
  const [killTarget, setKillTarget] = useState<string | null>(null);
  const [killing, setKilling] = useState(false);

  async function confirmRename() {
    if (
      selectedHostId === null ||
      renameTarget === null ||
      !renameDraftValid ||
      renaming
    )
      return;
    const newName = renameDraft.trim();
    setRenaming(true);
    try {
      await renameTmuxSession(selectedHostId, renameTarget, newName);
      toast.success(t("tmuxMonitor.sessionRenamed", { name: newName }));
      if (expandedSessions.has(renameTarget)) {
        const next = new Set(expandedSessions);
        next.delete(renameTarget);
        next.add(newName);
        setExpandedSessions(next);
        persistExpanded(selectedHostId, next);
      }
      // Remounts the preview (keyed by session name) so it re-attaches under
      // the new name.
      if (selectedPane?.sessionName === renameTarget) {
        setSelectedPane({ ...selectedPane, sessionName: newName });
      }
      setRenameTarget(null);
      loadOverview(selectedHostId, true);
    } catch (err) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast.error(
        axiosErr.response?.data?.error || t("tmuxMonitor.sessionRenameFailed"),
      );
    } finally {
      setRenaming(false);
    }
  }

  async function confirmKill() {
    if (selectedHostId === null || killTarget === null || killing) return;
    setKilling(true);
    try {
      await killTmuxSession(selectedHostId, killTarget);
      toast.success(t("tmuxMonitor.sessionKilled", { name: killTarget }));
      if (selectedPane?.sessionName === killTarget) setSelectedPane(null);
      if (expandedSessions.has(killTarget)) {
        const next = new Set(expandedSessions);
        next.delete(killTarget);
        setExpandedSessions(next);
        persistExpanded(selectedHostId, next);
      }
      setKillTarget(null);
      loadOverview(selectedHostId, true);
    } catch (err) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast.error(
        axiosErr.response?.data?.error || t("tmuxMonitor.sessionKillFailed"),
      );
    } finally {
      setKilling(false);
    }
  }

  // After killing the selected pane/window, keep the preview on the same
  // session by selecting its now-active pane (tmux focuses a sibling
  // automatically); only fall back to the empty state when the whole session
  // died with it.
  const selectSurvivor = useCallback(
    (data: TmuxOverview, sessionName: string) => {
      const session = data.sessions.find((s) => s.name === sessionName);
      const win = session?.windows.find((w) => w.active) ?? session?.windows[0];
      const pane = win?.panes.find((p) => p.active) ?? win?.panes[0];
      if (session && win && pane) {
        setSelectedPane({
          paneId: pane.id,
          sessionName: session.name,
          windowIndex: win.index,
        });
      } else {
        setSelectedPane(null);
      }
    },
    [],
  );

  // -- kill window ------------------------------------------------------------
  const [killWindowTarget, setKillWindowTarget] = useState<{
    sessionName: string;
    windowIndex: number;
  } | null>(null);
  const [killingWindow, setKillingWindow] = useState(false);

  async function confirmKillWindow() {
    if (selectedHostId === null || killWindowTarget === null || killingWindow)
      return;
    setKillingWindow(true);
    try {
      await killTmuxWindow(
        selectedHostId,
        killWindowTarget.sessionName,
        killWindowTarget.windowIndex,
      );
      const wasViewing =
        selectedPane?.sessionName === killWindowTarget.sessionName &&
        selectedPane?.windowIndex === killWindowTarget.windowIndex;
      setKillWindowTarget(null);
      const data = await getTmuxOverview(selectedHostId);
      setOverview(data);
      if (wasViewing) selectSurvivor(data, killWindowTarget.sessionName);
      nudgePreviewRedraw();
    } catch (err) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast.error(
        axiosErr.response?.data?.error || t("tmuxMonitor.windowKillFailed"),
      );
    } finally {
      setKillingWindow(false);
    }
  }

  // -- kill pane ------------------------------------------------------------
  const [killPaneTarget, setKillPaneTarget] = useState<string | null>(null);
  const [killingPane, setKillingPane] = useState(false);

  async function confirmKillPane() {
    if (selectedHostId === null || killPaneTarget === null || killingPane)
      return;
    setKillingPane(true);
    try {
      await killTmuxPane(selectedHostId, killPaneTarget);
      const viewedSession =
        selectedPane?.paneId === killPaneTarget
          ? selectedPane.sessionName
          : null;
      setKillPaneTarget(null);
      const data = await getTmuxOverview(selectedHostId);
      setOverview(data);
      if (viewedSession) selectSurvivor(data, viewedSession);
      nudgePreviewRedraw();
    } catch (err) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast.error(
        axiosErr.response?.data?.error || t("tmuxMonitor.paneKillFailed"),
      );
    } finally {
      setKillingPane(false);
    }
  }

  // -- tags -----------------------------------------------------------------
  const [tagsTarget, setTagsTarget] = useState<string | null>(null);
  const [tagsDraft, setTagsDraft] = useState("");
  const [savingTags, setSavingTags] = useState(false);

  function openTagsEditor(sessionName: string) {
    const session = overview?.sessions.find((s) => s.name === sessionName);
    setTagsDraft(session?.tags.join(", ") ?? "");
    setTagsTarget(sessionName);
  }

  async function confirmTags() {
    if (selectedHostId === null || tagsTarget === null || savingTags) return;
    const tags = tagsDraft
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setSavingTags(true);
    try {
      await setTmuxSessionTags(selectedHostId, tagsTarget, tags);
      toast.success(t("tmuxMonitor.tagsSaved"));
      setTagsTarget(null);
      loadOverview(selectedHostId, true);
    } catch {
      toast.error(t("tmuxMonitor.tagsSaveFailed"));
    } finally {
      setSavingTags(false);
    }
  }

  // Attach inside the monitor: expand the session and select its active pane
  // so the embedded terminal (a real tmux attach) shows it.
  const attachInline = useCallback(
    (sessionName: string) => {
      const session = overview?.sessions.find((s) => s.name === sessionName);
      if (!session) return;
      const activeWindow =
        session.windows.find((w) => w.active) ?? session.windows[0];
      const activePane =
        activeWindow?.panes.find((p) => p.active) ?? activeWindow?.panes[0];
      if (!activePane || !activeWindow) return;
      if (!expandedSessions.has(sessionName)) {
        const next = new Set(expandedSessions).add(sessionName);
        setExpandedSessions(next);
        expandedRestoredRef.current = true;
        if (selectedHostId !== null) persistExpanded(selectedHostId, next);
      }
      selectPane({
        paneId: activePane.id,
        sessionName,
        windowIndex: activeWindow.index,
      });
    },
    [overview, expandedSessions, selectedHostId, persistExpanded, selectPane],
  );

  function openTerminal(sessionName?: string) {
    if (selectedHostId === null) return;
    const session = sessionName ?? selectedPane?.sessionName;
    // window.open is denied by Electron's window-open handler (internal
    // file:// URLs never reach the browser), so the desktop app attaches in
    // the monitor's own terminal instead.
    if (isElectron()) {
      if (session) attachInline(session);
      return;
    }
    const params = new URLSearchParams({
      view: "terminal",
      hostId: String(selectedHostId),
    });
    if (session) params.set("tmuxSession", session);
    window.open(`${window.location.pathname}?${params.toString()}`, "_blank");
  }

  const metricsByPane = useMemo(() => {
    const map = new Map<string, TmuxPaneMetrics>();
    for (const m of metrics) map.set(m.paneId, m);
    return map;
  }, [metrics]);

  const metricsBySession = useMemo(() => {
    const map = new Map<string, SessionMetricsAgg>();
    for (const m of metrics) {
      const agg = map.get(m.sessionName) || { cpu: 0, memKb: 0, gpuMb: 0 };
      agg.cpu += m.cpuPercent;
      agg.memKb += m.memRssKb;
      agg.gpuMb += m.gpuMemMb;
      map.set(m.sessionName, agg);
    }
    return map;
  }, [metrics]);

  const selectedHost = hosts.find((h) => h.id === selectedHostId);
  const hostLabel = selectedHost
    ? selectedHost.name || `${selectedHost.username}@${selectedHost.ip}`
    : "";
  const selectedPaneMetrics = selectedPane
    ? metricsByPane.get(selectedPane.paneId)
    : undefined;

  return (
    <div className="flex h-full w-full bg-background text-foreground">
      {/* Left rail: hosts + session tree. Resizable via the right-edge
          handle; double-click resets to the default width. */}
      <div
        className="relative flex shrink-0 flex-col border-r border-border bg-card"
        style={{ width: treeWidth }}
      >
        {/* VSCode tmux-manager style header: title + new-session / refresh */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Layers className="size-4" />
          <span className="text-sm font-semibold">
            {t("tmuxMonitor.title")}
          </span>
          <span className="ml-auto flex items-center gap-2">
            <Popover
              open={newSessionOpen}
              onOpenChange={(open) => {
                setNewSessionOpen(open);
                if (open) setNewSessionName("");
              }}
            >
              <PopoverTrigger asChild>
                <button
                  className="text-muted-foreground hover:text-foreground disabled:opacity-40"
                  disabled={selectedHostId === null || !overview?.available}
                  title={t("tmuxMonitor.newSession")}
                  aria-label={t("tmuxMonitor.newSession")}
                >
                  <Plus className="size-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                className="w-64 rounded-none border-0 p-2 ring-1 ring-border"
                align="start"
              >
                <p className="mb-1 text-xs text-muted-foreground">
                  {t("tmuxMonitor.newSessionHint")}
                </p>
                <div className="flex gap-1">
                  <Input
                    className="h-7 text-xs"
                    value={newSessionName}
                    placeholder={t("tmuxMonitor.newSessionPlaceholder")}
                    autoFocus
                    onChange={(e) => setNewSessionName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") createSession();
                    }}
                  />
                  <Button
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={!newSessionNameValid || creatingSession}
                    onClick={createSession}
                  >
                    {t("tmuxMonitor.create")}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            <button
              className="text-muted-foreground hover:text-foreground disabled:opacity-40"
              disabled={!overview?.available}
              title={
                anyExpanded
                  ? t("tmuxMonitor.collapseAll")
                  : t("tmuxMonitor.expandAll")
              }
              aria-label={
                anyExpanded
                  ? t("tmuxMonitor.collapseAll")
                  : t("tmuxMonitor.expandAll")
              }
              onClick={toggleAllSessions}
            >
              {anyExpanded ? (
                <ChevronsDownUp className="size-3.5" />
              ) : (
                <ChevronsUpDown className="size-3.5" />
              )}
            </button>
            <button
              className="text-muted-foreground hover:text-foreground disabled:opacity-40"
              disabled={selectedHostId === null || overviewLoading}
              title={t("tmuxMonitor.refresh")}
              aria-label={t("tmuxMonitor.refresh")}
              onClick={manualRefresh}
            >
              <RefreshCw
                className={`size-3.5 ${overviewLoading || refreshing ? "animate-spin" : ""}`}
              />
            </button>
            <a
              href="https://docs.termix.site/features/terminal/tmux"
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground"
              title={t("hosts.docsLink")}
              aria-label={t("hosts.docsLink")}
            >
              <ExternalLink className="size-3.5" />
            </a>
          </span>
        </div>
        {/* Radix wraps the viewport content in a display:table div sized to
            the widest row, so one long pane path would stretch every row and
            clip the right-aligned actions; force block so rows shrink and
            truncate instead. */}
        <ScrollArea className="flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
          <div className="p-2">
            {!hostsLoading && hosts.length === 0 && (
              <div className="px-2 py-4">
                <p className="text-sm text-muted-foreground">
                  {t("tmuxMonitor.noHosts")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  {t("tmuxMonitor.noHostsHint")}
                </p>
              </div>
            )}
            {overviewLoading && (
              <div className="space-y-3 px-2 py-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="space-y-1.5">
                    <Skeleton className="h-5 w-full rounded-md" />
                    <Skeleton className="ml-6 h-3.5 w-3/4 rounded-md" />
                    <Skeleton className="ml-6 h-3.5 w-2/3 rounded-md" />
                  </div>
                ))}
              </div>
            )}
            {overviewError && (
              <div className="space-y-2 px-2 py-4">
                <p className="text-sm text-destructive">{overviewError}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() =>
                    selectedHostId !== null && loadOverview(selectedHostId)
                  }
                >
                  <RefreshCw className="mr-1 size-3" />
                  {t("tmuxMonitor.retry")}
                </Button>
              </div>
            )}
            {overview && !overview.available && (
              <div className="px-2 py-4">
                <p className="text-sm text-muted-foreground">
                  {t("tmuxMonitor.tmuxUnavailable")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  {t("tmuxMonitor.tmuxInstallHint")}{" "}
                  <code className="font-mono">sudo apt install tmux</code>
                </p>
              </div>
            )}
            {overview?.available && overview.sessions.length === 0 && (
              <p className="px-2 py-4 text-sm text-muted-foreground">
                {t("tmuxMonitor.noSessions")}
              </p>
            )}
            {overview?.available && (
              <SessionTree
                sessions={overview.sessions}
                expandedSessions={expandedSessions}
                onToggleSession={toggleSession}
                selectedPaneId={selectedPane?.paneId ?? null}
                onSelectPane={selectPane}
                metricsByPane={metricsByPane}
                metricsBySession={metricsBySession}
                onEditTags={openTagsEditor}
                onAttachSession={openTerminal}
                onNewWindow={newWindow}
                onRenameSession={(name) => {
                  setRenameDraft(name);
                  setRenameTarget(name);
                }}
                onKillSession={setKillTarget}
                onKillPane={setKillPaneTarget}
                onSplitPane={splitPane}
                onKillWindow={(sessionName, windowIndex) =>
                  setKillWindowTarget({ sessionName, windowIndex })
                }
                compact={treeWidth < 280}
                now={now}
              />
            )}
          </div>
        </ScrollArea>

        <div
          onMouseDown={onTreeResizeMouseDown}
          onDoubleClick={() => setTreeWidth(TREE_WIDTH_DEFAULT)}
          title={t("tmuxMonitor.resizeTree")}
          className={`absolute bottom-0 right-0 top-0 z-30 w-1 cursor-col-resize transition-colors ${treeDragging ? "bg-accent-brand/60" : "hover:bg-accent-brand/40"}`}
        />
      </div>

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Server className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm">
            {selectedHost ? hostLabel : t("tmuxMonitor.noHostSelected")}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                className="h-8 w-64 pl-7 text-sm"
                placeholder={t("tmuxMonitor.searchPlaceholder")}
                value={searchQuery}
                disabled={!overview?.available}
                title={
                  overview && !overview.available
                    ? t("tmuxMonitor.tmuxUnavailable")
                    : undefined
                }
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") runSearch();
                }}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={selectedHostId === null || overviewLoading}
              title={t("tmuxMonitor.refresh")}
              aria-label={t("tmuxMonitor.refresh")}
              onClick={manualRefresh}
            >
              <RefreshCw
                className={`size-3.5 ${overviewLoading || refreshing ? "animate-spin" : ""}`}
              />
            </Button>
            <Button
              size="sm"
              className="h-8"
              disabled={selectedHostId === null}
              title={
                selectedHost
                  ? selectedPane
                    ? t("tmuxMonitor.attachTooltipPane", {
                        host: hostLabel,
                        session: selectedPane.sessionName,
                      })
                    : t("tmuxMonitor.attachTooltip", { host: hostLabel })
                  : undefined
              }
              onClick={() => openTerminal()}
            >
              <SquareTerminal className="mr-1 size-3.5" />
              {t("tmuxMonitor.attach")}
            </Button>
          </div>
        </div>

        {/* Search results */}
        {searchResults !== null && (
          <SearchResults
            results={searchResults}
            searching={searching}
            query={searchedQuery}
            limits={searchLimits}
            onSelect={handleSearchSelect}
            onClose={() => setSearchResults(null)}
          />
        )}

        {/* Pane preview */}
        <div className="flex min-h-0 flex-1 flex-col">
          {selectedPane && selectedHost ? (
            <PanePreview
              key={`${selectedHost.id}:${selectedPane.sessionName}`}
              host={selectedHost}
              pane={selectedPane}
              metrics={selectedPaneMetrics}
              terminalRef={previewTermRef}
              onSplit={(direction) => splitPane(selectedPane.paneId, direction)}
              onKillPane={() => setKillPaneTarget(selectedPane.paneId)}
              onClose={() => setSelectedPane(null)}
            />
          ) : !hostsLoading && hosts.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="max-w-sm text-center text-muted-foreground">
                <Server className="mx-auto mb-2 size-8 opacity-50" />
                <p className="text-sm">{t("tmuxMonitor.noHosts")}</p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  {t("tmuxMonitor.noHostsHint")}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center text-muted-foreground">
                <MonitorPlay className="mx-auto mb-2 size-8 opacity-50" />
                <p className="text-sm">{t("tmuxMonitor.selectPaneHint")}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Rename session dialog */}
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("tmuxMonitor.renameSessionTitle", { name: renameTarget })}
            </DialogTitle>
          </DialogHeader>
          <Input
            value={renameDraft}
            placeholder={t("tmuxMonitor.newSessionPlaceholder")}
            autoFocus
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmRename();
            }}
          />
          <p className="text-xs text-muted-foreground">
            {t("tmuxMonitor.newSessionHint")}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={!renameDraftValid || renaming}
              onClick={confirmRename}
            >
              {t("tmuxMonitor.rename")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit tags dialog */}
      <Dialog
        open={tagsTarget !== null}
        onOpenChange={(open) => {
          if (!open) setTagsTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("tmuxMonitor.editTagsTitle", { name: tagsTarget })}
            </DialogTitle>
          </DialogHeader>
          <Input
            value={tagsDraft}
            placeholder="YOLO, lab, training"
            autoFocus
            onChange={(e) => setTagsDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmTags();
            }}
          />
          <p className="text-xs text-muted-foreground">
            {t("tmuxMonitor.tagsHint")}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTagsTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button disabled={savingTags} onClick={confirmTags}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Kill window confirmation */}
      <Dialog
        open={killWindowTarget !== null}
        onOpenChange={(open) => {
          if (!open) setKillWindowTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("tmuxMonitor.killWindowTitle", {
                index: killWindowTarget?.windowIndex,
                session: killWindowTarget?.sessionName,
              })}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {t("tmuxMonitor.killWindowBody")}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKillWindowTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={killingWindow}
              onClick={confirmKillWindow}
            >
              {t("tmuxMonitor.kill")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Kill pane confirmation */}
      <Dialog
        open={killPaneTarget !== null}
        onOpenChange={(open) => {
          if (!open) setKillPaneTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("tmuxMonitor.killPaneTitle", { id: killPaneTarget })}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {t("tmuxMonitor.killPaneBody")}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKillPaneTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={killingPane}
              onClick={confirmKillPane}
            >
              {t("tmuxMonitor.kill")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Kill session confirmation */}
      <Dialog
        open={killTarget !== null}
        onOpenChange={(open) => {
          if (!open) setKillTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("tmuxMonitor.killSessionTitle", { name: killTarget })}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {t("tmuxMonitor.killSessionBody")}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKillTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={killing}
              onClick={confirmKill}
            >
              {t("tmuxMonitor.kill")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default TmuxMonitor;
