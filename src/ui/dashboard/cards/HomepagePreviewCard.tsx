import { Card } from "@/components/card";
import { useTranslation } from "react-i18next";
import { LayoutGrid } from "lucide-react";
import { HomepageCanvas } from "@/features/homepage/HomepageCanvas";

interface HomepagePreviewCardProps {
  onOpenFullscreen: () => void;
}

export function HomepagePreviewCard({
  onOpenFullscreen,
}: HomepagePreviewCardProps) {
  const { t } = useTranslation();
  return (
    <Card className="relative overflow-hidden w-full h-full flex flex-col p-0 gap-0">
      {/* Card header */}
      <div className="flex items-center gap-2 px-3 py-2 shrink-0 border-b border-border">
        <LayoutGrid className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
          {t("homepage.previewTitle")}
        </span>
        <button
          className="ml-auto text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          onClick={onOpenFullscreen}
        >
          {t("homepage.openFullView")}
        </button>
      </div>

      {/* Live pannable preview — no pointer-events blocking so panning works */}
      <div className="flex-1 relative overflow-hidden">
        <HomepageCanvas isReadOnly={true} fitOnLoad={true} />
      </div>
    </Card>
  );
}
