import { useTranslation } from "react-i18next";
import { FolderTree, Server, TerminalSquare } from "lucide-react";

const HIGHLIGHTS = [
  { icon: Server, key: "hosts" },
  { icon: TerminalSquare, key: "terminal" },
  { icon: FolderTree, key: "files" },
] as const;

export function WelcomeStep() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {t("onboarding.welcomeIntro")}
      </p>

      <div className="flex flex-col gap-1.5">
        {HIGHLIGHTS.map(({ icon: Icon, key }) => (
          <div
            key={key}
            className="flex items-start gap-2.5 border border-border bg-card p-2.5"
          >
            <Icon size={14} className="mt-0.5 shrink-0 text-accent-brand" />
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium">
                {t(`onboarding.welcome_${key}`)}
              </span>
              <span className="text-[10px] leading-snug text-muted-foreground">
                {t(`onboarding.welcome_${key}_desc`)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
