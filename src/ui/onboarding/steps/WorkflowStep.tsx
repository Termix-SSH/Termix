import { useTranslation } from "react-i18next";
import { Columns2, PanelRight, Search, type LucideIcon } from "lucide-react";
import { Kbd } from "@/components/kbd";
import { useActionSlot } from "@/hooks/use-action-slot";

/**
 * The handful of navigation habits that make the app feel fast. Each row shows
 * the actual gesture rather than describing it, so it reads as a cheat sheet
 * people can come back to via "Run setup again".
 */
export function WorkflowStep() {
  const { t } = useTranslation();
  const pluginTips = useActionSlot("onboarding.workflow");
  const tips = [
    ...[
      { icon: Columns2, key: "split" },
      { icon: PanelRight, key: "dock" },
    ].map(({ icon, key }) => ({
      id: key,
      icon: icon as LucideIcon | undefined,
      title: t(`onboarding.workflow_${key}`),
      description: t(`onboarding.workflow_${key}_desc`),
    })),
    ...pluginTips.map((tip) => ({
      id: tip.actionId,
      icon: tip.icon as LucideIcon | undefined,
      title: t(tip.titleKey),
      description: tip.descriptionKey ? t(tip.descriptionKey) : "",
    })),
  ];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {t("onboarding.workflowIntro")}
      </p>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-start gap-2.5 border border-border bg-card p-2.5">
          <Search size={14} className="mt-0.5 shrink-0 text-accent-brand" />
          <div className="flex flex-1 flex-col gap-1">
            <span className="text-xs font-medium">
              {t("onboarding.workflow_palette")}
            </span>
            <span className="text-[10px] leading-snug text-muted-foreground">
              {t("onboarding.workflow_palette_desc")}
            </span>
            <span className="mt-0.5 flex items-center gap-1">
              <Kbd className="h-5 rounded-none bg-background px-1.5">Shift</Kbd>
              <Kbd className="h-5 rounded-none bg-background px-1.5">Shift</Kbd>
            </span>
          </div>
        </div>

        {tips.map(({ icon: Icon, id, title, description }) => (
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
    </div>
  );
}
