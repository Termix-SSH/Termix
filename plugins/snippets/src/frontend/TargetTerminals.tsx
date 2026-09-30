import { useEffect, useState } from "react";
import { Terminal } from "lucide-react";
import { invokeAction, useTranslation } from "@termix/plugin-sdk/frontend";
import type { RunTarget } from "./use-snippet-runner";

export interface OpenTerminal {
  id: string;
  label?: string;
  hostName?: string;
  ip?: string;
  username?: string;
  port?: number;
}

const POLL_MS = 1500;

/** The open terminal sessions, refreshed while the panel is on screen. */
export function useOpenTerminals(): OpenTerminal[] {
  const [terminals, setTerminals] = useState<OpenTerminal[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void invokeAction("terminal.listSessions")
        .then((result) => {
          if (cancelled) return;
          const next = Array.isArray(result) ? (result as OpenTerminal[]) : [];
          setTerminals((prev) =>
            prev.length === next.length &&
            prev.every(
              (item, i) =>
                item.id === next[i].id && item.label === next[i].label,
            )
              ? prev
              : next,
          );
        })
        .catch(() => {
          if (!cancelled) setTerminals([]);
        });
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  return terminals;
}

export function toRunTargets(
  terminals: OpenTerminal[],
  selected: Set<string>,
): RunTarget[] {
  return terminals
    .filter((terminal) => selected.has(terminal.id))
    .map((terminal) => ({
      sessionId: terminal.id,
      host: {
        name: terminal.hostName,
        ip: terminal.ip,
        username: terminal.username,
        port: terminal.port,
      },
    }));
}

/** Pick terminals to run in; with none picked a snippet runs in the active one. */
export function TargetTerminals({
  terminals,
  selected,
  onChange,
}: {
  terminals: OpenTerminal[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const { t } = useTranslation();
  if (terminals.length < 2) return null;

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("targetTerminals")}{" "}
          <span className="font-normal normal-case tracking-normal text-muted-foreground/60">
            ({t("targetTerminalsHint")})
          </span>
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onChange(new Set(terminals.map((item) => item.id)))}
            className="text-[10px] text-accent-brand hover:text-accent-brand/70"
          >
            {t("selectAll")}
          </button>
          <button
            type="button"
            onClick={() => onChange(new Set())}
            className="text-[10px] text-accent-brand hover:text-accent-brand/70"
          >
            {t("selectNone")}
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-0.5 max-h-32 overflow-y-auto thin-scrollbar">
        {terminals.map((terminal) => {
          const isSelected = selected.has(terminal.id);
          return (
            <button
              type="button"
              key={terminal.id}
              aria-pressed={isSelected}
              onClick={() => toggle(terminal.id)}
              className={`flex items-center gap-2 px-2 py-1 border text-left transition-colors ${
                isSelected
                  ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <span
                className={`size-3 border-2 flex items-center justify-center shrink-0 ${
                  isSelected
                    ? "border-accent-brand bg-accent-brand"
                    : "border-border/60"
                }`}
              >
                {isSelected && <span className="size-1.5 bg-background" />}
              </span>
              <Terminal className="size-3 shrink-0 opacity-60" />
              <span className="text-xs truncate flex-1">
                {terminal.label || terminal.hostName || terminal.id}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
