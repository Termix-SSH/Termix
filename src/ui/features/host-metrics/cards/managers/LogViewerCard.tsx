import { useEffect, useRef, useState } from "react";
import { ScrollText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { managerGet } from "@/main-axios";
import { extractError } from "./useManagerData";
import { ManagerCardShell } from "./ManagerCardShell";

const COMMON_LOGS = [
  "/var/log/syslog",
  "/var/log/messages",
  "/var/log/auth.log",
  "/var/log/secure",
  "/var/log/kern.log",
  "/var/log/dpkg.log",
  "/var/log/nginx/access.log",
  "/var/log/nginx/error.log",
];

export function LogViewerCard({ hostId }: { hostId: number | null }) {
  const { t } = useTranslation();
  const [path, setPath] = useState<string>(COMMON_LOGS[0]);
  const [content, setContent] = useState("");
  const [follow, setFollow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLPreElement | null>(null);

  const options = COMMON_LOGS;

  const fetchLog = async () => {
    if (hostId == null || !path) return;
    setLoading(true);
    setError(null);
    try {
      const res = await managerGet<{ content: string }>(hostId, "logs", {
        path,
        lines: 300,
      });
      setContent(res.content || "");
      requestAnimationFrame(() => {
        if (bodyRef.current)
          bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
      });
    } catch (e) {
      setError(extractError(e).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (path) fetchLog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    if (!follow || !path) return;
    const id = setInterval(fetchLog, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow, path]);

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
      <select
        value={path}
        onChange={(e) => setPath(e.target.value)}
        className="mb-2 h-7 w-full border border-border bg-background px-2 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
      >
        {options.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      <pre
        ref={bodyRef}
        className="max-h-[260px] overflow-auto whitespace-pre-wrap break-all border border-border/50 bg-muted/20 p-2 font-mono text-[10px] leading-relaxed"
      >
        {content || t("hostMetrics.managers.noLogData")}
      </pre>
    </ManagerCardShell>
  );
}
