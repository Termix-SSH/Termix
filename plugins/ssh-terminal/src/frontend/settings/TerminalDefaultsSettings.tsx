import { useMemo, useState } from "react";
import type React from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  SettingRow,
} from "@termix/plugin-sdk/ui";
import {
  useTranslation,
  type SettingsComponentProps,
} from "@termix/plugin-sdk/frontend";
import {
  CURSOR_STYLES,
  TERMINAL_FONTS,
  TERMINAL_THEMES,
} from "../look/terminal-themes";
import { fromTriState, toTriState, type TriState } from "./tri-state";
import {
  readUserSettings,
  type TerminalDefaults,
} from "../../shared/terminal-settings";

const inputClass =
  "h-8 w-full border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring";
const labelClass =
  "text-[10px] font-bold uppercase tracking-widest text-muted-foreground";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={labelClass}>{label}</span>
      {children}
    </div>
  );
}

function TriStateSelect({
  value,
  onChange,
}: {
  value?: boolean;
  onChange: (value: boolean | undefined) => void;
}) {
  const { t } = useTranslation();
  return (
    <select
      className="h-7 w-28 border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
      value={toTriState(value)}
      onChange={(e) => onChange(fromTriState(e.target.value as TriState))}
    >
      <option value="inherit">{t("terminalDefaults.inherit")}</option>
      <option value="on">{t("terminalDefaults.on")}</option>
      <option value="off">{t("terminalDefaults.off")}</option>
    </select>
  );
}

/**
 * The user's terminal defaults (the `terminalDefaults` user setting): the
 * look every host that follows the user starts from. Applied to the form,
 * saved with the rest of the section.
 */
export function TerminalDefaultsSettings({
  values,
  setValue,
  running,
}: SettingsComponentProps) {
  const { t } = useTranslation();
  const saved = useMemo(() => readUserSettings(values), [values]);
  const [open, setOpen] = useState(false);
  const [terminal, setTerminal] = useState<TerminalDefaults>({});

  const configuredCount = Object.values(saved.terminalDefaults).filter(
    (value) => value !== undefined,
  ).length;

  const openDialog = () => {
    setTerminal(saved.terminalDefaults);
    setOpen(true);
  };

  const updateTerminal = <K extends keyof TerminalDefaults>(
    key: K,
    value: TerminalDefaults[K],
  ) => setTerminal((current) => ({ ...current, [key]: value }));

  const applySavedTheme = (id: string) => {
    const theme = saved.customThemes.find((entry) => entry.id === id);
    if (!theme) return;
    setTerminal((current) => ({
      ...current,
      theme: "custom",
      customThemeColors: { ...theme.colors },
    }));
  };

  const apply = () => {
    const cleaned = Object.fromEntries(
      Object.entries(terminal).filter(([, value]) => value !== undefined),
    );
    setValue("terminalDefaults", cleaned);
    setOpen(false);
  };

  const inheritLabel = t("terminalDefaults.inherit");

  return (
    <>
      <SettingRow
        label={t("terminalDefaults.title")}
        description={t("terminalDefaults.description")}
        badge={configuredCount > 0 ? String(configuredCount) : undefined}
      >
        <Button
          variant="outline"
          size="sm"
          disabled={!running}
          onClick={openDialog}
        >
          {t("terminalDefaults.manage")}
        </Button>
      </SettingRow>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              {t("terminalDefaults.title")}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("terminalDefaults.dialogDescription")}{" "}
              <a
                href="https://docs.termix.site/features/files-and-hosts/connection-defaults"
                target="_blank"
                rel="noreferrer"
                className="text-accent-brand hover:underline"
              >
                {t("hosts.docsLink")}
              </a>
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[55vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t("hosts.fontFamilyLabel")}>
                <select
                  className={inputClass}
                  value={terminal.fontFamily ?? ""}
                  onChange={(e) =>
                    updateTerminal("fontFamily", e.target.value || undefined)
                  }
                >
                  <option value="">{inheritLabel}</option>
                  {TERMINAL_FONTS.map((font) => (
                    <option key={font.value} value={font.value}>
                      {font.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={t("hosts.colorTheme")}>
                <select
                  className={inputClass}
                  value={terminal.theme ?? ""}
                  onChange={(e) =>
                    updateTerminal("theme", e.target.value || undefined)
                  }
                >
                  <option value="">{inheritLabel}</option>
                  {Object.entries(TERMINAL_THEMES)
                    .filter(
                      ([key]) => key !== "termixDark" && key !== "termixLight",
                    )
                    .map(([key, theme]) => (
                      <option key={key} value={key}>
                        {theme.name}
                      </option>
                    ))}
                </select>
              </Field>

              {saved.customThemes.length > 0 && (
                <Field label={t("terminalDefaults.savedThemeLabel")}>
                  <select
                    className={inputClass}
                    value=""
                    onChange={(e) => applySavedTheme(e.target.value)}
                  >
                    <option value="">
                      {t("terminalDefaults.savedThemePlaceholder")}
                    </option>
                    {saved.customThemes.map((theme) => (
                      <option key={theme.id} value={theme.id}>
                        {theme.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              <Field label={t("hosts.fontSizeLabel")}>
                <input
                  className={inputClass}
                  type="number"
                  min={8}
                  max={32}
                  value={terminal.fontSize ?? ""}
                  placeholder={inheritLabel}
                  onChange={(e) =>
                    updateTerminal(
                      "fontSize",
                      e.target.value ? Number(e.target.value) : undefined,
                    )
                  }
                />
              </Field>

              <Field label={t("hosts.lineHeightLabel")}>
                <input
                  className={inputClass}
                  type="number"
                  min={0.8}
                  max={2}
                  step={0.05}
                  value={terminal.lineHeight ?? ""}
                  placeholder={inheritLabel}
                  onChange={(e) =>
                    updateTerminal(
                      "lineHeight",
                      e.target.value ? Number(e.target.value) : undefined,
                    )
                  }
                />
              </Field>

              <Field label={t("hosts.cursorStyleLabel")}>
                <select
                  className={inputClass}
                  value={terminal.cursorStyle ?? ""}
                  onChange={(e) =>
                    updateTerminal(
                      "cursorStyle",
                      (e.target.value || undefined) as
                        TerminalDefaults["cursorStyle"] | undefined,
                    )
                  }
                >
                  <option value="">{inheritLabel}</option>
                  {CURSOR_STYLES.map((style) => (
                    <option key={style.value} value={style.value}>
                      {t(style.labelKey)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={t("hosts.scrollbackBufferLabel")}>
                <input
                  className={inputClass}
                  type="number"
                  min={1000}
                  max={100000}
                  step={1000}
                  value={terminal.scrollback ?? ""}
                  placeholder={inheritLabel}
                  onChange={(e) =>
                    updateTerminal(
                      "scrollback",
                      e.target.value ? Number(e.target.value) : undefined,
                    )
                  }
                />
              </Field>

              <div className="sm:col-span-2">
                <SettingRow
                  label={t("hosts.cursorBlinking")}
                  description={t("hosts.cursorBlinkingDesc")}
                >
                  <TriStateSelect
                    value={terminal.cursorBlink}
                    onChange={(value) => updateTerminal("cursorBlink", value)}
                  />
                </SettingRow>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-3 border-t border-border">
            <Button variant="ghost" size="sm" onClick={() => setTerminal({})}>
              {t("terminalDefaults.clearAll")}
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button size="sm" onClick={apply}>
                {t("terminalDefaults.apply")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
