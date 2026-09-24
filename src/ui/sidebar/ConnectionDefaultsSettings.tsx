import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/dialog";
import { SettingRow } from "@/components/section-card";
import { useConnectionDefaults } from "@/contexts/ConnectionDefaultsContext";
import {
  CURSOR_STYLES,
  TERMINAL_FONTS,
  TERMINAL_THEMES,
} from "@/lib/terminal-themes";
import {
  fromTriState,
  toTriState,
  type TerminalDefaults,
  type TriState,
} from "@/lib/connection-defaults";
import {
  getUserPreferences,
  parseCustomThemes,
  type SavedCustomTheme,
} from "@/api/open-tabs-api";

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
      <option value="inherit">
        {t("newUi.sidebar.connectionDefaults.inherit")}
      </option>
      <option value="on">{t("newUi.sidebar.connectionDefaults.on")}</option>
      <option value="off">{t("newUi.sidebar.connectionDefaults.off")}</option>
    </select>
  );
}

export function ConnectionDefaultsSettings() {
  const { t } = useTranslation();
  const defaults = useConnectionDefaults();
  const [open, setOpen] = useState(false);
  const [terminal, setTerminal] = useState<TerminalDefaults>({});
  const [saving, setSaving] = useState(false);
  const [savedThemes, setSavedThemes] = useState<SavedCustomTheme[]>([]);

  useEffect(() => {
    if (!defaults.ready) return;
    setTerminal(defaults.terminal);
  }, [defaults.ready, defaults.terminal]);

  useEffect(() => {
    if (!open) return;
    getUserPreferences()
      .then((prefs) => setSavedThemes(parseCustomThemes(prefs.customThemes)))
      .catch(() => {});
  }, [open]);

  const configuredCount = useMemo(() => {
    const count = (source: Record<string, unknown>) =>
      Object.values(source).filter((value) => value !== undefined).length;
    return count(defaults.terminal);
  }, [defaults.terminal]);

  const updateTerminal = <K extends keyof TerminalDefaults>(
    key: K,
    value: TerminalDefaults[K],
  ) => setTerminal((current) => ({ ...current, [key]: value }));

  const applySavedTheme = (id: string) => {
    if (!id) return;
    const theme = savedThemes.find((entry) => entry.id === id);
    if (!theme) return;
    setTerminal((current) => ({
      ...current,
      theme: "custom",
      customThemeColors: { ...theme.colors },
    }));
  };

  async function save() {
    setSaving(true);
    try {
      await defaults.saveTerminalDefaults(terminal);
      toast.success(t("newUi.sidebar.connectionDefaults.saved"));
      setOpen(false);
    } catch {
      toast.error(t("newUi.sidebar.connectionDefaults.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  const inheritLabel = t("newUi.sidebar.connectionDefaults.inherit");

  return (
    <>
      <SettingRow
        label={t("newUi.sidebar.connectionDefaults.title")}
        description={t("newUi.sidebar.connectionDefaults.description")}
        badge={configuredCount > 0 ? String(configuredCount) : undefined}
      >
        <Button
          variant="outline"
          size="sm"
          disabled={!defaults.ready}
          onClick={() => setOpen(true)}
        >
          {t("newUi.sidebar.connectionDefaults.manage")}
        </Button>
      </SettingRow>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              {t("newUi.sidebar.connectionDefaults.title")}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("newUi.sidebar.connectionDefaults.dialogDescription")}{" "}
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

              {savedThemes.length > 0 && (
                <Field
                  label={t("newUi.sidebar.connectionDefaults.savedThemeLabel")}
                >
                  <select
                    className={inputClass}
                    value=""
                    onChange={(e) => applySavedTheme(e.target.value)}
                  >
                    <option value="">
                      {t(
                        "newUi.sidebar.connectionDefaults.savedThemePlaceholder",
                      )}
                    </option>
                    {savedThemes.map((theme) => (
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
                      {style.label}
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setTerminal({});
              }}
            >
              {t("newUi.sidebar.connectionDefaults.clearAll")}
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                size="sm"
                disabled={saving || !defaults.ready}
                onClick={save}
              >
                {saving ? t("common.saving") : t("common.save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
