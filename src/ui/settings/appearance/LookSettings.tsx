import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Select2 } from "@/components/select2";
import {
  chooseDefaultLook,
  chooseLayout,
  useLookState,
} from "@/look/look-store";
import { layoutLabel, useLayouts } from "@/look/layout-registry";
import { themeLabel, useThemes } from "@/look/theme-registry";

const selectClass =
  "w-full px-2.5 py-1.5 text-xs bg-background border border-border text-foreground outline-none focus:ring-1 focus:ring-ring appearance-none pr-7";

/**
 * The layout picker, plus the default layout and theme for everyone when an
 * admin is looking. Lists what the layout and theme registries hold, so
 * plugin layouts and themes show up as soon as they are installed.
 */
export function LookSettings({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useTranslation();
  const look = useLookState();
  const layouts = useLayouts();
  const themes = useThemes();
  const response = look.response;

  const failed = () => toast.error(t("looks.saveFailed"));

  return (
    <div className="flex flex-col gap-2">
      <Select2
        value={response?.layoutId ?? ""}
        disabled={!response}
        onChange={(e) =>
          void chooseLayout(e.target.value || null).catch(failed)
        }
        className={selectClass}
      >
        <option value="">{t("looks.followDefault")}</option>
        {layouts.map((layout) => (
          <option key={layout.id} value={layout.id}>
            {layoutLabel(layout, t)}
          </option>
        ))}
      </Select2>
      <p className="text-[11px] text-muted-foreground">
        {t("looks.layoutHint")}
      </p>

      {isAdmin && response && (
        <div className="flex flex-col gap-1.5 border border-border p-2">
          <span className="text-[11px] font-medium text-foreground">
            {t("looks.defaultsLabel")}
          </span>
          <p className="text-[11px] text-muted-foreground">
            {t("looks.defaultsHint")}
          </p>
          <Select2
            value={response.defaults.layout ?? ""}
            onChange={(e) =>
              void chooseDefaultLook({ layout: e.target.value || null })
                .then(() => toast.success(t("looks.defaultSaved")))
                .catch(failed)
            }
            className={selectClass}
          >
            <option value="">{t("looks.followDefault")}</option>
            {layouts.map((layout) => (
              <option key={layout.id} value={layout.id}>
                {layoutLabel(layout, t)}
              </option>
            ))}
          </Select2>
          <Select2
            value={response.defaults.theme ?? ""}
            onChange={(e) =>
              void chooseDefaultLook({ theme: e.target.value || null })
                .then(() => toast.success(t("looks.defaultSaved")))
                .catch(failed)
            }
            className={selectClass}
          >
            <option value="">{t("looks.followDefault")}</option>
            {themes.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {themeLabel(theme, t)}
              </option>
            ))}
          </Select2>
        </div>
      )}
    </div>
  );
}
