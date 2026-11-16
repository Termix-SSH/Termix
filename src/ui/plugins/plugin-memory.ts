import { useEffect, useState } from "react";
import {
  getPluginProcesses,
  getPluginUpdateCheck,
  type PluginProcessReport,
  type PluginUpdateCheck,
} from "@/api/plugins-api";

const REFRESH_MS = 30_000;

/** The server's memory report, read again every half minute while shown. */
export function usePluginMemory(enabled: boolean): PluginProcessReport | null {
  const [report, setReport] = useState<PluginProcessReport | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = () =>
      getPluginProcesses().then(
        (next) => {
          if (!cancelled) setReport(next);
        },
        () => {
          // No access or an older server: nothing to show.
        },
      );
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled]);
  return report;
}

export function formatMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/** Plugins the next Termix release would turn off, read once when shown. */
export function usePluginUpdateCheck(
  enabled: boolean,
): PluginUpdateCheck | null {
  const [check, setCheck] = useState<PluginUpdateCheck | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getPluginUpdateCheck().then(
      (next) => {
        if (!cancelled) setCheck(next);
      },
      () => {
        // No access or an older server: nothing to show.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return check;
}
