import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { Copy, Search, Terminal, Trash2 } from "lucide-react";
import {
  getCommandHistory,
  deleteCommandFromHistory,
  clearCommandHistory,
} from "@/main-axios";
import type { Tab } from "@/types/ui-types";

export function HistoryPanel({
  activeTabId,
  terminalTabs,
}: {
  activeTabId: string;
  terminalTabs: Tab[];
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [commands, setCommands] = useState<string[]>([]);
  const [trackingEnabled, setTrackingEnabled] = useState(
    () => localStorage.getItem("commandHistoryTracking") === "true",
  );

  const activeTab = terminalTabs.find((t) => t.id === activeTabId);
  const activeIsTerminal = !!activeTab;
  const hostId = activeTab?.host?.id ? parseInt(activeTab.host.id, 10) : null;

  useEffect(() => {
    const handler = () =>
      setTrackingEnabled(
        localStorage.getItem("commandHistoryTracking") === "true",
      );
    window.addEventListener("commandHistoryTrackingChanged", handler);
    return () =>
      window.removeEventListener("commandHistoryTrackingChanged", handler);
  }, []);

  useEffect(() => {
    if (!hostId || !trackingEnabled) {
      setCommands([]);
      return;
    }
    getCommandHistory(hostId)
      .then(setCommands)
      .catch(() => setCommands([]));
  }, [hostId, trackingEnabled]);

  if (activeIsTerminal && !trackingEnabled) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-3 p-6 text-center">
        <div className="size-10 rounded-full bg-muted/40 flex items-center justify-center">
          <Terminal className="size-5 text-muted-foreground/30" />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-muted-foreground/60">
            {t("newUi.sidebar.history.trackingDisabled")}
          </span>
          <span className="text-xs text-muted-foreground/40">
            {t("newUi.sidebar.history.trackingDisabledHint")}
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
            {t("newUi.sidebar.history.noTerminalSelected")}
          </span>
          <span className="text-xs text-muted-foreground/40">
            {t("newUi.sidebar.history.noTerminalSelectedHint")}
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
      await deleteCommandFromHistory(hostId, cmd);
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
          placeholder={t("newUi.sidebar.history.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {filtered.length} command{filtered.length !== 1 ? "s" : ""}
        </span>
        <button
          onClick={async () => {
            if (!hostId) return;
            try {
              await clearCommandHistory(hostId);
            } catch {
              /* ignore */
            }
            setCommands([]);
          }}
          className="text-xs text-accent-brand hover:text-accent-brand/70"
        >
          {t("newUi.sidebar.history.clearAll")}
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {filtered.length === 0 && (
          <span className="text-xs text-muted-foreground/60 text-center py-8">
            {t("newUi.sidebar.history.noHistoryEntries")}
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
                  onClick={() => navigator.clipboard.writeText(cmd)}
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
