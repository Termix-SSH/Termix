// Interactive view of a tmux pane. Embeds the real SSH terminal (the same
// component as the Terminal feature) and attaches to the selected session via
// the native tmux_attach flow, so the pane is fully usable — typing, mouse
// scrolling and tmux copy-mode all behave exactly like a normal terminal tab.

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Cpu,
  MemoryStick,
  RotateCw,
  SquareSplitHorizontal,
  SquareSplitVertical,
  Trash2,
  X,
} from "lucide-react";
import { CommandHistoryProvider } from "@/features/terminal/command-history/CommandHistoryContext";
import { Terminal } from "@/features/terminal/Terminal";
import type {
  TerminalHandle,
  TerminalHostConfig,
} from "@/features/terminal/Terminal";
import type { SSHHost } from "@/types/index";
import type { TmuxPaneMetrics } from "@/api/tmux-monitor-api";
import { formatMem } from "./format";
import type { SelectedPane } from "./types";

interface PanePreviewProps {
  host: SSHHost;
  pane: SelectedPane;
  metrics?: TmuxPaneMetrics;
  /** Imperative handle of the embedded terminal, used by the parent to nudge
   * a refit/redraw after layout-changing tmux actions. */
  terminalRef?: React.RefObject<TerminalHandle | null>;
  /** Split the window containing this pane ("h" = new pane to the right,
   * "v" = below — tmux -h/-v semantics). */
  onSplit: (direction: "h" | "v") => void;
  /** Ask for confirmation and kill this pane. */
  onKillPane: () => void;
  onClose: () => void;
}

function newInstanceId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function PanePreview({
  host,
  pane,
  metrics,
  terminalRef,
  onSplit,
  onKillPane,
  onClose,
}: PanePreviewProps) {
  const { t } = useTranslation();
  // One PTY per mount; the parent remounts this component (via key) when the
  // host or session changes. Pane switches within a session go through the
  // focus endpoint instead, so the connection is reused.
  const instanceIdRef = useRef<string>(newInstanceId());
  // Bumping this remounts the embedded terminal with a fresh PTY — the rescue
  // hatch when the attached client's rendering gets out of sync.
  const [attachNonce, setAttachNonce] = useState(0);

  function reattach() {
    instanceIdRef.current = newInstanceId();
    setAttachNonce((n) => n + 1);
  }

  return (
    <>
      <div className="flex items-center gap-3 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          {pane.sessionName} · {pane.paneId}
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
        <div className="ml-auto flex items-center gap-2">
          <button
            className="text-muted-foreground hover:text-foreground"
            title={t("tmuxMonitor.splitRight")}
            aria-label={t("tmuxMonitor.splitRight")}
            onClick={() => onSplit("h")}
          >
            <SquareSplitHorizontal className="size-3.5" />
          </button>
          <button
            className="text-muted-foreground hover:text-foreground"
            title={t("tmuxMonitor.splitDown")}
            aria-label={t("tmuxMonitor.splitDown")}
            onClick={() => onSplit("v")}
          >
            <SquareSplitVertical className="size-3.5" />
          </button>
          <button
            className="text-muted-foreground hover:text-destructive"
            title={t("tmuxMonitor.killPane")}
            aria-label={t("tmuxMonitor.killPane")}
            onClick={onKillPane}
          >
            <Trash2 className="size-3.5" />
          </button>
          <div className="h-3.5 border-l border-border" />
          <button
            className="text-muted-foreground hover:text-foreground"
            title={t("tmuxMonitor.reattach")}
            aria-label={t("tmuxMonitor.reattach")}
            onClick={reattach}
          >
            <RotateCw className="size-3.5" />
          </button>
          <button
            className="text-muted-foreground hover:text-foreground"
            title={t("tmuxMonitor.closePreview")}
            aria-label={t("tmuxMonitor.closePreview")}
            onClick={onClose}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <CommandHistoryProvider key={attachNonce}>
          <Terminal
            ref={terminalRef}
            hostConfig={
              {
                ...host,
                sshPort: host.port,
                instanceId: instanceIdRef.current,
              } as TerminalHostConfig
            }
            isVisible={true}
            title={pane.sessionName}
            showTitle={false}
            splitScreen={false}
            tmuxAttachSession={pane.sessionName}
            onClose={onClose}
          />
        </CommandHistoryProvider>
      </div>
    </>
  );
}
