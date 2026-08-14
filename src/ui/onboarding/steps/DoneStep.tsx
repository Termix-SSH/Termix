import { useTranslation } from "react-i18next";
import {
  BookOpen,
  CheckCircle2,
  Monitor,
  RotateCcw,
  Settings,
  Smartphone,
  Terminal,
} from "lucide-react";

const NEXT_STEPS = [
  { icon: Settings, key: "settings" },
  { icon: RotateCcw, key: "rerun" },
  { icon: Monitor, key: "desktop", href: "https://docs.termix.site/install" },
  { icon: Smartphone, key: "mobile", href: "https://docs.termix.site/install" },
  { icon: BookOpen, key: "docs", href: "https://docs.termix.site" },
  { icon: Terminal, key: "cli", href: "https://docs.termix.site/cli" },
] as const;

export function DoneStep() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col items-center gap-2 py-2 text-center">
        <CheckCircle2 size={26} className="text-accent-brand" />
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold">
            {t("onboarding.doneHeading")}
          </span>
          <span className="max-w-sm text-[11px] leading-snug text-muted-foreground">
            {t("onboarding.doneDesc")}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {NEXT_STEPS.map((step) => {
          const { icon: Icon, key } = step;
          const href = "href" in step ? step.href : null;
          return (
            <div
              key={key}
              className="flex items-start gap-2.5 border border-border bg-card p-2.5"
            >
              <Icon size={14} className="mt-0.5 shrink-0 text-accent-brand" />
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium">
                  {t(`onboarding.done_${key}`)}
                </span>
                <span className="text-[10px] leading-snug text-muted-foreground">
                  {t(`onboarding.done_${key}_desc`)}
                </span>
                {href && (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-0.5 w-fit text-[10px] font-medium text-accent-brand hover:underline"
                  >
                    {t(`onboarding.done_${key}_link`)}
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
