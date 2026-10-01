import { useEffect, useState } from "react";
import {
  usePluginApi,
  usePluginApiFor,
  useTranslation,
} from "@termix/plugin-sdk/frontend";
import {
  cn,
  getPollingEnvironmentMultiplier,
  resolveConnectionOrigin,
  resolveRemoteHostId,
  runAdaptivePolling,
} from "@termix/plugin-sdk/ui";

/** What the ssh-terminal plugin hands a "terminal.toolbarStatus" component. */
interface TerminalToolbarStatusProps {
  host: {
    id: number | string;
    connectionOrigin?: "local" | "remote" | null;
    syncId?: string | null;
  };
  isConnected: boolean;
  /** Visible on a desktop viewport and connected: poll only while true. */
  active: boolean;
}

interface Sample {
  cpu: number | null;
  memory: number | null;
  disk: number | null;
}

function StatBar({
  label,
  percent,
}: {
  label: string;
  percent: number | null;
}) {
  const value = percent == null ? null : Math.max(0, Math.min(100, percent));
  return (
    <div className="flex items-center gap-1.5 px-1.5">
      <span className="w-12 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-muted">
        {value != null && (
          <div
            className={cn(
              "h-full rounded-full transition-all",
              value >= 90
                ? "bg-red-500"
                : value >= 70
                  ? "bg-yellow-500"
                  : "bg-accent-brand",
            )}
            style={{ width: `${value}%` }}
          />
        )}
      </div>
      <span className="w-7 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
        {value == null ? "--" : `${Math.round(value)}%`}
      </span>
    </div>
  );
}

/** CPU, memory and disk bars in the terminal toolbar's expanded view. */
export function TerminalMetricsStatus(props: Record<string, unknown>) {
  const { host, active } = props as unknown as TerminalToolbarStatusProps;
  const { t } = useTranslation();
  const localApi = usePluginApi();
  const remoteApi = usePluginApiFor("remote");
  const [metrics, setMetrics] = useState<Sample | null>(null);
  const [available, setAvailable] = useState(true);
  const hostId = host?.id ? Number(host.id) : null;

  useEffect(() => {
    if (!active || !hostId) {
      setMetrics(null);
      return;
    }
    let cancelled = false;
    let stopPolling: (() => void) | undefined;
    let viewerSessionId: string | undefined;
    let previous: Sample | null = null;
    // A host on the desktop app's remote server has its own id there.
    let api = localApi;
    let targetId: number = hostId;
    setAvailable(true);

    const poll = async () => {
      try {
        const response = await api.get<{
          cpu?: { percent?: number };
          memory?: { percent?: number };
          disk?: { percent?: number };
        } | null>(`/metrics/${targetId}`, {
          validateStatus: (status: number) => status === 200 || status === 404,
        });
        const data = response.data;
        if (cancelled || !data) return;
        const next: Sample = {
          cpu: data.cpu?.percent ?? null,
          memory: data.memory?.percent ?? null,
          disk: data.disk?.percent ?? null,
        };
        const changed =
          !previous ||
          (["cpu", "memory", "disk"] as const).some((key) => {
            const before = previous?.[key];
            const now = next[key];
            return before == null || now == null || Math.abs(now - before) >= 2;
          });
        previous = next;
        setMetrics(next);
        return changed;
      } catch {
        // Keep the previous sample after a transient polling error.
        return false;
      }
    };

    const start = async () => {
      try {
        if ((await resolveConnectionOrigin(host)) === "remote") {
          const remoteId = await resolveRemoteHostId(host.syncId);
          if (cancelled) return;
          if (remoteId === null) {
            setAvailable(false);
            return;
          }
          api = remoteApi;
          targetId = remoteId;
        }
        const { data } = await api.post<{
          requires_totp?: boolean;
          viewerSessionId?: string;
        }>(`/metrics/start/${targetId}`);
        if (cancelled) {
          if (data.viewerSessionId) {
            void api
              .post(`/metrics/stop/${targetId}`, {
                viewerSessionId: data.viewerSessionId,
              })
              .catch(() => {});
          }
          return;
        }
        if (data.requires_totp) {
          setAvailable(false);
          return;
        }
        viewerSessionId = data.viewerSessionId;
        stopPolling = runAdaptivePolling(
          poll,
          {
            minIntervalMs: 5_000,
            maxIntervalMs: 20_000,
            stablePollsPerStep: 2,
            maxRequestDutyCycle: 0.2,
          },
          { intervalMultiplier: getPollingEnvironmentMultiplier },
        );
      } catch {
        if (!cancelled) setAvailable(false);
      }
    };
    void start();

    return () => {
      cancelled = true;
      stopPolling?.();
      void api
        .post(`/metrics/stop/${targetId}`, { viewerSessionId })
        .catch(() => {});
    };
  }, [active, hostId, localApi, remoteApi]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!available) {
    return (
      <span role="status" className="px-2 py-1 text-xs text-muted-foreground">
        {t("terminalStatus.unavailable")}
      </span>
    );
  }

  return (
    <>
      <StatBar label={t("hostMetrics.cpu")} percent={metrics?.cpu ?? null} />
      <StatBar
        label={t("hostMetrics.memory")}
        percent={metrics?.memory ?? null}
      />
      <StatBar label={t("hostMetrics.disk")} percent={metrics?.disk ?? null} />
    </>
  );
}
