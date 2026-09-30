import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useHosts,
  useToast,
  useTranslation,
} from "@termix/plugin-sdk/frontend";
import type { PluginHostRecord, TabHandle } from "@termix/plugin-sdk/frontend";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  Skeleton,
  isElectron,
} from "@termix/plugin-sdk/ui";
import {
  ChevronDown,
  ChevronRight,
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
} from "./api";
import { tmuxMonitorEnabled } from "./host-tmux-monitor";
import { useAdaptivePolling } from "./use-adaptive-polling";
import { SessionTree, type SessionMetricsAgg } from "./SessionTree";
import { SearchResults } from "./SearchResults";
import { PanePreview } from "./PanePreview";
import type { SelectedPane } from "./types";

import { HostOverview } from "./HostOverview";
import {
  readMonitorValue,
  saveMonitorValue,
  readExpanded,
  readSelectedPane,
} from "./monitor-storage";

type TreeAction =
  | { type: "pane"; pane: SelectedPane }
  | {
      type: "attach" | "tags" | "rename" | "killSession" | "newWindow";
      session: string;
    }
  | { type: "killPane"; paneId: string }
  | { type: "split"; paneId: string; direction: "h" | "v" }
  | { type: "killWindow"; session: string; index: number };

const OVERVIEW_POLL_MS = 10_000;
const METRICS_POLL_MS = 10_000;
const TIME_TICK_MS = 30_000;

const LS_PREFIX = "termix-tmux-monitor-";
const LS_LAST_HOST_KEY = `${LS_PREFIX}last-host`;
const LS_TREE_WIDTH_KEY = `${LS_PREFIX}tree-width`;

const TREE_WIDTH_DEFAULT = 288; // matches the old fixed w-72
const TREE_WIDTH_MIN = 200;
const TREE_WIDTH_MAX = 520;

function expandedStorageKey(hostId: string | number): string {
  return `${LS_PREFIX}expanded-${hostId}`;
}

