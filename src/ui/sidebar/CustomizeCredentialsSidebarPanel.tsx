import { useTranslation } from "react-i18next";
import { Rows3, SquareStack } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog";
import { SectionCard, SettingRow, FakeSwitch } from "@/components/section-card";
import type {
  CredentialDensity,
  CredentialSidebarPreferences,
  CredentialTrayTrigger,
} from "@/types/credential-sidebar-preferences";

export function CustomizeCredentialsSidebarPanel({
  open,
  onOpenChange,
  preferences,
  update,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  preferences: CredentialSidebarPreferences;
  update: (
    patch:
      | Partial<CredentialSidebarPreferences>
      | ((prev: CredentialSidebarPreferences) => CredentialSidebarPreferences),
  ) => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            {t("credentials.customizeSidebar")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("credentials.customizeSidebarDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 mt-1">
          <SectionCard
            title={t("credentials.customizeDensityTitle")}
            icon={<Rows3 className="size-3.5" />}
          >
            <SettingRow
              label={t("credentials.customizeDensityTitle")}
              description={
                preferences.display.density === "comfortable"
                  ? t("credentials.densityComfortableDesc")
                  : t("credentials.densityCompactDesc")
              }
            >
              <select
                value={preferences.display.density}
                onChange={(e) =>
                  update((prev) => ({
                    ...prev,
                    display: {
                      ...prev.display,
                      density: e.target.value as CredentialDensity,
                    },
                  }))
                }
                className="h-8 border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="comfortable">
                  {t("credentials.displayDensityComfortable")}
                </option>
                <option value="compact">
                  {t("credentials.displayDensityCompact")}
                </option>
              </select>
            </SettingRow>
          </SectionCard>

          <SectionCard
            title={t("credentials.customizeBehaviorTitle")}
            icon={<SquareStack className="size-3.5" />}
          >
            <SettingRow
              label={t("credentials.showCredentialTags")}
              description={t("credentials.showCredentialTagsDesc")}
            >
              <FakeSwitch
                checked={preferences.display.showTags}
                onChange={(v) =>
                  update((prev) => ({
                    ...prev,
                    display: { ...prev.display, showTags: v },
                  }))
                }
              />
            </SettingRow>
            <div className="flex flex-col gap-1.5 py-3 border-b border-border last:border-0">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium leading-snug">
                  {t("credentials.actionsVisibility")}
                </span>
                <span className="text-xs text-muted-foreground leading-snug">
                  {t("credentials.actionsVisibilityDesc")}
                </span>
              </div>
              <select
                value={preferences.display.trayTrigger}
                onChange={(e) =>
                  update((prev) => ({
                    ...prev,
                    display: {
                      ...prev.display,
                      trayTrigger: e.target.value as CredentialTrayTrigger,
                    },
                  }))
                }
                className="h-8 w-full border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="always">{t("credentials.actionsAlways")}</option>
                <option value="actionsOnly">
                  {t("credentials.actionsOnly")}
                </option>
                <option value="hover">{t("credentials.actionsHover")}</option>
                <option value="click">{t("credentials.actionsClick")}</option>
              </select>
            </div>
          </SectionCard>

          <p className="text-[11px] text-muted-foreground/70 leading-snug">
            {t("credentials.customizeSortHint")}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
