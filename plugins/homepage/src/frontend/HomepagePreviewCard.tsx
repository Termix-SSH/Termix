import { LayoutGrid } from "lucide-react";
import {
  useTranslation,
  type DashboardCardProps,
} from "@termix/plugin-sdk/frontend";
import { Card } from "@termix/plugin-sdk/ui";
import { HomepageCanvas } from "./HomepageCanvas.js";

export function HomepagePreviewCard({ shell }: DashboardCardProps) {
  const { t } = useTranslation();
  return (
    <Card className="relative overflow-hidden w-full h-full flex flex-col p-0 gap-0">
      <div className="flex items-center gap-2 px-3 py-2 shrink-0 border-b border-border">
        <LayoutGrid className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
          {t("homepage.previewTitle")}
        </span>
        <button
          className="ml-auto text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => shell.openSingletonTab("homepage")}
        >
          {t("homepage.openFullView")}
        </button>
      </div>

      <div className="flex-1 relative overflow-hidden">
        <HomepageCanvas isReadOnly={true} fitOnLoad={true} />
      </div>
    </Card>
  );
}
