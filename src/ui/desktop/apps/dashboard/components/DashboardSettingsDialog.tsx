import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useTranslation } from "react-i18next";
import type { DashboardLayout } from "@/ui/main-axios";

interface DashboardSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentLayout: DashboardLayout;
  onSave: (layout: DashboardLayout) => void;
  onReset: () => void;
}

export function DashboardSettingsDialog({
  open,
  onOpenChange,
  currentLayout,
  onSave,
  onReset,
}: DashboardSettingsDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const [layout, setLayout] = useState<DashboardLayout>(currentLayout);

  useEffect(() => {
    setLayout(currentLayout);
  }, [currentLayout, open]);

  const handleCardToggle = (cardId: string, enabled: boolean) => {
    setLayout((prev) => ({
      ...prev,
      cards: prev.cards.map((card) =>
        card.id === cardId ? { ...card, enabled } : card,
      ),
    }));
  };

  const handleSave = () => {
    onSave(layout);
    onOpenChange(false);
  };

  const handleReset = () => {
    onReset();
    onOpenChange(false);
  };

  const cardLabels: Record<string, string> = {
    server_overview: t("dashboard.serverOverviewCard"),
    recent_activity: t("dashboard.recentActivityCard"),
    network_graph: t("dashboard.networkGraphCard"),
    quick_actions: t("dashboard.quickActionsCard"),
    server_stats: t("dashboard.serverStatsCard"),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] bg-canvas border-2 border-edge">
        <DialogHeader>
          <DialogTitle>{t("dashboard.dashboardSettings")}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t("dashboard.customizeLayout")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-3">
            <Label className="text-base font-semibold">
              {t("dashboard.enableDisableCards")}
            </Label>
            <div className="space-y-3">
              {layout.cards.map((card) => (
                <div
                  key={card.id}
                  className="flex items-center space-x-3 border-2 border-edge rounded-md p-3"
                >
                  <Checkbox
                    id={card.id}
                    checked={card.enabled}
                    onCheckedChange={(checked) =>
                      handleCardToggle(card.id, checked === true)
                    }
                  />
                  <Label
                    htmlFor={card.id}
                    className="text-sm font-normal cursor-pointer flex-1"
                  >
                    {cardLabels[card.id] || card.id}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="flex-row gap-2">
          <Button
            variant="outline"
            onClick={handleReset}
            className="border-2 border-edge"
          >
            {t("dashboard.resetLayout")}
          </Button>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-2 border-edge"
          >
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSave}>{t("common.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
