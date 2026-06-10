// Read-only xterm.js preview of a tmux pane. Initial content comes from the
// REST capture endpoint (with ANSI escapes), then live updates stream over
// the tmux-monitor WebSocket. If the live stream is unavailable the component
// falls back to the original 2s REST polling.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Activity, Cpu, MemoryStick, X } from "lucide-react";
import {
  getTmuxPaneCapture,
  type TmuxPaneMetrics,
} from "@/api/tmux-monitor-api";
import { useTmuxLive } from "./useTmuxLive";
import { formatMem } from "./format";
import type { SelectedPane } from "./types";

const CAPTURE_POLL_MS = 2_000;

const TERMINAL_FONT_FAMILY =
  '"JetBrains Mono", "SF Mono", Consolas, "Liberation Mono", monospace';

interface PanePreviewProps {
  hostId: number;
  pane: SelectedPane;
  metrics?: TmuxPaneMetrics;
  onClose: () => void;
  onStructureChanged: () => void;
}

export function PanePreview({
  hostId,
  pane,
  metrics,
  onClose,
  onStructureChanged,
}: PanePreviewProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const onStructureChangedRef = useRef(onStructureChanged);
  onStructureChangedRef.current = onStructureChanged;

  const { status, subscribe, unsubscribe } = useTmuxLive();
  // True once the live stream failed for the current pane; switches the
  // preview to the REST polling fallback.
  const [fallback, setFallback] = useState(false);

  // Create the terminal once. It is strictly read-only: stdin is disabled and
  // no onData handler is wired.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      disableStdin: true,
      cursorBlink: false,
      convertEol: true,
      fontSize: 12,
      fontFamily: TERMINAL_FONT_FAMILY,
      scrollback: 5000,
      theme: {
        background: "#09090b",
        foreground: "#d4d4d8",
        cursor: "#09090b",
        cursorAccent: "#09090b",
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    try {
      fitAddon.fit();
    } catch {
      // container may not be measurable yet
    }

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // ignore fit errors during teardown
      }
    });
    resizeObserver.observe(container);

    termRef.current = term;
    return () => {
      resizeObserver.disconnect();
      termRef.current = null;
      term.dispose();
    };
  }, []);

  // Pane selection flow: reset terminal, fetch initial ANSI capture once,
  // then subscribe to the live stream.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    let cancelled = false;

    term.reset();
    setFallback(false);

    getTmuxPaneCapture(hostId, pane.paneId, 0, true)
      .then((content) => {
        if (cancelled) return;
        const current = termRef.current;
        if (current && content) {
          current.write(content, () => current.scrollToBottom());
        }
      })
      .catch(() => {
        // Initial capture is best-effort; the live stream (or the polling
        // fallback) still provides content.
      })
      .finally(() => {
        if (cancelled) return;
        subscribe(hostId, pane.sessionName, pane.paneId, {
          onData: (data) => termRef.current?.write(data),
          onStructureChanged: () => onStructureChangedRef.current(),
          onDetached: () => setFallback(true),
        });
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [hostId, pane.paneId, pane.sessionName, subscribe, unsubscribe]);

  // FALLBACK: original 2s REST polling, used only when the live WebSocket is
  // unavailable (detached pane, auth/connection failure, exhausted retries).
  useEffect(() => {
    if (!fallback) return;
    let cancelled = false;

    const load = () => {
      if (document.hidden) return;
      getTmuxPaneCapture(hostId, pane.paneId, 0, true)
        .then((content) => {
          if (cancelled) return;
          const term = termRef.current;
          if (!term) return;
          term.reset();
          term.write(content, () => term.scrollToBottom());
        })
        .catch(() => {});
    };

    load();
    const interval = setInterval(load, CAPTURE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [fallback, hostId, pane.paneId]);

  const live = !fallback && status === "live";

  return (
    <>
      <div className="flex items-center gap-3 border-b border-dark-border px-3 py-1.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          {pane.sessionName} · {pane.paneId}
        </span>
        <span
          className="flex items-center gap-1 rounded-full border border-dark-border px-1.5 py-0.5 text-[10px]"
          title={
            live
              ? t("tmuxMonitor.liveTooltip")
              : t("tmuxMonitor.pollingTooltip")
          }
        >
          <span
            className={`size-1.5 rounded-full ${live ? "bg-green-500" : "bg-gray-500"}`}
          />
          {live
            ? t("tmuxMonitor.live")
            : fallback
              ? t("tmuxMonitor.polling")
              : t("tmuxMonitor.connecting")}
        </span>
        {metrics && (
          <>
            <span className="flex items-center gap-1">
              <Cpu className="size-3" />
              {metrics.cpuPercent.toFixed(1)}%
            </span>
            <span className="flex items-center gap-1">
              <MemoryStick className="size-3" />
              {formatMem(metrics.memRssKb)}
            </span>
            {metrics.gpuMemMb > 0 && (
              <span className="flex items-center gap-1">
                <Activity className="size-3" />
                {metrics.gpuMemMb} MB GPU
              </span>
            )}
            {metrics.topCommand && (
              <span className="truncate">
                {metrics.topCommand} ({metrics.processCount})
              </span>
            )}
          </>
        )}
        <button
          className="ml-auto text-muted-foreground hover:text-foreground"
          title={t("tmuxMonitor.closePreview")}
          onClick={onClose}
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-hidden p-2"
        style={{ backgroundColor: "#09090b" }}
      />
    </>
  );
}
