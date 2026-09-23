import { Puzzle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePluginStore } from "./plugin-store";
import { unregisteredViewStatus, type ViewKind } from "./view-ownership";

/**
 * Stands in for a tab, panel or card whose plugin is not running.
 *
 * A saved tab of a plugin that was switched off or removed must neither crash
 * the shell nor vanish without a word, so it renders this until the plugin is
 * back, at which point the real view takes over in place.
 */
export function PluginViewPlaceholder({
  kind,
  viewId,
  compact = false,
}: {
  kind: ViewKind;
  viewId: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  // Subscribing re-renders this when plugin state changes.
  usePluginStore();
  const { status, owner } = unregisteredViewStatus(kind, viewId);
  const name = owner?.summary.name ?? viewId;

  if (status === "loading") {
    return (
      <div
        className="flex h-full w-full items-center justify-center"
        aria-label={t("plugins.runtime.loading", { name })}
      >
        <div className="size-5 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground/70 animate-spin" />
      </div>
    );
  }

  const title =
    status === "failed"
      ? t("plugins.runtime.failed", { name })
      : owner
        ? t("plugins.runtime.needsPlugin", { name })
        : t("plugins.runtime.needsUnknownPlugin");
  const hint =
    status === "failed"
      ? t("plugins.runtime.failedHint")
      : status === "disabled"
        ? t("plugins.runtime.disabledHint")
        : t("plugins.runtime.missingHint");

  return (
    <div
      data-testid="plugin-view-placeholder"
      data-status={status}
      className={`flex h-full w-full flex-col items-center justify-center gap-2 text-center ${compact ? "p-3" : "p-6"}`}
    >
      <Puzzle className="size-6 text-muted-foreground/40" />
      <span className="text-sm font-semibold text-muted-foreground">
        {title}
      </span>
      <span className="text-xs text-muted-foreground/70">{hint}</span>
    </div>
  );
}
