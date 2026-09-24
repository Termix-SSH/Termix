import { useTranslation } from "react-i18next";
import { FolderTree, Server, TerminalSquare } from "lucide-react";

const HIGHLIGHTS = [
  {
    icon: Server,
    titleKey: "onboarding.welcome_hosts",
    descKey: "onboarding.welcome_hosts_desc",
  },
  {
    icon: TerminalSquare,
    titleKey: "onboarding.welcome_terminal",
    descKey: "onboarding.welcome_terminal_desc",
  },
  {
    icon: FolderTree,
    titleKey: "onboarding.welcome_files",
    descKey: "onboarding.welcome_files_desc",
  },
] as const;

export function WelcomeStep() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {t("onboarding.welcomeIntro")}
      </p>

      <div className="flex flex-col gap-1.5">
        {HIGHLIGHTS.map(({ icon: Icon, titleKey, descKey }) => (
          <div
            key={titleKey}
            className="flex items-start gap-2.5 border border-border bg-card p-2.5"
          >
            <Icon size={14} className="mt-0.5 shrink-0 text-accent-brand" />
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium">{t(titleKey)}</span>
              <span className="text-[10px] leading-snug text-muted-foreground">
                {t(descKey)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
