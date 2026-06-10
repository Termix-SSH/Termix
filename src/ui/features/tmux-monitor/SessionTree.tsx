import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  MonitorPlay,
  SquareTerminal,
  Tag,
} from "lucide-react";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { Badge } from "@/components/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/popover";
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

interface SessionTreeProps {
  sessions: TmuxSessionOverview[];
  expandedSessions: Set<string>;
  onToggleSession: (name: string) => void;
  selectedPaneId: string | null;
  onSelectPane: (pane: SelectedPane) => void;
  metricsByPane: Map<string, TmuxPaneMetrics>;
  metricsBySession: Map<string, SessionMetricsAgg>;
  onSaveTags: (sessionName: string, tags: string[]) => void;
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
  onSaveTags,
  now,
}: SessionTreeProps) {
  const { t } = useTranslation();
  const [tagDraft, setTagDraft] = useState("");

  function saveTags(session: TmuxSessionOverview) {
    const tags = tagDraft
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    onSaveTags(session.name, tags);
  }

  return (
    <>
      {sessions.map((session) => {
        const expanded = expandedSessions.has(session.name);
        const agg = metricsBySession.get(session.name);
        return (
          <div key={session.name} className="mb-1">
            <div
              className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 hover:bg-muted/40"
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
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {formatRelativeTime(session.lastActivity, now, t)}
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
                    const isSelected = selectedPaneId === pane.id;
                    return (
                      <div
                        key={pane.id}
                        className={`ml-4 flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-muted/40 ${isSelected ? "bg-accent-brand/10" : ""}`}
                        onClick={() =>
                          onSelectPane({
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
    </>
  );
}
