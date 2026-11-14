import { useTranslation } from "react-i18next";
import { MemoryStick } from "lucide-react";
import { NoticePanel } from "@/components/notice-panel";
import type { PluginProcessReport } from "@/api/plugins-api";
import { formatMb } from "./plugin-memory";

/** One line with the total, and a warning when the box is too small. */
export function PluginMemorySummary({
  report,
}: {
  report: PluginProcessReport | null;
}) {
  const { t } = useTranslation();
  if (!report) return null;
  const values = {
    total: formatMb(report.totalMb),
    limit: formatMb(report.limitMb),
    plugins: formatMb(report.pluginsMb),
    running: report.running,
  };
  return (
    <>
      <div
        className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground"
        data-testid="plugin-memory"
      >
        <MemoryStick className="size-3.5" />
        <span className="tabular-nums">
          {t("plugins.manager.memory.summary", values)}
        </span>
      </div>
      {report.low && (
        <NoticePanel
          icon={MemoryStick}
          tone="warning"
          title={t("plugins.manager.memory.lowTitle")}
          className="border-b border-border"
        >
          {t("plugins.manager.memory.lowBody", values)}
        </NoticePanel>
      )}
    </>
  );
}

/** A plugin's memory for its row: MB while it runs, else why it is off. */
export function PluginMemoryCell({
  report,
  pluginId,
}: {
  report: PluginProcessReport | null;
  pluginId: string;
}) {
  const { t } = useTranslation();
  const entry = report?.plugins.find((p) => p.pluginId === pluginId);
  if (!entry) {
    return <span className="text-muted-foreground">-</span>;
  }
  if (entry.state !== "ready" || entry.rssMb === null) {
    return (
      <span
        className="text-muted-foreground"
        title={t("plugins.manager.memory.idleHint")}
      >
        {t("plugins.manager.memory.idle")}
      </span>
    );
  }
  return (
    <span
      className="tabular-nums text-muted-foreground"
      title={
        entry.keepOnReason
          ? t("plugins.manager.memory.keptOn", { reason: entry.keepOnReason })
          : t("plugins.manager.memory.stopsWhenIdle")
      }
    >
      {formatMb(entry.rssMb)}
    </span>
  );
}
