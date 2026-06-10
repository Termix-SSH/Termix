// Session/window/pane tree styled after the VSCode "tmux manager" view.
// Each session is a single row: status dot, name, inline tag badges, and a
// right-aligned meta label (relative time · cpu · mem) that is overlaid by
// the hover actions (attach, new window, …-menu). The overlay uses a grid
// stack with opacity so rows never shift and the actions stay reachable via
// keyboard focus.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AppWindow,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  SquareSplitHorizontal,
  SquareSplitVertical,
  SquareTerminal,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu";
import type {
  TmuxPaneMetrics,
  TmuxSessionOverview,
} from "@/api/tmux-monitor-api";
import { formatMem, formatRelativeTime } from "./format";
import type { SelectedPane } from "./types";

export interface SessionMetricsAgg {
  cpu: number;
  memKb: number;
  gpuMb: number;
}

const MAX_INLINE_TAGS = 2;

interface SessionTreeProps {
  sessions: TmuxSessionOverview[];
  expandedSessions: Set<string>;
  onToggleSession: (name: string) => void;
  selectedPaneId: string | null;
  onSelectPane: (pane: SelectedPane) => void;
  metricsByPane: Map<string, TmuxPaneMetrics>;
  metricsBySession: Map<string, SessionMetricsAgg>;
  /** Open the tag editor for a session (… menu). */
  onEditTags: (sessionName: string) => void;
  /** Open a terminal attached to the session (the ▷ hover action). */
  onAttachSession: (sessionName: string) => void;
  /** Create a new window in the session (the + hover action). */
  onNewWindow: (sessionName: string) => void;
  /** Open the rename dialog for a session (… menu). */
  onRenameSession: (sessionName: string) => void;
  /** Open the kill confirmation for a session (… menu). */
  onKillSession: (sessionName: string) => void;
  /** Open the kill confirmation for a single pane (hover ✕ on pane rows). */
  onKillPane: (paneId: string) => void;
  /** Split the window containing a pane (hover actions on pane rows). */
  onSplitPane: (paneId: string, direction: "h" | "v") => void;
  /** Timestamp used to render relative times; bumped periodically by the
   * parent so "Xm ago" labels do not go stale. */
  now: number;
}

