import { useState, useEffect } from "react";
import { Copy, Search, Terminal, Trash2 } from "lucide-react";
import { copyToClipboard, Button, Input } from "@termix/plugin-sdk/ui";
import {
  usePluginApi,
  useTranslation,
  type PanelProps,
} from "@termix/plugin-sdk/frontend";
import {
  clearCommandHistory,
  deleteCommandFromHistory,
  getCommandHistory,
  hostSetting,
} from "../terminal-api";

/** Command history for the terminal the user is working in. */
export function HistoryPanel({ targetTab }: PanelProps) {
  const { t } = useTranslation();
  const api = usePluginApi();
  const [search, setSearch] = useState("");
  const [commands, setCommands] = useState<string[]>([]);

  const activeTab = targetTab;
  const activeIsTerminal = !!activeTab;
  const hostId = activeTab?.host?.id ? parseInt(activeTab.host.id, 10) : null;
  const trackingEnabled = hostSetting(
    activeTab?.host,
    "enableCommandHistory",
    true,
  );

  useEffect(() => {
    if (!hostId || !trackingEnabled) {
      setCommands([]);
      return;
    }
    getCommandHistory(api, hostId)
      .then(setCommands)
      .catch(() => setCommands([]));
  }, [api, hostId, trackingEnabled]);

  if (activeIsTerminal && !trackingEnabled) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-3 p-6 text-center">
        <div className="size-10 rounded-full bg-muted/40 flex items-center justify-center">
          <Terminal className="size-5 text-muted-foreground/30" />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-muted-foreground/60">
            {t("history.trackingDisabled")}
          </span>
          <span className="text-xs text-muted-foreground/40">
            {t("history.trackingDisabledHint")}
          </span>
        </div>
      </div>
    );
  }

  if (!activeIsTerminal) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-3 p-6 text-center">
        <div className="size-10 rounded-full bg-muted/40 flex items-center justify-center">
          <Terminal className="size-5 text-muted-foreground/30" />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-muted-foreground/60">
            {t("history.noTerminalSelected")}
          </span>
          <span className="text-xs text-muted-foreground/40">
            {t("history.noTerminalSelectedHint")}
          </span>
        </div>
      </div>
    );
  }

  const filtered = search
    ? commands.filter((c) => c.toLowerCase().includes(search.toLowerCase()))
    : commands;

  async function handleDelete(cmd: string) {
    if (!hostId) return;
    try {
      await deleteCommandFromHistory(api, hostId, cmd);
      setCommands((prev) => prev.filter((c) => c !== cmd));
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-muted/30 border border-border/60">
        <Terminal className="size-3 shrink-0 text-accent-brand" />
        <span className="text-xs font-medium truncate text-foreground">
          {activeTab.label}
        </span>
      </div>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
        <Input
          placeholder={t("history.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {t("history.commandCount", { count: filtered.length })}
        </span>
        <button
          onClick={async () => {
            if (!hostId) return;
            try {
              await clearCommandHistory(api, hostId);
            } catch {
              /* ignore */
            }
            setCommands([]);
          }}
          className="text-xs text-accent-brand hover:text-accent-brand/70"
        >
          {t("history.clearAll")}
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {filtered.length === 0 && (
          <span className="text-xs text-muted-foreground/60 text-center py-8">
            {t("history.noHistoryEntries")}
          </span>
        )}
        {filtered.map((cmd, i) => (
          <div
            key={i}
            className="group flex flex-col gap-1 px-2.5 py-2 border border-border bg-background hover:border-muted-foreground/30 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-mono text-foreground break-all leading-relaxed">
                {cmd}
              </span>
              <div className="flex items-center gap-0.5 shrink-0 md:opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-muted-foreground hover:text-foreground"
                  onClick={() => copyToClipboard(cmd)}
                >
                  <Copy className="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(cmd)}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
