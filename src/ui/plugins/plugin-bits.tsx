import { useTranslation } from "react-i18next";
import { PluginIcon } from "@/lib/plugin-icon";
import { cn } from "@/lib/utils";
import { capabilityRisk, formatCount, isSevere } from "./plugin-model";

export function PluginIconBox({
  name,
  size = "md",
  muted,
}: {
  name?: string;
  size?: "sm" | "md" | "lg";
  muted?: boolean;
}) {
  const box = size === "lg" ? "size-10" : size === "sm" ? "size-7" : "size-9";
  const glyph =
    size === "lg" ? "size-5" : size === "sm" ? "size-3.5" : "size-4";
  return (
    <div
      className={cn(
        box,
        "flex shrink-0 items-center justify-center border border-border bg-muted",
        muted && "opacity-40",
      )}
    >
      <PluginIcon name={name} className={cn(glyph, "text-accent-brand")} />
    </div>
  );
}

/** One capability as its consequence, with a mark only on the severe ones. */
export function CapabilityRow({
  capability,
  showId,
  className,
}: {
  capability: string;
  showId?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const severe = isSevere(capability);
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        {severe && (
          <span
            className="flex size-4 items-center justify-center border border-destructive/50 bg-destructive/10 text-[10px] font-bold text-destructive"
            title={t(`plugins.manager.risk.${capabilityRisk(capability)}`)}
          >
            !
          </span>
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-xs font-medium leading-snug">
          {t(`plugins.capabilities.${capability}.title`, {
            defaultValue: capability,
            nsSeparator: false,
          })}
        </span>
        <span className="text-[11px] leading-snug text-muted-foreground">
          {t(`plugins.capabilities.${capability}.consequence`, {
            defaultValue: "",
            nsSeparator: false,
          })}
        </span>
      </div>
      {showId && (
        <span className="shrink-0 text-[10px] text-muted-foreground/50">
          {capability}
        </span>
      )}
    </div>
  );
}

/** Permanent mark on anything installed without a registry signature. */
export function UnverifiedBadge() {
  const { t } = useTranslation();
  return (
    <span
      className="shrink-0 border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warning"
      title={t("plugins.manager.unverifiedHint")}
    >
      {t("plugins.manager.unverified")}
    </span>
  );
}

export function BetaBadge() {
  const { t } = useTranslation();
  return (
    <span
      className="shrink-0 border border-accent-brand/40 bg-accent-brand/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent-brand"
      title={t("plugins.manager.beta.badgeHint")}
    >
      {t("plugins.manager.beta.badge")}
    </span>
  );
}

/** Active installs when the registry has them, release downloads otherwise. */
export function InstallCountFact({
  count,
  source,
}: {
  count: number | null;
  source: string | null;
}) {
  const { t } = useTranslation();
  if (count === null || count <= 0) return null;
  const active = source === "aggregate-telemetry";
  return (
    <span
      title={
        active
          ? t("plugins.manager.count.activeHint")
          : t("plugins.manager.count.downloadsHint")
      }
    >
      {t(
        active
          ? "plugins.manager.count.active"
          : "plugins.manager.count.downloads",
        { count, formatted: formatCount(count) },
      )}
    </span>
  );
}
