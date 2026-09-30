import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import { Button, Skeleton } from "@termix/plugin-sdk/ui";
import {
  getTmuxOverview,
  getTmuxMetrics,
  type TmuxOverview,
  type TmuxPaneMetrics,
} from "./api";
import { pollBackgroundHost } from "./poll-queue";
import { useAdaptivePolling } from "./use-adaptive-polling";

/** Each background host owns its response, error and adaptive polling cycle. */
export function HostOverview({
  hostId,
  children,
}: {
  hostId: number;
  children: (overview: TmuxOverview, metrics: TmuxPaneMetrics[]) => ReactNode;
}) {
  const { t } = useTranslation();
  const [overview, setOverview] = useState<TmuxOverview | null>(null);
  const [metrics, setMetrics] = useState<TmuxPaneMetrics[]>([]);
  const [error, setError] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const signature = useRef("");
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const snapshot = await pollBackgroundHost(async () => {
        if (!mounted.current) return null;
        const next = await getTmuxOverview(hostId);
        const values =
          next.available && mounted.current
            ? await getTmuxMetrics(hostId).catch(() => [])
            : [];
        return { next, values };
      });
      if (!snapshot) return;
      const { next, values } = snapshot;
      if (!mounted.current) return;
      setOverview(next);
      setError(false);
      setMetrics(values);
      const nextSignature = JSON.stringify([next, values]);
      const changed = signature.current !== nextSignature;
      signature.current = nextSignature;
      return changed;
    } catch (err) {
      if (mounted.current) {
        setError(true);
        setMetrics([]);
      }
      throw err;
    } finally {
      inFlight.current = false;
    }
  }, [hostId]);
  useAdaptivePolling(
    load,
    { minIntervalMs: 10_000, maxIntervalMs: 60_000, stablePollsPerStep: 3 },
    true,
    { runImmediately: true },
  );
  if (error)
    return (
      <div className="px-3 py-2 text-xs text-destructive" role="status">
        {t("tmuxMonitor.failedToLoad")}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void load().catch(() => {});
          }}
        >
          {t("tmuxMonitor.retry")}
        </Button>
      </div>
    );
  if (!overview) return <Skeleton className="m-2 h-8" />;
  if (!overview.available)
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">
        {t("tmuxMonitor.tmuxUnavailable")}
      </p>
    );
  if (!overview.sessions.length)
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">
        {t("tmuxMonitor.noSessions")}
      </p>
    );
  return children(overview, metrics);
}
