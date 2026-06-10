import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/select";
import { Skeleton } from "@/components/skeleton";
import { ScrollArea } from "@/components/scroll-area";
import { getSSHHosts } from "@/main-axios";
import type { SSHHost } from "@/types/index";
import {
  getTmuxOverview,
  getTmuxMetrics,
  searchTmux,
  setTmuxSessionTags,
  focusTmuxPane,
  createTmuxSession,
  splitTmuxPane,
  type TmuxOverview,
  type TmuxPaneMetrics,
  type TmuxSearchMatch,
  type TmuxSearchResult,
} from "@/api/tmux-monitor-api";
import { SessionTree, type SessionMetricsAgg } from "./SessionTree";
import { SearchResults } from "./SearchResults";
import { PanePreview } from "./PanePreview";
import type { SelectedPane } from "./types";

const OVERVIEW_POLL_MS = 10_000;
const METRICS_POLL_MS = 10_000;
const TIME_TICK_MS = 30_000;

const LS_PREFIX = "termix-tmux-monitor-";
const LS_LAST_HOST_KEY = `${LS_PREFIX}last-host`;

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

export function TmuxMonitor({ initialHostId }: { initialHostId?: number }) {
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
  // True when the expanded-session set for the current host was restored from
  // localStorage (or touched by the user) and must not be overwritten by the
  // default expand-all behavior.
  const expandedRestoredRef = useRef(false);

  // -- hosts ----------------------------------------------------------------
  useEffect(() => {
    getSSHHosts()
      .then((all: SSHHost[]) => {
        const sshHosts = all.filter(
          (h) =>
            (h.connectionType ?? "ssh") === "ssh" && h.enableTerminal !== false,
        );
        setHosts(sshHosts);
        if (sshHosts.length > 0) {
          let preferred: number | undefined;
          if (
            initialHostId != null &&
            sshHosts.some((h) => h.id === initialHostId)
          ) {
            preferred = initialHostId;
          } else {
            const stored = Number(localStorage.getItem(LS_LAST_HOST_KEY));
            if (
              Number.isFinite(stored) &&
              sshHosts.some((h) => h.id === stored)
            )
              preferred = stored;
          }
          setSelectedHostId(preferred ?? sshHosts[0].id);
        }
      })
      .catch(() => toast.error(t("tmuxMonitor.failedToLoadHosts")))
      .finally(() => setHostsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        setOverview(data);
        setExpandedSessions((prev) => {
          if (expandedRestoredRef.current || prev.size > 0) return prev;
          return new Set(data.sessions.map((s) => s.name));
        });
      } catch (err) {
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
      } finally {
        if (!silent) setOverviewLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (selectedHostId === null) return;
    try {
      localStorage.setItem(LS_LAST_HOST_KEY, String(selectedHostId));
    } catch {
      // localStorage may be unavailable
    }
    setOverview(null);
    setSelectedPane(null);
    setSearchResults(null);
    const storedExpanded = readStoredExpanded(selectedHostId);
    expandedRestoredRef.current = storedExpanded !== null;
    setExpandedSessions(storedExpanded ?? new Set());
    setMetrics([]);
    loadOverview(selectedHostId);
    const interval = setInterval(() => {
      if (!document.hidden) loadOverview(selectedHostId, true);
    }, OVERVIEW_POLL_MS);
    return () => clearInterval(interval);
  }, [selectedHostId, loadOverview]);

  // -- metrics polling ------------------------------------------------------
  useEffect(() => {
    if (selectedHostId === null || !overview?.available) return;
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
  }, [selectedHostId, overview?.available]);

  // -- keyboard shortcuts -----------------------------------------------------
  useEffect(() => {
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
  }, [searchResults, selectedPane]);

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
  // Splits the window containing the selected pane. The embedded terminal is
  // attached to the session, so the new pane appears there immediately; the
  // silent overview reload updates the tree.
  const splitPane = useCallback(
    async (direction: "h" | "v") => {
      if (selectedHostId === null || !selectedPane) return;
      try {
        await splitTmuxPane(selectedHostId, selectedPane.paneId, direction);
        loadOverview(selectedHostId, true);
      } catch {
        toast.error(t("tmuxMonitor.splitFailed"));
      }
    },
    [selectedHostId, selectedPane, loadOverview, t],
  );

  // -- tags -----------------------------------------------------------------
  async function saveTags(sessionName: string, tags: string[]) {
    if (selectedHostId === null) return;
    try {
      await setTmuxSessionTags(selectedHostId, sessionName, tags);
      toast.success(t("tmuxMonitor.tagsSaved"));
      loadOverview(selectedHostId, true);
    } catch {
      toast.error(t("tmuxMonitor.tagsSaveFailed"));
    }
  }

  function openTerminal(sessionName?: string) {
    if (selectedHostId === null) return;
    const params = new URLSearchParams({
      view: "terminal",
      hostId: String(selectedHostId),
    });
    const session = sessionName ?? selectedPane?.sessionName;
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
      {/* Left rail: hosts + session tree */}
      <div className="flex w-72 shrink-0 flex-col border-r border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Layers className="size-4" />
          <span className="text-sm font-semibold">
            {t("tmuxMonitor.title")}
          </span>
        </div>
        <div className="flex items-center gap-1 border-b border-border p-2">
          <Select
            value={selectedHostId !== null ? String(selectedHostId) : ""}
            disabled={hostsLoading}
            onValueChange={(value) => setSelectedHostId(Number(value))}
          >
            <SelectTrigger className="min-w-0 flex-1">
              <SelectValue placeholder={t("tmuxMonitor.noHostSelected")} />
            </SelectTrigger>
            <SelectContent>
              {hosts.map((h) => (
                <SelectItem key={h.id} value={String(h.id)}>
                  {h.name || `${h.username}@${h.ip}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Popover
            open={newSessionOpen}
            onOpenChange={(open) => {
              setNewSessionOpen(open);
              if (open) setNewSessionName("");
            }}
          >
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-9 w-9 shrink-0 p-0"
                disabled={selectedHostId === null}
                title={t("tmuxMonitor.newSession")}
              >
                <Plus className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-2" align="start">
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
        </div>

        <ScrollArea className="flex-1">
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
                onSaveTags={saveTags}
                now={now}
              />
            )}
          </div>
        </ScrollArea>
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
              onClick={() =>
                selectedHostId !== null && loadOverview(selectedHostId)
              }
            >
              <RefreshCw className="size-3.5" />
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
              onSplit={splitPane}
              onClose={() => setSelectedPane(null)}
            />
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
    </div>
  );
}

export default TmuxMonitor;
