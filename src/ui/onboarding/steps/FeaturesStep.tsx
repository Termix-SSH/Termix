import { useTranslation } from "react-i18next";
import { Plug, type LucideIcon } from "lucide-react";
import { useActionSlot } from "@/hooks/use-action-slot";

/**
 * A tour of the things people miss because they live behind a rail icon.
 * Terminal and hosts are covered by the welcome step, so this is deliberately
 * the "there is more than SSH here" list. Plugins add their own entries
 * through the "onboarding.features" slot.
 */
const FEATURES: { icon: LucideIcon; key: string }[] = [
  { icon: Plug, key: "tunnels" },
];

export function FeaturesStep() {
  const { t } = useTranslation();
  const pluginFeatures = useActionSlot("onboarding.features");
  const features = [
    ...FEATURES.map(({ icon, key }) => ({
      id: key,
      icon,
      title: t(`onboarding.feature_${key}`),
      description: t(`onboarding.feature_${key}_desc`),
    })),
    ...pluginFeatures.map((feature) => ({
      id: feature.actionId,
      icon: feature.icon as LucideIcon | undefined,
      title: t(feature.titleKey),
      description: feature.descriptionKey ? t(feature.descriptionKey) : "",
    })),
  ];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {t("onboarding.featuresIntro")}
      </p>

      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {features.map(({ icon: Icon, id, title, description }) => (
          <div
            key={id}
            className="flex items-start gap-2.5 border border-border bg-card p-2.5"
          >
            {Icon && (
              <Icon size={14} className="mt-0.5 shrink-0 text-accent-brand" />
            )}
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium">{title}</span>
              <span className="text-[10px] leading-snug text-muted-foreground">
                {description}
              </span>
            </div>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground/70">
        {t("onboarding.featuresRailHint")}
      </p>
    </div>
  );
}
