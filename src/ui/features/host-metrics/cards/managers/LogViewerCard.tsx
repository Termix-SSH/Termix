import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { managerGet, managerGetSub } from "@/main-axios";
import { extractError } from "./useManagerData";
import { ManagerCardShell } from "./ManagerCardShell";
import { useAdaptivePolling } from "@/hooks/use-adaptive-polling";

interface LogFiles {
  common: string[];
  files: string[];
}

type Mode = "file" | "unit";

export function LogViewerCard({ hostId }: { hostId: number | null }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("file");
  const [path, setPath] = useState<string>("/var/log/syslog");
  const [unit, setUnit] = useState<string>("");
  const [customPath, setCustomPath] = useState("");
  const [lines, setLines] = useState(300);
  const [content, setContent] = useState("");
  const [grep, setGrep] = useState("");
  const [follow, setFollow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const bodyRef = useRef<HTMLPreElement | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;

  // Load the host's actual log files once.
  useEffect(() => {
    if (hostId == null) return;
    managerGetSub<LogFiles>(hostId, "logs", "files")
      .then((res) => {
        const merged = Array.from(
          new Set([...(res.common ?? []), ...(res.files ?? [])]),
        );
        setFiles(merged);
        if (merged.length && !merged.includes(path)) setPath(merged[0]);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId]);

  const fetchLog = useCallback(async () => {
    if (hostId == null) return false;
    const params: Record<string, string | number> = { lines };
    if (mode === "unit") {
      if (!unit.trim()) return false;
      params.unit = unit.trim();
    } else {
      const p = customPath.trim() || path;
      if (!p) return false;
      params.path = p;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await managerGet<{ content: string }>(hostId, "logs", params);
      const next = res.content || "";
      const changed = next !== contentRef.current;
      if (changed) {
        contentRef.current = next;
        setContent(next);
        requestAnimationFrame(() => {
          if (bodyRef.current)
            bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
        });
      }
      return changed;
    } catch (e) {
      setError(extractError(e).message);
    } finally {
      setLoading(false);
    }
  }, [customPath, hostId, lines, mode, path, unit]);

  useEffect(() => {
    void fetchLog();
    // Custom paths are applied on blur/manual refresh, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId, mode, path, unit, lines]);

  useAdaptivePolling(
    fetchLog,
    {
      minIntervalMs: 3_000,
      maxIntervalMs: 18_000,
      stablePollsPerStep: 2,
      maxRequestDutyCycle: 0.2,
    },
    follow,
    { runImmediately: false },
  );

  const shown = useMemo(() => {
    if (!grep) return content;
    const needle = grep.toLowerCase();
    return content
      .split("\n")
      .filter((l) => l.toLowerCase().includes(needle))
      .join("\n");
  }, [content, grep]);

  return (
    <ManagerCardShell
      title={t("hostMetrics.managers.logViewer")}
      icon={<ScrollText className="size-3.5" />}
      loading={loading}
      error={error ? { message: error } : null}
      onRefresh={fetchLog}
      headerExtra={
        <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => setFollow(e.target.checked)}
            className="accent-accent-brand"
          />
          {t("hostMetrics.managers.follow")}
        </label>
      }
    >
      <div className="mb-2 flex items-center gap-1.5">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as Mode)}
          className="h-7 border border-border bg-background px-1 text-[11px]"
        >
          <option value="file">{t("hostMetrics.managers.logFile")}</option>
          <option value="unit">{t("hostMetrics.managers.logUnit")}</option>
        </select>
        {mode === "file" ? (
          <select
            value={customPath ? "" : path}
            onChange={(e) => {
              setCustomPath("");
              setPath(e.target.value);
            }}
            className="h-7 flex-1 border border-border bg-background px-2 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
          >
            {files.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            onBlur={fetchLog}
            placeholder="nginx.service"
            className="h-7 flex-1 border border-border bg-background px-2 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
          />
        )}
        <select
          value={lines}
          onChange={(e) => setLines(Number(e.target.value))}
          className="h-7 border border-border bg-background px-1 text-[11px]"
        >
          {[100, 300, 500, 1000, 2000].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      {mode === "file" && (
        <input
          value={customPath}
          onChange={(e) => setCustomPath(e.target.value)}
          onBlur={() => customPath && fetchLog()}
          placeholder={t("hostMetrics.managers.logCustomPath")}
          className="mb-2 h-7 w-full border border-border bg-background px-2 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
        />
      )}

      <input
        value={grep}
        onChange={(e) => setGrep(e.target.value)}
        placeholder={t("hostMetrics.managers.logGrep")}
        className="mb-2 h-7 w-full border border-border bg-background px-2 text-[11px] outline-none focus:ring-1 focus:ring-ring"
      />

      <pre
        ref={bodyRef}
        className="max-h-[320px] overflow-auto whitespace-pre-wrap break-all border border-border/50 bg-muted/20 p-2 font-mono text-[10px] leading-relaxed"
      >
        {shown || t("hostMetrics.managers.noLogData")}
      </pre>
    </ManagerCardShell>
  );
}
