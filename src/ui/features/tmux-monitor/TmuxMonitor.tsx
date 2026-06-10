import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Cpu,
  Layers,
  MemoryStick,
  MonitorPlay,
  RefreshCw,
  Search,
  Server,
  SquareTerminal,
  Tag,
  X,
} from "lucide-react";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { Badge } from "@/components/badge";
import { ScrollArea } from "@/components/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/popover";
import { getSSHHosts } from "@/main-axios";
import type { SSHHost } from "@/types/index";
import {
  getTmuxOverview,
  getTmuxPaneCapture,
  getTmuxMetrics,
  searchTmux,
  setTmuxSessionTags,
  type TmuxOverview,
  type TmuxPaneMetrics,
  type TmuxSearchMatch,
  type TmuxSessionOverview,
} from "@/api/tmux-monitor-api";

const OVERVIEW_POLL_MS = 10_000;
const CAPTURE_POLL_MS = 2_000;
const METRICS_POLL_MS = 10_000;

function formatRelativeTime(
  unixSeconds: number,
  t: (k: string, o?: object) => string,
): string {
  if (!unixSeconds) return "";
  const diff = Math.max(0, Date.now() / 1000 - unixSeconds);
  if (diff < 60) return t("tmuxMonitor.timeJustNow");
  if (diff < 3600)
    return t("tmuxMonitor.timeMinutes", { count: Math.floor(diff / 60) });
  if (diff < 86400)
    return t("tmuxMonitor.timeHours", { count: Math.floor(diff / 3600) });
  return t("tmuxMonitor.timeDays", { count: Math.floor(diff / 86400) });
}

