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
  HostDensity,
  HostSidebarPreferences,
  HostTrayTrigger,
} from "@/types/host-sidebar-preferences";

export function CustomizeSidebarPanel({
  open,
  onOpenChange,
  preferences,
  update,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  preferences: HostSidebarPreferences;
  update: (
    patch:
      | Partial<HostSidebarPreferences>
      | ((prev: HostSidebarPreferences) => HostSidebarPreferences),
  ) => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            {t("hosts.customizeSidebar")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("hosts.customizeSidebarDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 mt-1">
          <SectionCard
            title={t("hosts.customizeDensityTitle")}
            icon={<Rows3 className="size-3.5" />}
          >
            <SettingRow
              label={t("hosts.customizeDensityTitle")}
              description={
                preferences.display.density === "comfortable"
                  ? t("hosts.densityComfortableDesc")
                  : t("hosts.densityCompactDesc")
              }
            >
              <select
                value={preferences.display.density}
                onChange={(e) =>
                  update((prev) => ({
                    ...prev,
                    display: {
                      ...prev.display,
                      density: e.target.value as HostDensity,
                    },
                  }))
                }
                className="h-8 border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="comfortable">
                  {t("hosts.displayDensityComfortable")}
                </option>
                <option value="compact">
                  {t("hosts.displayDensityCompact")}
                </option>
              </select>
            </SettingRow>
          </SectionCard>

          <SectionCard
            title={t("hosts.customizeBehaviorTitle")}
            icon={<SquareStack className="size-3.5" />}
          >
            <SettingRow
              label={t("newUi.sidebar.userProfile.showHostTags")}
              description={t("newUi.sidebar.userProfile.showHostTagsDesc")}
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
                  {t("hosts.actionsVisibility")}
                </span>
                <span className="text-xs text-muted-foreground leading-snug">
                  {t("hosts.actionsVisibilityDesc")}
                </span>
              </div>
              <select
                value={preferences.display.trayTrigger}
                onChange={(e) =>
                  update((prev) => ({
                    ...prev,
                    display: {
                      ...prev.display,
                      trayTrigger: e.target.value as HostTrayTrigger,
                    },
                  }))
                }
                className="h-8 w-full border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="always">{t("hosts.actionsAlways")}</option>
                <option value="actionsOnly">{t("hosts.actionsOnly")}</option>
                <option value="hover">{t("hosts.actionsHover")}</option>
                <option value="click">{t("hosts.actionsClick")}</option>
              </select>
            </div>
            <SettingRow
              label={t("newUi.sidebar.userProfile.statusColors")}
              description={t("newUi.sidebar.userProfile.statusColorsDesc")}
            >
              <FakeSwitch
                checked={preferences.display.statusColorScheme === "status"}
                onChange={(v) =>
                  update((prev) => ({
                    ...prev,
                    display: {
                      ...prev.display,
                      statusColorScheme: v ? "status" : "accent",
                    },
                  }))
                }
              />
            </SettingRow>
          </SectionCard>

          <p className="text-[11px] text-muted-foreground/70 leading-snug">
            {t("hosts.customizeSortHint")}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
