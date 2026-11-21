import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Pause, Play } from "lucide-react";
import { Button } from "@/components/button";
import {
  PanelSearch,
  ToolbarBand,
  ToolbarSelect,
} from "@/components/panel-layout";
import { LoadingState } from "@/components/loading-state";
import { DIAGNOSTICS_MENU_CLASS } from "./open-diagnostics";
import { cn } from "@/lib/utils";
import { getServerLogs, type ServerLogLine } from "./diagnostics-api";

const POLL_MS = 2000;
const KEEP_LINES = 5000;
// Radix selects refuse an empty value.
const ALL = "__all__";

type LevelFilter = "all" | "warn" | "error";

const LEVEL_CLASS: Record<ServerLogLine["level"], string> = {
  debug: "text-muted-foreground",
  info: "",
  success: "",
  warn: "text-warning",
  error: "text-destructive",
};

export function ServerLogsView() {
  const { t } = useTranslation();
  const [lines, setLines] = useState<ServerLogLine[] | null>(null);
  const [paused, setPaused] = useState(false);
  const [level, setLevel] = useState<LevelFilter>("all");
  const [plugin, setPlugin] = useState(ALL);
  const [search, setSearch] = useState("");
  const [failed, setFailed] = useState(false);
  const latest = useRef<number | undefined>(undefined);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    if (paused) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (document.visibilityState === "visible") {
        try {
          const first = latest.current === undefined;
          const result = await getServerLogs({ after: latest.current });
          if (stopped) return;
          setFailed(false);
          latest.current = result.latest;
          const fresh = first
            ? [...result.boot, ...result.recent]
            : result.recent;
          if (first || fresh.length) {
            setLines((current) =>
              [...(first ? [] : (current ?? [])), ...fresh].slice(-KEEP_LINES),
            );
          }
        } catch {
          if (!stopped) setFailed(true);
        }
      }
      if (!stopped) timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [paused]);

  const plugins = useMemo(() => {
    const ids = new Set<string>();
    for (const line of lines ?? []) if (line.pluginId) ids.add(line.pluginId);
    return [...ids].sort();
  }, [lines]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (lines ?? []).filter(
      (line) =>
        (level === "all" ||
          line.level === "error" ||
          (level === "warn" && line.level === "warn")) &&
        (plugin === ALL || line.pluginId === plugin) &&
        (!needle || line.text.toLowerCase().includes(needle)),
    );
  }, [lines, level, plugin, search]);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [shown]);

  const download = () => {
    const text = shown
      .map((line) => `${line.at} ${line.level.toUpperCase()} ${line.text}`)
      .join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `termix-server-log-${new Date().toISOString().replace(/[:]/g, "-").replace(/\..+$/, "")}.log`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ToolbarBand>
        <PanelSearch
          value={search}
          onChange={setSearch}
          placeholder={t("diagnostics.logsSearch")}
        />
        <ToolbarSelect
          contentClassName={DIAGNOSTICS_MENU_CLASS}
          value={level}
          onChange={setLevel}
          label={t("diagnostics.logsLevel")}
          options={[
            { value: "all", label: t("diagnostics.logsAll") },
            { value: "warn", label: t("diagnostics.logsWarn") },
            { value: "error", label: t("diagnostics.logsError") },
          ]}
        />
        <ToolbarSelect
          contentClassName={DIAGNOSTICS_MENU_CLASS}
          value={plugin}
          onChange={setPlugin}
          label={t("diagnostics.logsPlugin")}
          options={[
            { value: ALL, label: t("diagnostics.allPlugins") },
            ...plugins.map((id) => ({ value: id, label: id })),
          ]}
        />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {failed
              ? t("diagnostics.logsFailed")
              : t("diagnostics.logsCount", { count: shown.length })}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? <Play /> : <Pause />}
            {paused ? t("diagnostics.logsResume") : t("diagnostics.logsPause")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={download}
            disabled={!shown.length}
          >
            <Download />
            {t("diagnostics.download")}
          </Button>
        </div>
      </ToolbarBand>
      {lines === null ? (
        <LoadingState className="flex-1" />
      ) : (
        <div
          ref={scroller}
          onScroll={(event) => {
            const el = event.currentTarget;
            stick.current =
              el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
          }}
          className="min-h-0 flex-1 overflow-auto bg-background px-3 py-2 font-mono text-xs leading-relaxed thin-scrollbar"
        >
          {shown.length === 0 ? (
            <p className="text-muted-foreground">
              {t("diagnostics.logsEmpty")}
            </p>
          ) : (
            shown.map((line) => (
              <div
                key={line.seq}
                className={cn(
                  "whitespace-pre-wrap break-all",
                  LEVEL_CLASS[line.level],
                )}
              >
                {line.text}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
