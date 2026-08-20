import { useTranslation } from "react-i18next";
import { Columns2, LayoutTemplate, PanelRight, Search } from "lucide-react";
import { Kbd } from "@/components/kbd";

/**
 * The handful of navigation habits that make the app feel fast. Each row shows
 * the actual gesture rather than describing it, so it reads as a cheat sheet
 * people can come back to via "Run setup again".
 */
export function WorkflowStep() {
  const { t } = useTranslation();

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

        {[
          { icon: Columns2, key: "split" },
          { icon: PanelRight, key: "dock" },
          { icon: LayoutTemplate, key: "workspaces" },
        ].map(({ icon: Icon, key }) => (
          <div
            key={key}
            className="flex items-start gap-2.5 border border-border bg-card p-2.5"
          >
            <Icon size={14} className="mt-0.5 shrink-0 text-accent-brand" />
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium">
                {t(`onboarding.workflow_${key}`)}
              </span>
              <span className="text-[10px] leading-snug text-muted-foreground">
                {t(`onboarding.workflow_${key}_desc`)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
