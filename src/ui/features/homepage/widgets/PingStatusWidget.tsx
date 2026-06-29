import { useEffect, useState } from "react";
import { Wifi } from "lucide-react";
import { useTranslation } from "react-i18next";
import { registerWidget } from "./WidgetRegistry";
import type {
  PingStatusConfig,
  WidgetComponentProps,
} from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";
import { homepageApi } from "@/main-axios";
import { WidgetTitle } from "./WidgetTitle";

interface PingResult {
  ok: boolean;
  statusCode: number | null;
  latencyMs: number;
}

async function pingUrl(url: string): Promise<PingResult> {
  const res = await homepageApi.get("/ping", { params: { url } });
  return res.data as PingResult;
}

function StatusDot({ ok, pending }: { ok: boolean | null; pending: boolean }) {
  if (pending)
    return (
      <span className="w-2 h-2 rounded-full bg-muted-foreground/40 shrink-0 inline-block" />
    );
  return (
    <span
      className="w-2 h-2 rounded-full shrink-0 inline-block"
      style={{ background: ok ? "var(--accent-brand, #f59145)" : "#ef4444" }}
    />
  );
}

function PingStatusWidget({
  widget,
  config,
}: WidgetComponentProps<PingStatusConfig>) {
  const { t } = useTranslation();
  const { urls, refreshInterval, showLatency } = config;
  const [results, setResults] = useState<Record<string, PingResult | null>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const fetchAll = async () => {
    if (urls.length === 0) return;
    const newPending: Record<string, boolean> = {};
    urls.forEach((u) => {
      newPending[u.url] = true;
    });
    setPending(newPending);

    await Promise.all(
      urls.map(async (u) => {
        try {
          const r = await pingUrl(u.url);
          setResults((prev) => ({ ...prev, [u.url]: r }));
        } catch {
          setResults((prev) => ({
            ...prev,
            [u.url]: { ok: false, statusCode: null, latencyMs: 0 },
          }));
        } finally {
          setPending((prev) => ({ ...prev, [u.url]: false }));
        }
      }),
    );
  };

  const interval = Math.max(10, refreshInterval || 30);

  useEffect(() => {
    fetchAll();
    const iv = setInterval(fetchAll, interval * 1000);
    return () => clearInterval(iv);
  }, [JSON.stringify(urls), interval]);

  if (urls.length === 0) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground">
        {t("homepage.noPingUrls")}
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      <WidgetTitle
        title={widget.title || t("homepage.widgetPingStatusName")}
        icon={<Wifi size={11} />}
      />
      <div className="flex-1 overflow-auto">
        {urls.map((u) => {
          const r = results[u.url];
          const isPending = pending[u.url] ?? false;
          return (
            <div
              key={u.url}
              className="flex items-center gap-2 px-2 py-1.5 border-b border-border/30"
            >
              <StatusDot ok={r?.ok ?? null} pending={isPending} />
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-[10px] font-medium text-foreground truncate">
                  {u.label || u.url}
                </span>
                {r && (
                  <span className="text-[9px] text-muted-foreground">
                    {r.statusCode ?? (r.ok ? "OK" : "ERR")}
                  </span>
                )}
              </div>
              {showLatency && r && r.latencyMs > 0 && (
                <span className="text-[9px] text-muted-foreground shrink-0 tabular-nums">
                  {r.latencyMs}ms
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

registerWidget<PingStatusConfig>({
  id: "ping_status",
  name: "Ping Status",
  description: "Check if URLs or services are reachable",
  category: "monitoring",
  icon: <Wifi size={14} />,
  defaultConfig: { urls: [], refreshInterval: 30, showLatency: true },
  defaultSize: { w: GRID_SIZE * 9, h: GRID_SIZE * 7 },
  minSize: { w: GRID_SIZE * 3, h: GRID_SIZE * 2 },
  component: PingStatusWidget,
});

export { PingStatusWidget };