export function TmuxMonitor({
  initialHostId,
  initialHostRequest,
  isVisible = true,
}: {
  initialHostId?: number;
  initialHostRequest?: number;
  isVisible?: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { hosts: allHosts, loaded: hostsLoaded } = useHosts();
  const hosts = useMemo(
    () =>
      allHosts.filter(
        (h) =>
          h.enableSsh !== false &&
          ((h.connectionType as string | undefined) ?? "ssh") === "ssh" &&
          tmuxMonitorEnabled(h),
      ),
    [allHosts],
  );
  const [selectedHostId, setSelectedHostId] = useState<string | number | null>(
    null,
  );
  const [scope, setScope] = useState<"all" | "single">(() =>
    readMonitorValue<string>("scope", "all") === "single" ? "single" : "all",
  );
  const [hostFilter, setHostFilter] = useState(() => {
    const value = readMonitorValue<unknown>("filter", "");
    return typeof value === "string" ? value : "";
  });
  const [collapsedHosts, setCollapsedHosts] = useState<Set<string>>(() => {
    const value = readMonitorValue<unknown>("collapsed-hosts", []);
    return new Set(
      Array.isArray(value)
        ? value.filter((id): id is string => typeof id === "string")
        : [],
    );
  });
  const [expandedByHost, setExpandedByHost] = useState<
    Record<string, Set<string>>
  >({});
  const [pendingAction, setPendingAction] = useState<{
    hostId: string | number;
    action: TreeAction;
  } | null>(null);
  const [overviewHostId, setOverviewHostId] = useState<string | number | null>(
    null,
  );
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
  const activeHostRef = useRef<string | number | null>(null);
  const hostGeneration = useRef(0);
  const overviewSignatureRef = useRef("");
  const metricsSignatureRef = useRef("");
  // True when the expanded-session set for the current host was restored from
  // localStorage (or touched by the user) and must not be overwritten by the
  // default expand-all behavior.
  const expandedRestoredRef = useRef(false);
  // Imperative handle of the preview's embedded terminal. After tmux actions
  // that change the layout (split / kill-pane / new-window) the attached
  // client can render stale borders; a refit forces a PTY resize which makes
  // tmux fully redraw the client.
  const previewTermRef = useRef<TabHandle | null>(null);
  const nudgePreviewRedraw = useCallback(() => {
    setTimeout(() => {
      previewTermRef.current?.fit?.();
      previewTermRef.current?.notifyResize?.();
      previewTermRef.current?.refresh?.();
    }, 300);
  }, []);

  // -- resizable tree panel (same pattern as the AppShell host sidebar) -------
  const [treeWidth, setTreeWidth] = useState(() => {
    const saved = Number(readMonitorValue("tree-width", TREE_WIDTH_DEFAULT));
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

  // -- host selection ---------------------------------------------------------
  const initialHostPicked = useRef(false);
  useEffect(() => {
    if (!hostsLoaded || initialHostPicked.current) return;
    setSelectedHostId((prev) => {
      if (prev !== null && hosts.some((h) => h.id === prev)) return prev;
      if (hosts.length === 0) return null;
      if (
        initialHostId != null &&
        hosts.some((h) => String(h.id) === String(initialHostId))
      ) {
        initialHostPicked.current = true;
        return hosts.find((h) => String(h.id) === String(initialHostId))!.id;
      }
      const stored = readMonitorValue<string | number | null>(
        "last-host",
        null,
      );
      if (
        stored !== null &&
        hosts.some((h) => String(h.id) === String(stored))
      ) {
        initialHostPicked.current = true;
        return hosts.find((h) => String(h.id) === String(stored))!.id;
      }
      initialHostPicked.current = true;
      return hosts[0].id;
    });
  }, [hostsLoaded, hosts, initialHostId]);

  // If the selected host disappears (deleted, or the monitor was turned off
  // for it), fall back the same way the initial pick does.
  useEffect(() => {
    if (!hostsLoaded || selectedHostId === null) return;
    if (hosts.some((h) => String(h.id) === String(selectedHostId))) return;
    setSelectedHostId(hosts.length > 0 ? hosts[0].id : null);
  }, [hostsLoaded, hosts, selectedHostId]);

  // Reopening the singleton tab from a host action updates initialHostId;
  // follow it so the requested host gets selected without a remount.
  useEffect(() => {
    if (initialHostId == null) return;
    const host = hosts.find((h) => String(h.id) === String(initialHostId));
    if (host) setSelectedHostId(host.id);
    setHostFilter("");
    saveMonitorValue("filter", "");
    setCollapsedHosts((previous) => {
      const next = new Set(previous);
      next.delete(String(initialHostId));
      saveMonitorValue("collapsed-hosts", [...next]);
      return next;
    });
    // Intentionally not depending on `hosts`: the mount effect already picks
    // the initial host once hosts load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHostId, initialHostRequest]);

  // -- relative time refresh --------------------------------------------------
  useEffect(() => {
    if (!isVisible) return;
    const interval = setInterval(() => setNow(Date.now()), TIME_TICK_MS);
    return () => clearInterval(interval);
  }, [isVisible]);

  // -- overview polling -----------------------------------------------------
  const loadOverview = useCallback(
    async (hostId: string | number, silent = false) => {
      const generation = hostGeneration.current;
      if (!silent) {
        setOverviewLoading(true);
        setOverviewError(null);
      }
      try {
        const data = await getTmuxOverview(Number(hostId));
        if (
          activeHostRef.current !== hostId ||
          generation !== hostGeneration.current
        )
          return true;
        const signature = JSON.stringify(data);
        const changed = signature !== overviewSignatureRef.current;
        overviewSignatureRef.current = signature;
        setOverviewError(null);
        setOverviewHostId(hostId);
        setOverview(data);
        setSelectedPane((pane) => {
          const candidate = pane ?? readSelectedPane(hostId);
          const exists =
            candidate &&
            data.sessions.some(
              (session) =>
                session.name === candidate.sessionName &&
                session.windows.some(
                  (win) =>
                    win.index === candidate.windowIndex &&
                    win.panes.some((p) => p.id === candidate.paneId),
                ),
            );
          if (!exists) saveMonitorValue(`pane-${hostId}`, null);
          return exists ? candidate : null;
        });
        setExpandedSessions((prev) => {
          if (expandedRestoredRef.current || prev.size > 0) return prev;
          return new Set(data.sessions.map((s) => s.name));
        });
        return changed;
      } catch (err) {
        if (
          activeHostRef.current !== hostId ||
          generation !== hostGeneration.current
        )
          return true;
        setPendingAction((pending) =>
          pending?.hostId === hostId ? null : pending,
        );
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
        if (silent) throw err;
        return false;
      } finally {
        if (
          !silent &&
          activeHostRef.current === hostId &&
          generation === hostGeneration.current
        )
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
      await loadOverview(selectedHostId, true);
    } catch {
      toast.error(t("tmuxMonitor.refreshFailed"));
    } finally {
      setRefreshing(false);
    }
  }, [selectedHostId, refreshing, overview, loadOverview, t, toast]);

  useEffect(() => {
    activeHostRef.current = selectedHostId;
    hostGeneration.current++;
    setOverview(null);
    setOverviewHostId(null);
    setSelectedPane(null);
    overviewSignatureRef.current = "";
    metricsSignatureRef.current = "";
    setSearchResults(null);
    setMetrics([]);
    if (selectedHostId === null) return;
    try {
      localStorage.setItem(LS_LAST_HOST_KEY, String(selectedHostId));
    } catch {
      // localStorage may be unavailable
    }
    const storedExpanded = readExpanded(selectedHostId);
    expandedRestoredRef.current = storedExpanded !== null;
    setExpandedSessions(storedExpanded ?? new Set());
    loadOverview(selectedHostId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHostId]);

  // Poll only while this app tab is shown: the component stays mounted when
  // the user switches tabs (AppShell keeps tab content alive) and would
  // otherwise keep running SSH execs against the host forever.
  useAdaptivePolling(
    () =>
      selectedHostId === null ? undefined : loadOverview(selectedHostId, true),
    {
      minIntervalMs: OVERVIEW_POLL_MS,
      maxIntervalMs: 60_000,
      stablePollsPerStep: 3,
    },
    selectedHostId !== null && isVisible,
    { runImmediately: false },
  );

  // -- metrics polling ------------------------------------------------------
  useAdaptivePolling(
    async () => {
      if (selectedHostId === null) return;
      const hostId = selectedHostId;
      const generation = hostGeneration.current;
      const next = await getTmuxMetrics(Number(hostId));
      if (
        activeHostRef.current !== hostId ||
        generation !== hostGeneration.current
      )
        return;
      const signature = JSON.stringify(next);
      const changed = signature !== metricsSignatureRef.current;
      metricsSignatureRef.current = signature;
      setMetrics(next);
      return changed;
    },
    {
      minIntervalMs: METRICS_POLL_MS,
      maxIntervalMs: 60_000,
      stablePollsPerStep: 3,
    },
    selectedHostId !== null &&
      overviewHostId === selectedHostId &&
      !!overview?.available &&
      isVisible,
  );

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
      const result = await searchTmux(Number(selectedHostId), query);
      if (activeHostRef.current !== selectedHostId) return;
      setSearchResults(result.matches);
      setSearchLimits(result);
      setSearchedQuery(query);
    } catch {
      toast.error(t("tmuxMonitor.searchFailed"));
    } finally {
      setSearching(false);
    }
  }

  const persistExpanded = useCallback(
    (hostId: string | number, set: Set<string>) => {
      setExpandedByHost((previous) => ({
        ...previous,
        [String(hostId)]: new Set(set),
      }));
      try {
        localStorage.setItem(
          expandedStorageKey(hostId),
          JSON.stringify([...set]),
        );
      } catch {
        // localStorage may be unavailable
      }
    },
    [],
  );

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
      saveMonitorValue(`pane-${selectedHostId}`, pane);
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

  useEffect(() => {
    if (
      selectedPane &&
      selectedHostId !== null &&
      overviewHostId === selectedHostId
    )
      void focusTmuxPane(Number(selectedHostId), selectedPane.paneId).catch(
        () => {},
      );
  }, [selectedHostId, overviewHostId, selectedPane]);

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
      await createTmuxSession(Number(selectedHostId), name);
      if (activeHostRef.current !== selectedHostId) return;
      toast.success(t("tmuxMonitor.sessionCreated", { name }));
      setNewSessionOpen(false);
      setNewSessionName("");
      const next = new Set(expandedSessions).add(name);
      setExpandedSessions(next);
      expandedRestoredRef.current = true;
      persistExpanded(selectedHostId, next);
      void loadOverview(selectedHostId, true).catch(() => {});
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
        await splitTmuxPane(Number(selectedHostId), paneId, direction);
        if (activeHostRef.current !== selectedHostId) return;
        void loadOverview(selectedHostId, true).catch(() => {});
        nudgePreviewRedraw();
      } catch {
        toast.error(t("tmuxMonitor.splitFailed"));
      }
    },
    [selectedHostId, loadOverview, nudgePreviewRedraw, t, toast],
  );

  // -- new window ---------------------------------------------------------------
  const newWindow = useCallback(
    async (sessionName: string) => {
      if (selectedHostId === null) return;
      try {
        await createTmuxWindow(Number(selectedHostId), sessionName);
        if (activeHostRef.current !== selectedHostId) return;
        void loadOverview(selectedHostId, true).catch(() => {});
        nudgePreviewRedraw();
      } catch {
        toast.error(t("tmuxMonitor.windowCreateFailed"));
      }
    },
    [selectedHostId, loadOverview, nudgePreviewRedraw, t, toast],
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
      await renameTmuxSession(Number(selectedHostId), renameTarget, newName);
      if (activeHostRef.current !== selectedHostId) return;
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
      void loadOverview(selectedHostId, true).catch(() => {});
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
      await killTmuxSession(Number(selectedHostId), killTarget);
      if (activeHostRef.current !== selectedHostId) return;
      toast.success(t("tmuxMonitor.sessionKilled", { name: killTarget }));
      if (selectedPane?.sessionName === killTarget) setSelectedPane(null);
      if (expandedSessions.has(killTarget)) {
        const next = new Set(expandedSessions);
        next.delete(killTarget);
        setExpandedSessions(next);
        persistExpanded(selectedHostId, next);
      }
      setKillTarget(null);
      void loadOverview(selectedHostId, true).catch(() => {});
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
        Number(selectedHostId),
        killWindowTarget.sessionName,
        killWindowTarget.windowIndex,
      );
      if (activeHostRef.current !== selectedHostId) return;
      const wasViewing =
        selectedPane?.sessionName === killWindowTarget.sessionName &&
        selectedPane?.windowIndex === killWindowTarget.windowIndex;
      setKillWindowTarget(null);
      const data = await getTmuxOverview(Number(selectedHostId));
      if (activeHostRef.current !== selectedHostId) return;
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
      await killTmuxPane(Number(selectedHostId), killPaneTarget);
      if (activeHostRef.current !== selectedHostId) return;
      const viewedSession =
        selectedPane?.paneId === killPaneTarget
          ? selectedPane.sessionName
          : null;
      setKillPaneTarget(null);
      const data = await getTmuxOverview(Number(selectedHostId));
      if (activeHostRef.current !== selectedHostId) return;
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
      await setTmuxSessionTags(Number(selectedHostId), tagsTarget, tags);
      if (activeHostRef.current !== selectedHostId) return;
      toast.success(t("tmuxMonitor.tagsSaved"));
      setTagsTarget(null);
      void loadOverview(selectedHostId, true).catch(() => {});
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

  const selectedHost: PluginHostRecord | undefined = hosts.find(
    (h) => String(h.id) === String(selectedHostId),
  );
  const hostLabel = selectedHost
    ? selectedHost.name ||
      `${selectedHost.username as string}@${selectedHost.ip}`
    : "";
  const selectedPaneMetrics = selectedPane
    ? metricsByPane.get(selectedPane.paneId)
    : undefined;

  function executeTreeAction(action: TreeAction) {
    if (
      action.type === "pane" &&
      !overview?.sessions.some(
        (session) =>
          session.name === action.pane.sessionName &&
          session.windows.some(
            (win) =>
              win.index === action.pane.windowIndex &&
              win.panes.some((pane) => pane.id === action.pane.paneId),
          ),
      )
    )
      return;
    switch (action.type) {
      case "pane":
        selectPane(action.pane);
        break;
      case "attach":
        attachInline(action.session);
        break;
      case "tags":
        openTagsEditor(action.session);
        break;
      case "rename":
        setRenameDraft(action.session);
        setRenameTarget(action.session);
        break;
      case "killSession":
        setKillTarget(action.session);
        break;
      case "newWindow":
        void newWindow(action.session);
        break;
      case "killPane":
        setKillPaneTarget(action.paneId);
        break;
      case "split":
        void splitPane(action.paneId, action.direction);
        break;
      case "killWindow":
        setKillWindowTarget({
          sessionName: action.session,
          windowIndex: action.index,
        });
        break;
    }
  }
  function dispatchTreeAction(hostId: string | number, action: TreeAction) {
    if (hostId === selectedHostId && overviewHostId === hostId)
      executeTreeAction(action);
    else {
      setPendingAction({ hostId, action });
      setSelectedHostId(hostId);
    }
  }
  const executeTreeActionRef = useRef(executeTreeAction);
  executeTreeActionRef.current = executeTreeAction;
  useEffect(() => {
    if (
      !pendingAction ||
      pendingAction.hostId !== selectedHostId ||
      overviewHostId !== selectedHostId
    )
      return;
    setPendingAction(null);
    executeTreeActionRef.current(pendingAction.action);
  }, [pendingAction, selectedHostId, overviewHostId]);
  useEffect(() => {
    setPendingAction((pending) =>
      pending?.hostId === selectedHostId ? pending : null,
    );
    setRenameTarget(null);
    setKillTarget(null);
    setTagsTarget(null);
    setKillPaneTarget(null);
    setKillWindowTarget(null);
    setNewSessionOpen(false);
  }, [selectedHostId]);

  useEffect(() => {
    if (selectedHostId !== null && overviewHostId === selectedHostId)
      saveMonitorValue(`pane-${selectedHostId}`, selectedPane);
  }, [selectedHostId, overviewHostId, selectedPane]);

  const filteredHosts =
    scope === "single"
      ? hosts.filter((h) => h.id === selectedHostId)
      : hosts.filter((h) =>
          `${h.name ?? ""} ${h.ip ?? ""}`
            .toLowerCase()
            .includes(hostFilter.toLowerCase().trim()),
        );

  function backgroundTree(
    hostId: string | number,
    data: TmuxOverview,
    values: TmuxPaneMetrics[],
  ) {
    const expanded =
      expandedByHost[String(hostId)] ??
      readExpanded(hostId) ??
      new Set(data.sessions.map((session) => session.name));
    const byPane = new Map(values.map((m) => [m.paneId, m]));
    const bySession = new Map<string, SessionMetricsAgg>();
    for (const m of values) {
      const agg = bySession.get(m.sessionName) ?? {
        cpu: 0,
        memKb: 0,
        gpuMb: 0,
      };
      agg.cpu += m.cpuPercent;
      agg.memKb += m.memRssKb;
      agg.gpuMb += m.gpuMemMb;
      bySession.set(m.sessionName, agg);
    }
    const run = (action: TreeAction) => dispatchTreeAction(hostId, action);
    return (
      <SessionTree
        sessions={data.sessions}
        expandedSessions={expanded}
        onToggleSession={(name) => {
          const next = new Set(expanded);
          if (next.has(name)) next.delete(name);
          else next.add(name);
          persistExpanded(hostId, next);
        }}
        selectedPaneId={null}
        onSelectPane={(pane) => run({ type: "pane", pane })}
        metricsByPane={byPane}
        metricsBySession={bySession}
        onEditTags={(session) => run({ type: "tags", session })}
        onAttachSession={(session) => run({ type: "attach", session })}
        onSelectSession={(session) => run({ type: "attach", session })}
        onNewWindow={(session) => run({ type: "newWindow", session })}
        onRenameSession={(session) => run({ type: "rename", session })}
        onKillSession={(session) => run({ type: "killSession", session })}
        onKillPane={(paneId) => run({ type: "killPane", paneId })}
        onSplitPane={(paneId, direction) =>
          run({ type: "split", paneId, direction })
        }
        onKillWindow={(session, index) =>
          run({ type: "killWindow", session, index })
        }
        compact={treeWidth < 280}
        now={now}
      />
    );
  }

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
        <div className="space-y-2 border-b border-border p-2">
          <select
            className="h-8 w-full border border-border bg-background px-2 text-sm"
            aria-label={t("tmuxMonitor.hostScope")}
            value={scope}
            onChange={(e) => {
              const value = e.target.value === "single" ? "single" : "all";
              setScope(value);
              saveMonitorValue("scope", value);
            }}
          >
            <option value="all">{t("tmuxMonitor.allHosts")}</option>
            <option value="single">{t("tmuxMonitor.singleHost")}</option>
          </select>
          {scope === "all" ? (
            <Input
              aria-label={t("tmuxMonitor.filterHosts")}
              placeholder={t("tmuxMonitor.filterHosts")}
              value={hostFilter}
              onChange={(e) => {
                setHostFilter(e.target.value);
                saveMonitorValue("filter", e.target.value);
              }}
              className="h-8"
            />
          ) : (
            <select
              className="h-8 w-full border border-border bg-background px-2 text-sm"
              aria-label={t("tmuxMonitor.selectHost")}
              value={selectedHostId ?? ""}
              onChange={(e) => {
                setPendingAction(null);
                setSelectedHostId(
                  hosts.find((h) => String(h.id) === e.target.value)?.id ??
                    null,
                );
              }}
            >
              {hosts.map((host) => (
                <option key={host.id} value={host.id}>
                  {host.name || host.ip}
                </option>
              ))}
            </select>
          )}
        </div>
        {/* Radix wraps the viewport content in a display:table div sized to
            the widest row, so one long pane path would stretch every row and
            clip the right-aligned actions; force block so rows shrink and
            truncate instead. */}
        <ScrollArea className="flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
          <div className="p-2">
            {hostsLoaded && hosts.length === 0 && (
              <div className="px-2 py-4">
                <p className="text-sm text-muted-foreground">
                  {t("tmuxMonitor.noHosts")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  {t("tmuxMonitor.noHostsHint")}
                </p>
              </div>
            )}
            {filteredHosts.map((host) => {
              const active = host.id === selectedHostId;
              const collapsed =
                scope === "all" && collapsedHosts.has(String(host.id));
              return (
                <section
                  key={host.id}
                  aria-label={host.name || String(host.ip)}
                >
                  <div
                    className={`flex items-center gap-1 px-1 py-2 ${active ? "bg-accent-brand/10" : ""}`}
                  >
                    {scope === "all" && (
                      <button
                        aria-label={t("tmuxMonitor.toggleHost", {
                          host: host.name || host.ip,
                        })}
                        aria-expanded={!collapsed}
                        onClick={() => {
                          const next = new Set(collapsedHosts);
                          if (collapsed) next.delete(String(host.id));
                          else next.add(String(host.id));
                          setCollapsedHosts(next);
                          saveMonitorValue("collapsed-hosts", [...next]);
                        }}
                      >
                        {collapsed ? (
                          <ChevronRight className="size-4" />
                        ) : (
                          <ChevronDown className="size-4" />
                        )}
                      </button>
                    )}
                    <button
                      className="min-w-0 flex-1 truncate text-left text-sm font-medium"
                      aria-pressed={active}
                      onClick={() => {
                        setPendingAction(null);
                        setSelectedHostId(host.id);
                      }}
                    >
                      {host.name || host.ip}
                    </button>
                  </div>
                  {!collapsed &&
                    (active ? (
                      <>
                        {overviewLoading && (
                          <div className="space-y-3 px-2 py-2">
                            {[0, 1, 2].map((i) => (
                              <div key={i} className="space-y-1.5">
                                <Skeleton className="h-5 w-full" />
                                <Skeleton className="ml-6 h-3.5 w-3/4" />
                                <Skeleton className="ml-6 h-3.5 w-2/3" />
                              </div>
                            ))}
                          </div>
                        )}
                        {overviewError && (
                          <div className="space-y-2 px-2 py-4">
                            <p className="text-sm text-destructive">
                              {overviewError}
                            </p>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() =>
                                selectedHostId !== null &&
                                loadOverview(selectedHostId)
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
                              <code className="font-mono">
                                sudo apt install tmux
                              </code>
                            </p>
                          </div>
                        )}
                        {overview?.available &&
                          overview.sessions.length === 0 && (
                            <p className="px-2 py-4 text-sm text-muted-foreground">
                              {t("tmuxMonitor.noSessions")}
                            </p>
                          )}
                        {overview?.available &&
                          overviewHostId === selectedHostId && (
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
                              onSelectSession={attachInline}
                              onNewWindow={newWindow}
                              onRenameSession={(name) => {
                                setRenameDraft(name);
                                setRenameTarget(name);
                              }}
                              onKillSession={setKillTarget}
                              onKillPane={setKillPaneTarget}
                              onSplitPane={splitPane}
                              onKillWindow={(sessionName, windowIndex) =>
                                setKillWindowTarget({
                                  sessionName,
                                  windowIndex,
                                })
                              }
                              compact={treeWidth < 280}
                              now={now}
                            />
                          )}
                      </>
                    ) : (
                      isVisible &&
                      selectedHostId !== null && (
                        <HostOverview hostId={Number(host.id)}>
                          {(data, values) =>
                            backgroundTree(host.id, data, values)
                          }
                        </HostOverview>
                      )
                    ))}
                </section>
              );
            })}
            {hosts.length > 0 && filteredHosts.length === 0 && (
              <p className="p-2 text-xs text-muted-foreground">
                {t("tmuxMonitor.noMatchingHosts")}
              </p>
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
          {selectedPane && selectedHost && overviewHostId === selectedHostId ? (
            <PanePreview
              key={`${selectedHost.id}:${selectedPane.sessionName}`}
              host={selectedHost}
              pane={selectedPane}
              metrics={selectedPaneMetrics}
              terminalRef={previewTermRef}
              onSplit={(direction) => splitPane(selectedPane.paneId, direction)}
              onKillPane={() => setKillPaneTarget(selectedPane.paneId)}
              onClose={() => {
                setSelectedPane(null);
                saveMonitorValue(`pane-${selectedHostId}`, null);
              }}
            />
          ) : hostsLoaded && hosts.length === 0 ? (
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