export function SessionTree({
  sessions,
  expandedSessions,
  onToggleSession,
  selectedPaneId,
  onSelectPane,
  metricsByPane,
  metricsBySession,
  onEditTags,
  onAttachSession,
  onNewWindow,
  onRenameSession,
  onKillSession,
  onKillPane,
  onSplitPane,
  now,
}: SessionTreeProps) {
  const { t } = useTranslation();
  // Collapsed windows, keyed "session windowIndex". Windows default to
  // expanded (panes visible) like the VSCode tmux manager.
  const [collapsedWindows, setCollapsedWindows] = useState<Set<string>>(
    new Set(),
  );

  function windowKey(sessionName: string, windowIndex: number): string {
    return `${sessionName} ${windowIndex}`;
  }

  function toggleWindow(sessionName: string, windowIndex: number) {
    setCollapsedWindows((prev) => {
      const next = new Set(prev);
      const key = windowKey(sessionName, windowIndex);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function metaLabel(session: TmuxSessionOverview): string {
    const time = formatRelativeTime(session.lastActivity, now, t);
    const agg = metricsBySession.get(session.name);
    if (!agg) return time;
    return `${time} · ${agg.cpu.toFixed(0)}% · ${formatMem(agg.memKb)}`;
  }

  return (
    <>
      {sessions.map((session) => {
        const expanded = expandedSessions.has(session.name);
        return (
          <div key={session.name} className="mb-0.5">
            <div
              className="group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 hover:bg-muted/40"
              onClick={() => onToggleSession(session.name)}
            >
              {expanded ? (
                <ChevronDown className="size-3.5 shrink-0" />
              ) : (
                <ChevronRight className="size-3.5 shrink-0" />
              )}
              <span
                className={`size-2 shrink-0 rounded-full ${session.attachedClients > 0 ? "bg-accent-brand" : "bg-muted-foreground/40"}`}
                title={
                  session.attachedClients > 0
                    ? t("tmuxMonitor.attached")
                    : t("tmuxMonitor.detached")
                }
              />
              <span className="truncate text-sm font-medium">
                {session.name}
              </span>
              {session.tags.slice(0, MAX_INLINE_TAGS).map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="h-4 shrink-0 px-1.5 text-[10px]"
                >
                  {tag}
                </Badge>
              ))}
              {session.tags.length > MAX_INLINE_TAGS && (
                <Badge
                  variant="secondary"
                  className="h-4 shrink-0 px-1.5 text-[10px]"
                  title={session.tags.join(", ")}
                >
                  +{session.tags.length - MAX_INLINE_TAGS}
                </Badge>
              )}

              {/* Meta label and hover actions stacked in one grid cell: the
                  label fades out while the actions fade in, so the row never
                  changes size. Buttons stay keyboard-focusable (opacity, not
                  display:none) and focus-within reveals them. */}
              <span className="ml-auto grid shrink-0">
                {/* pointer-events-none + z-10 matter: at opacity-0 the label
                    becomes a stacking context painted above its plain-flow
                    sibling, and would swallow the buttons' clicks. */}
                <span className="pointer-events-none col-start-1 row-start-1 justify-self-end self-center text-xs text-muted-foreground transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
                  {metaLabel(session)}
                </span>
                <span className="pointer-events-none z-10 col-start-1 row-start-1 flex items-center gap-1.5 justify-self-end opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
                  <button
                    className="-m-1 rounded p-1 text-muted-foreground hover:text-foreground"
                    title={t("tmuxMonitor.attachSessionTooltip", {
                      session: session.name,
                    })}
                    aria-label={t("tmuxMonitor.attachSessionTooltip", {
                      session: session.name,
                    })}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAttachSession(session.name);
                    }}
                  >
                    <Play className="size-3.5" />
                  </button>
                  <button
                    className="-m-1 rounded p-1 text-muted-foreground hover:text-foreground"
                    title={t("tmuxMonitor.newWindow")}
                    aria-label={t("tmuxMonitor.newWindow")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onNewWindow(session.name);
                    }}
                  >
                    <Plus className="size-3.5" />
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="-m-1 rounded p-1 text-muted-foreground hover:text-foreground data-[state=open]:text-foreground"
                        title={t("tmuxMonitor.moreActions")}
                        aria-label={t("tmuxMonitor.moreActions")}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="size-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="min-w-36"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <DropdownMenuItem
                        className="whitespace-nowrap"
                        onSelect={() => onRenameSession(session.name)}
                      >
                        <Pencil className="size-3.5" />
                        {t("tmuxMonitor.rename")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="whitespace-nowrap"
                        onSelect={() => onEditTags(session.name)}
                      >
                        <Tag className="size-3.5" />
                        {t("tmuxMonitor.editTags")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        className="whitespace-nowrap"
                        onSelect={() => onKillSession(session.name)}
                      >
                        <Trash2 className="size-3.5" />
                        {t("tmuxMonitor.kill")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </span>
              </span>
            </div>

            {expanded &&
              session.windows.map((win) => {
                const winCollapsed = collapsedWindows.has(
                  windowKey(session.name, win.index),
                );
                return (
                  <div key={win.index} className="ml-4">
                    <div
                      className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/40"
                      onClick={() => toggleWindow(session.name, win.index)}
                    >
                      {winCollapsed ? (
                        <ChevronRight className="size-3 shrink-0" />
                      ) : (
                        <ChevronDown className="size-3 shrink-0" />
                      )}
                      <AppWindow className="size-3 shrink-0" />
                      <span className="truncate">
                        {win.index}: {win.name}
                      </span>
                    </div>
                    {!winCollapsed &&
                      win.panes.map((pane) => {
                        const m = metricsByPane.get(pane.id);
                        const isSelected = selectedPaneId === pane.id;
                        return (
                          <div
                            key={pane.id}
                            className={`group ml-5 flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-muted/40 ${isSelected ? "bg-accent-brand/10" : ""}`}
                            onClick={() =>
                              onSelectPane({
                                paneId: pane.id,
                                sessionName: session.name,
                                windowIndex: win.index,
                              })
                            }
                          >
                            <SquareTerminal className="size-3 shrink-0" />
                            <span className="shrink-0">
                              {pane.index}: {pane.command}
                            </span>
                            <span
                              className="truncate text-muted-foreground/70"
                              title={pane.path}
                            >
                              {pane.path}
                            </span>
                            <span className="ml-auto flex shrink-0 items-center gap-1">
                              {m && m.cpuPercent > 0 && (
                                <span className="text-[10px] text-muted-foreground">
                                  {m.cpuPercent.toFixed(0)}%
                                </span>
                              )}
                              <button
                                className="-m-1 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                                title={t("tmuxMonitor.splitRight")}
                                aria-label={t("tmuxMonitor.splitRight")}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSplitPane(pane.id, "h");
                                }}
                              >
                                <SquareSplitHorizontal className="size-3" />
                              </button>
                              <button
                                className="-m-1 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                                title={t("tmuxMonitor.splitDown")}
                                aria-label={t("tmuxMonitor.splitDown")}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSplitPane(pane.id, "v");
                                }}
                              >
                                <SquareSplitVertical className="size-3" />
                              </button>
                              <button
                                className="-m-1 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                                title={t("tmuxMonitor.killPane")}
                                aria-label={t("tmuxMonitor.killPane")}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onKillPane(pane.id);
                                }}
                              >
                                <X className="size-3" />
                              </button>
                            </span>
                          </div>
                        );
                      })}
                  </div>
                );
              })}
          </div>
        );
      })}
    </>
  );
}
