import { Select2 } from "@/components/select2";
import { InlineView } from "@/components/surface/surface-scope";
import { useTranslation } from "react-i18next";
import { ListChecks, Rows3, SquareStack } from "lucide-react";
import { SectionCard, SettingRow, FakeSwitch } from "@/components/section-card";
import {
  CREDENTIAL_ROW_FIELD_KEYS,
  type CredentialDensity,
  type CredentialSidebarPreferences,
  type CredentialTrayTrigger,
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
    <InlineView
      open={open}
      onOpenChange={onOpenChange}
      title={t("credentials.customizeSidebar")}
    >
      <p className="text-xs text-muted-foreground">
        {t("credentials.customizeSidebarDescription")}
      </p>
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
            <Select2
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
            </Select2>
          </SettingRow>
        </SectionCard>

        <SectionCard
          title={t("credentials.rowDetailsTitle")}
          icon={<ListChecks className="size-3.5" />}
        >
          <p className="pt-2 text-xs text-muted-foreground">
            {t("credentials.rowDetailsDesc")}
          </p>
          {CREDENTIAL_ROW_FIELD_KEYS.map((key) => (
            <SettingRow
              key={key}
              label={t(`credentials.${key}`)}
              description={t(`credentials.${key}Desc`)}
            >
              <FakeSwitch
                checked={preferences.display[key]}
                onChange={(v) =>
                  update((prev) => ({
                    ...prev,
                    display: { ...prev.display, [key]: v },
                  }))
                }
              />
            </SettingRow>
          ))}
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
            <Select2
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
            </Select2>
          </div>
        </SectionCard>

        <p className="text-[11px] text-muted-foreground/70 leading-snug">
          {t("credentials.customizeSortHint")}
        </p>
      </div>
    </InlineView>
  );
}
