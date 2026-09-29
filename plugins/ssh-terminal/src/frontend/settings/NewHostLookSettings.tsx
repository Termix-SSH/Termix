import { SettingRow, Select2 } from "@termix/plugin-sdk/ui";
import {
  useTranslation,
  type SettingsComponentProps,
} from "@termix/plugin-sdk/frontend";
import { TERMINAL_FONTS, TERMINAL_THEMES } from "../look/terminal-themes";
import { DEFAULT_APPEARANCE } from "../../shared/terminal-settings";

const selectClass =
  "flex h-8 w-48 border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring";

/** Admin setting `newHostTheme`: the theme a new host starts with. */
export function NewHostThemeSetting({
  values,
  setValue,
  running,
}: SettingsComponentProps) {
  const { t } = useTranslation();
  const value =
    typeof values.newHostTheme === "string"
      ? values.newHostTheme
      : DEFAULT_APPEARANCE.theme;
  return (
    <SettingRow
      label={t("settings.admin.newHostTheme.label")}
      description={t("settings.admin.newHostTheme.description")}
    >
      <Select2
        value={value}
        disabled={!running}
        onChange={(e) => setValue("newHostTheme", e.target.value)}
        className={selectClass}
      >
        {Object.entries(TERMINAL_THEMES)
          .filter(([key]) => key !== "termixDark" && key !== "termixLight")
          .map(([key, theme]) => (
            <option key={key} value={key}>
              {theme.name}
            </option>
          ))}
      </Select2>
    </SettingRow>
  );
}

/** Admin setting `newHostFontFamily`: the font a new host starts with. */
export function NewHostFontSetting({
  values,
  setValue,
  running,
}: SettingsComponentProps) {
  const { t } = useTranslation();
  const value =
    typeof values.newHostFontFamily === "string"
      ? values.newHostFontFamily
      : DEFAULT_APPEARANCE.fontFamily;
  const known = TERMINAL_FONTS.some((font) => font.value === value);
  return (
    <SettingRow
      label={t("settings.admin.newHostFontFamily.label")}
      description={t("settings.admin.newHostFontFamily.description")}
    >
      <Select2
        value={value}
        disabled={!running}
        onChange={(e) => setValue("newHostFontFamily", e.target.value)}
        className={`${selectClass} font-mono`}
      >
        {!known && <option value={value}>{value}</option>}
        {TERMINAL_FONTS.map((font) => (
          <option key={font.value} value={font.value}>
            {font.label}
          </option>
        ))}
      </Select2>
    </SettingRow>
  );
}