function formatMem(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(0)} MB`;
  return `${kb} KB`;
}

interface SelectedPane {
  paneId: string;
  sessionName: string;
  windowIndex: number;
}

export function TmuxMonitor() {
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
  const [capture, setCapture] = useState("");
  const [metrics, setMetrics] = useState<TmuxPaneMetrics[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<TmuxSearchMatch[] | null>(
    null,
  );
  const [searching, setSearching] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const captureRef = useRef<HTMLPreElement>(null);

  // -- hosts ----------------------------------------------------------------
  useEffect(() => {
    getSSHHosts()
      .then((all: SSHHost[]) => {
        const sshHosts = all.filter(
          (h) =>
            (h.connectionType ?? "ssh") === "ssh" && h.enableTerminal !== false,
        );
        setHosts(sshHosts);
        if (sshHosts.length > 0) setSelectedHostId(sshHosts[0].id);
      })
      .catch(() => toast.error(t("tmuxMonitor.failedToLoadHosts")))
      .finally(() => setHostsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          if (prev.size > 0) return prev;
          return new Set(data.sessions.map((s) => s.name));
        });
      } catch (err) {
        if (!silent) {
          setOverview(null);
          setOverviewError(
            err instanceof Error ? err.message : t("tmuxMonitor.failedToLoad"),
          );
        }
      } finally {
        if (!silent) setOverviewLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (selectedHostId === null) return;
    setOverview(null);
    setSelectedPane(null);
    setSearchResults(null);
    setExpandedSessions(new Set());
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

  // -- pane capture polling -------------------------------------------------
  useEffect(() => {
    if (selectedHostId === null || !selectedPane) return;
    let cancelled = false;
    const load = () => {
      if (document.hidden) return;
      getTmuxPaneCapture(selectedHostId, selectedPane.paneId)
        .then((content) => {
          if (cancelled) return;
          setCapture(content);
          requestAnimationFrame(() => {
            const el = captureRef.current;
            if (el) el.scrollTop = el.scrollHeight;
          });
        })
        .catch(() => {});
    };
    setCapture("");
    load();
    const interval = setInterval(load, CAPTURE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedHostId, selectedPane]);

  // -- search ---------------------------------------------------------------
  async function runSearch() {
    if (selectedHostId === null || !searchQuery.trim()) return;
    setSearching(true);
    try {
      setSearchResults(await searchTmux(selectedHostId, searchQuery.trim()));
    } catch {
      toast.error(t("tmuxMonitor.searchFailed"));
    } finally {
      setSearching(false);
    }
  }

  // -- tags -----------------------------------------------------------------
  async function saveTags(session: TmuxSessionOverview) {
    if (selectedHostId === null) return;
    const tags = tagDraft
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await setTmuxSessionTags(selectedHostId, session.name, tags);
      toast.success(t("tmuxMonitor.tagsSaved"));
      loadOverview(selectedHostId, true);
    } catch {
      toast.error(t("tmuxMonitor.tagsSaveFailed"));
    }
  }

  function openTerminal() {
    if (selectedHostId === null) return;
    window.open(
      `${window.location.pathname}?view=terminal&hostId=${selectedHostId}`,
      "_blank",
    );
  }

  const metricsByPane = useMemo(() => {
    const map = new Map<string, TmuxPaneMetrics>();
    for (const m of metrics) map.set(m.paneId, m);
    return map;
  }, [metrics]);

  const metricsBySession = useMemo(() => {
    const map = new Map<
      string,
      { cpu: number; memKb: number; gpuMb: number }
    >();
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
  const selectedPaneMetrics = selectedPane
    ? metricsByPane.get(selectedPane.paneId)
    : undefined;

  function toggleSession(name: string) {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <div className="flex h-full w-full bg-dark-bg text-foreground">
      {/* Left rail: hosts + session tree */}
      <div className="flex w-72 shrink-0 flex-col border-r border-dark-border bg-dark-bg-darker">
        <div className="flex items-center gap-2 border-b border-dark-border px-3 py-2">
          <Layers className="size-4" />
          <span className="text-sm font-semibold">
            {t("tmuxMonitor.title")}
          </span>
        </div>
        <div className="border-b border-dark-border p-2">
          <select
            className="w-full rounded-md border border-dark-border bg-dark-bg-input px-2 py-1.5 text-sm"
            value={selectedHostId ?? ""}
            disabled={hostsLoading}
            onChange={(e) => setSelectedHostId(Number(e.target.value))}
          >
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name || `${h.username}@${h.ip}`}
              </option>
            ))}
          </select>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2">
            {overviewLoading && (
              <p className="px-2 py-4 text-sm text-muted-foreground">
                {t("common.loading")}
              </p>
            )}
            {overviewError && (
              <p className="px-2 py-4 text-sm text-red-500">{overviewError}</p>
            )}
            {overview && !overview.available && (
              <p className="px-2 py-4 text-sm text-muted-foreground">
                {t("tmuxMonitor.tmuxUnavailable")}
              </p>
            )}
            {overview?.available && overview.sessions.length === 0 && (
              <p className="px-2 py-4 text-sm text-muted-foreground">
                {t("tmuxMonitor.noSessions")}
              </p>
            )}
            {overview?.available &&
              overview.sessions.map((session) => {
                const expanded = expandedSessions.has(session.name);
                const agg = metricsBySession.get(session.name);
                return (
                  <div key={session.name} className="mb-1">
                    <div
                      className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 hover:bg-dark-hover"
                      onClick={() => toggleSession(session.name)}
                    >
                      {expanded ? (
                        <ChevronDown className="size-3.5 shrink-0" />
                      ) : (
                        <ChevronRight className="size-3.5 shrink-0" />
                      )}
                      <span
                        className={`size-2 shrink-0 rounded-full ${session.attachedClients > 0 ? "bg-green-500" : "bg-gray-500"}`}
                        title={
                          session.attachedClients > 0
                            ? t("tmuxMonitor.attached")
                            : t("tmuxMonitor.detached")
                        }
                      />
                      <span className="truncate text-sm font-medium">
                        {session.name}
                      </span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {formatRelativeTime(session.lastActivity, t)}
                      </span>
                    </div>

                    <div className="ml-6 flex flex-wrap items-center gap-1 pb-1">
                      {session.tags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="secondary"
                          className="h-4 px-1.5 text-[10px]"
                        >
                          {tag}
                        </Badge>
                      ))}
                      <Popover
                        onOpenChange={(open) => {
                          if (open) setTagDraft(session.tags.join(", "));
                        }}
                      >
                        <PopoverTrigger asChild>
                          <button
                            className="text-muted-foreground hover:text-foreground"
                            title={t("tmuxMonitor.editTags")}
                          >
                            <Tag className="size-3" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 p-2" align="start">
                          <p className="mb-1 text-xs text-muted-foreground">
                            {t("tmuxMonitor.tagsHint")}
                          </p>
                          <div className="flex gap-1">
                            <Input
                              className="h-7 text-xs"
                              value={tagDraft}
                              placeholder="YOLO, lab, training"
                              onChange={(e) => setTagDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveTags(session);
                              }}
                            />
                            <Button
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => saveTags(session)}
                            >
                              {t("common.save")}
                            </Button>
                          </div>
                        </PopoverContent>
                      </Popover>
                      {agg && (
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          {agg.cpu.toFixed(0)}% · {formatMem(agg.memKb)}
                          {agg.gpuMb > 0 ? ` · ${agg.gpuMb} MB GPU` : ""}
                        </span>
                      )}
                    </div>

                    {expanded &&
                      session.windows.map((win) => (
                        <div key={win.index} className="ml-5">
                          <div className="flex items-center gap-1 px-2 py-0.5 text-xs text-muted-foreground">
                            <SquareTerminal className="size-3 shrink-0" />
                            <span className="truncate">
                              {win.index}: {win.name}
                            </span>
                          </div>
                          {win.panes.map((pane) => {
                            const m = metricsByPane.get(pane.id);
                            const isSelected = selectedPane?.paneId === pane.id;
                            return (
                              <div
                                key={pane.id}
                                className={`ml-4 flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-dark-hover ${isSelected ? "bg-dark-active" : ""}`}
                                onClick={() =>
                                  setSelectedPane({
                                    paneId: pane.id,
                                    sessionName: session.name,
                                    windowIndex: win.index,
                                  })
                                }
                              >
                                <MonitorPlay className="size-3 shrink-0" />
                                <span className="truncate">
                                  {pane.id} · {pane.command}
                                </span>
                                {m && m.cpuPercent > 0 && (
                                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                                    {m.cpuPercent.toFixed(0)}%
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                  </div>
                );
              })}
          </div>
        </ScrollArea>
      </div>

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b border-dark-border px-3 py-2">
          <Server className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm">
            {selectedHost
              ? selectedHost.name ||
                `${selectedHost.username}@${selectedHost.ip}`
              : t("tmuxMonitor.noHostSelected")}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
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
              onClick={openTerminal}
            >
              <SquareTerminal className="mr-1 size-3.5" />
              {t("tmuxMonitor.attach")}
            </Button>
          </div>
        </div>

        {/* Search results */}
        {searchResults !== null && (
          <div className="max-h-56 overflow-y-auto border-b border-dark-border bg-dark-bg-darker">
            <div className="flex items-center justify-between px-3 py-1.5">
              <span className="text-xs text-muted-foreground">
                {searching
                  ? t("common.loading")
                  : t("tmuxMonitor.searchResults", {
                      count: searchResults.length,
                    })}
              </span>
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setSearchResults(null)}
              >
                <X className="size-3.5" />
              </button>
            </div>
            {searchResults.map((match, i) => (
              <div
                key={`${match.paneId}-${match.line}-${i}`}
                className="flex cursor-pointer items-baseline gap-2 px-3 py-1 text-xs hover:bg-dark-hover"
                onClick={() =>
                  setSelectedPane({
                    paneId: match.paneId,
                    sessionName: match.sessionName,
                    windowIndex: match.windowIndex,
                  })
                }
              >
                <span className="shrink-0 font-medium text-primary">
                  {match.sessionName} · {match.paneId}
                </span>
                <span className="truncate font-mono text-muted-foreground">
                  {match.text}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Pane preview */}
        <div className="flex min-h-0 flex-1 flex-col">
          {selectedPane ? (
            <>
              <div className="flex items-center gap-3 border-b border-dark-border px-3 py-1.5 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {selectedPane.sessionName} · {selectedPane.paneId}
                </span>
                {selectedPaneMetrics && (
                  <>
                    <span className="flex items-center gap-1">
                      <Cpu className="size-3" />
                      {selectedPaneMetrics.cpuPercent.toFixed(1)}%
                    </span>
                    <span className="flex items-center gap-1">
                      <MemoryStick className="size-3" />
                      {formatMem(selectedPaneMetrics.memRssKb)}
                    </span>
                    {selectedPaneMetrics.gpuMemMb > 0 && (
                      <span className="flex items-center gap-1">
                        <Activity className="size-3" />
                        {selectedPaneMetrics.gpuMemMb} MB GPU
                      </span>
                    )}
                    {selectedPaneMetrics.topCommand && (
                      <span className="truncate">
                        {selectedPaneMetrics.topCommand} (
                        {selectedPaneMetrics.processCount})
                      </span>
                    )}
                  </>
                )}
                <button
                  className="ml-auto text-muted-foreground hover:text-foreground"
                  onClick={() => setSelectedPane(null)}
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <pre
                ref={captureRef}
                className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all bg-dark-bg-darkest p-3 font-mono text-xs leading-snug"
              >
                {capture || t("tmuxMonitor.waitingForOutput")}
              </pre>
            </>
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
