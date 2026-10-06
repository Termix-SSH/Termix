import { Select2 } from "@/components/select2";
import { InlineView } from "@/components/surface/surface-scope";
import { useTranslation } from "react-i18next";
import { ListChecks, PanelTop, Rows3, SquareStack } from "lucide-react";
import { actionOrder, useHostActions } from "./host-contributions";
import { showsInBar } from "./tree/host-bar-actions";
import { SectionCard, SettingRow, FakeSwitch } from "@/components/section-card";
import type {
  HostClickBehavior,
  HostDensity,
  HostRowFields,
  HostSidebarPreferences,
  HostTrayTrigger,
} from "@/types/host-sidebar-preferences";

const ROW_FIELDS: { key: keyof HostRowFields; dependsOnAddress?: boolean }[] = [
  { key: "showAddress" },
  { key: "showUsername", dependsOnAddress: true },
  { key: "showPort", dependsOnAddress: true },
  { key: "showPinIcon" },
  { key: "showSharedBadge" },
  { key: "showBadges" },
];

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
  const actions = [...useHostActions()].sort(
    (a, b) => actionOrder(a) - actionOrder(b) || a.id.localeCompare(b.id),
  );

  return (
    <InlineView
      open={open}
      onOpenChange={onOpenChange}
      title={t("hosts.customizeSidebar")}
    >
      <p className="text-xs text-muted-foreground">
        {t("hosts.customizeSidebarDescription")}
      </p>
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
            <Select2
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
            </Select2>
          </SettingRow>
        </SectionCard>

        <SectionCard
          title={t("hosts.rowDetailsTitle")}
          icon={<ListChecks className="size-3.5" />}
        >
          <p className="pt-2 text-xs text-muted-foreground">
            {t("hosts.rowDetailsDesc")}
          </p>
          {ROW_FIELDS.map(({ key, dependsOnAddress }) => (
            <SettingRow
              key={key}
              label={t(`hosts.${key}`)}
              description={t(`hosts.${key}Desc`)}
            >
              <FakeSwitch
                checked={preferences.display[key]}
                disabled={dependsOnAddress && !preferences.display.showAddress}
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
          <SettingRow
            label={t("hosts.showFolderPaths")}
            description={t("hosts.showFolderPathsDesc")}
          >
            <FakeSwitch
              checked={preferences.display.showFolderPaths}
              onChange={(v) =>
                update((prev) => ({
                  ...prev,
                  display: { ...prev.display, showFolderPaths: v },
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
            <Select2
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
            </Select2>
          </div>
          <div className="flex flex-col gap-1.5 py-3 border-b border-border last:border-0">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium leading-snug">
                {t("hosts.hostClickBehavior")}
              </span>
              <span className="text-xs text-muted-foreground leading-snug">
                {t("hosts.hostClickBehaviorDesc")}
              </span>
            </div>
            <Select2
              value={preferences.display.hostClickBehavior}
              onChange={(e) =>
                update((prev) => ({
                  ...prev,
                  display: {
                    ...prev.display,
                    hostClickBehavior: e.target.value as HostClickBehavior,
                  },
                }))
              }
              className="h-8 w-full border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="newTab">{t("hosts.hostClickNewTab")}</option>
              <option value="focusExisting">
                {t("hosts.hostClickFocusExisting")}
              </option>
              <option value="focusExistingDoubleClickNew">
                {t("hosts.hostClickFocusExistingDoubleNew")}
              </option>
            </Select2>
          </div>
          <SettingRow
            label={t("hosts.openOnDoubleClick")}
            description={t("hosts.openOnDoubleClickDesc")}
          >
            <FakeSwitch
              checked={preferences.display.openOnDoubleClick}
              disabled={
                preferences.display.hostClickBehavior ===
                "focusExistingDoubleClickNew"
              }
              onChange={(v) =>
                update((prev) => ({
                  ...prev,
                  display: { ...prev.display, openOnDoubleClick: v },
                }))
              }
            />
          </SettingRow>
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

        {actions.length > 0 && (
          <SectionCard
            title={t("hosts.connectBarTitle")}
            icon={<PanelTop className="size-3.5" />}
          >
            <p className="pt-2 text-xs text-muted-foreground">
              {t("hosts.connectBarDesc")}
            </p>
            {actions.map((action) => {
              const Icon = action.icon;
              return (
                <SettingRow
                  key={action.id}
                  label={t(action.titleKey)}
                  rowId={`bar-action-${action.id}`}
                >
                  <span className="flex items-center gap-2">
                    <Icon className="size-3.5 text-muted-foreground" />
                    <FakeSwitch
                      checked={showsInBar(
                        preferences.display.barActions,
                        action,
                      )}
                      onChange={(v) =>
                        update((prev) => ({
                          ...prev,
                          display: {
                            ...prev.display,
                            barActions: {
                              ...prev.display.barActions,
                              [action.id]: v,
                            },
                          },
                        }))
                      }
                    />
                  </span>
                </SettingRow>
              );
            })}
          </SectionCard>
        )}

        <p className="text-[11px] text-muted-foreground/70 leading-snug">
          {t("hosts.customizeSortHint")}
        </p>
      </div>
    </InlineView>
  );
}
