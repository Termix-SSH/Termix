import { useTranslation } from "react-i18next";
import {
  Boxes,
  FolderTree,
  MonitorSmartphone,
  Network,
  Play,
  Plug,
  Workflow,
  type LucideIcon,
} from "lucide-react";

/**
 * A tour of the things people miss because they live behind a rail icon.
 * Terminal and hosts are covered by the welcome step, so this is deliberately
 * the "there is more than SSH here" list.
 */
const FEATURES: { icon: LucideIcon; key: string }[] = [
  { icon: FolderTree, key: "files" },
  { icon: MonitorSmartphone, key: "desktop" },
  { icon: Plug, key: "tunnels" },
  { icon: Boxes, key: "docker" },
  { icon: Play, key: "snippets" },
  { icon: Workflow, key: "automations" },
  { icon: Network, key: "metrics" },
];

export function FeaturesStep() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {t("onboarding.featuresIntro")}
      </p>

      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {FEATURES.map(({ icon: Icon, key }) => (
          <div
            key={key}
            className="flex items-start gap-2.5 border border-border bg-card p-2.5"
          >
            <Icon size={14} className="mt-0.5 shrink-0 text-accent-brand" />
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium">
                {t(`onboarding.feature_${key}`)}
              </span>
              <span className="text-[10px] leading-snug text-muted-foreground">
                {t(`onboarding.feature_${key}_desc`)}
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
