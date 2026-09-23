import { useEffect, useState } from "react";
import { useToast, useTranslation } from "@termix/plugin-sdk/frontend";
import { Button, Input } from "@termix/plugin-sdk/ui";
import {
  getMetricsHistoryRetention,
  saveMetricsHistoryRetention,
} from "./host-metrics-api";

/**
 * How long metrics history is kept. Lives in the metrics backend's own
 * setting, so it saves with its own button rather than the page's.
 */
export function MetricsRetentionSetting() {
  const { t } = useTranslation();
  const toast = useToast();
  const [days, setDays] = useState("7");

  useEffect(() => {
    let cancelled = false;
    getMetricsHistoryRetention()
      .then((value) => {
        if (!cancelled) setDays(String(value));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    const value = Number.parseInt(days, 10);
    if (Number.isNaN(value) || value < 1 || value > 90) {
      toast.error(t("admin.metricsHistoryRetentionRange"));
      return;
    }
    try {
      await saveMetricsHistoryRetention(value);
      toast.success(t("admin.monitoringSaved"));
    } catch {
      toast.error(t("admin.monitoringSaveFailed"));
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
        {t("admin.metricsHistoryRetention")}
      </label>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={1}
          max={90}
          value={days}
          onChange={(event) => setDays(event.target.value)}
          className="w-20 text-sm"
        />
        <span className="text-xs text-muted-foreground">{t("admin.days")}</span>
        <Button
          variant="outline"
          size="sm"
          className="text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand h-7"
          onClick={() => void save()}
        >
          {t("common.save")}
        </Button>
      </div>
      <span className="text-[10px] text-muted-foreground">
        {t("admin.metricsHistoryRetentionRange")}
      </span>
    </div>
  );
}
