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
  type RemoteDesktopDefaults,
  type TerminalDefaults,
  type TriState,
} from "@/lib/connection-defaults";

const inputClass =
  "h-8 w-full border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring";
const labelClass =
  "text-[10px] font-bold uppercase tracking-widest text-muted-foreground";

const RDP_TOGGLES = [
  ["forceLossless", "hosts.guac.forceLossless", "hosts.guac.forceLosslessDesc"],
  ["enableWallpaper", "hosts.guac.wallpaper", "hosts.guac.wallpaperDesc"],
  [
    "enableFontSmoothing",
    "hosts.guac.fontSmoothing",
    "hosts.guac.fontSmoothingDesc",
  ],
  [
    "enableDesktopComposition",
    "hosts.guac.desktopComposition",
    "hosts.guac.desktopCompositionDesc",
  ],
  ["disableAudio", "hosts.guac.disableAudio", "hosts.guac.disableAudioDesc"],
  [
    "enablePrinting",
    "hosts.guac.enablePrinting",
    "hosts.guac.enablePrintingDesc",
  ],
  [
    "enableDrive",
    "hosts.guac.enableDriveRedirection",
    "hosts.guac.enableDriveRedirectionDesc",
  ],
  ["disableCopy", "hosts.guac.disableCopy", "hosts.guac.disableCopyDesc"],
  ["disablePaste", "hosts.guac.disablePaste", "hosts.guac.disablePasteDesc"],
] as const;

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
  const [tab, setTab] = useState<"terminal" | "rdp">("terminal");
  const [terminal, setTerminal] = useState<TerminalDefaults>({});
  const [rdp, setRdp] = useState<RemoteDesktopDefaults>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!defaults.ready) return;
    setTerminal(defaults.terminal);
    setRdp(defaults.rdp);
  }, [defaults.ready, defaults.terminal, defaults.rdp]);

  const configuredCount = useMemo(() => {
    const count = (source: Record<string, unknown>) =>
      Object.values(source).filter((value) => value !== undefined).length;
    return count(defaults.terminal) + count(defaults.rdp);
  }, [defaults.terminal, defaults.rdp]);

  const updateTerminal = <K extends keyof TerminalDefaults>(
    key: K,
    value: TerminalDefaults[K],
  ) => setTerminal((current) => ({ ...current, [key]: value }));
  const updateRdp = <K extends keyof RemoteDesktopDefaults>(
    key: K,
    value: RemoteDesktopDefaults[K],
  ) => setRdp((current) => ({ ...current, [key]: value }));

  async function save() {
    setSaving(true);
    try {
      await Promise.all([
        defaults.saveDefaults("terminal", terminal),
        defaults.saveDefaults("rdp", rdp),
      ]);
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

          <div className="flex border-b border-border">
            {(
              [
                ["terminal", "newUi.sidebar.connectionDefaults.tabTerminal"],
                ["rdp", "newUi.sidebar.connectionDefaults.tabRemoteDesktop"],
              ] as const
            ).map(([id, labelKey]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
                  tab === id
                    ? "border-accent-brand text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t(labelKey)}
              </button>
            ))}
          </div>

          <div className="max-h-[55vh] overflow-y-auto pr-1">
            {tab === "terminal" ? (
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
                        ([key]) =>
                          key !== "termixDark" && key !== "termixLight",
                      )
                      .map(([key, theme]) => (
                        <option key={key} value={key}>
                          {theme.name}
                        </option>
                      ))}
                  </select>
                </Field>

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
            ) : (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label={t("hosts.guac.colorDepth")}>
                    <select
                      className={inputClass}
                      value={rdp.colorDepth ?? ""}
                      onChange={(e) =>
                        updateRdp(
                          "colorDepth",
                          e.target.value ? Number(e.target.value) : undefined,
                        )
                      }
                    >
                      <option value="">{inheritLabel}</option>
                      <option value="16">16-bit</option>
                      <option value="24">24-bit</option>
                      <option value="32">32-bit</option>
                    </select>
                  </Field>

                  <Field label={t("hosts.guac.resizeMethod")}>
                    <select
                      className={inputClass}
                      value={rdp.resizeMethod ?? ""}
                      onChange={(e) =>
                        updateRdp("resizeMethod", e.target.value || undefined)
                      }
                    >
                      <option value="">{inheritLabel}</option>
                      <option value="display-update">
                        {t(
                          "newUi.sidebar.connectionDefaults.resizeDisplayUpdate",
                        )}
                      </option>
                      <option value="reconnect">
                        {t("newUi.sidebar.connectionDefaults.resizeReconnect")}
                      </option>
                    </select>
                  </Field>
                </div>

                <div>
                  {RDP_TOGGLES.map(([key, labelKey, descriptionKey]) => (
                    <SettingRow
                      key={key}
                      label={t(labelKey)}
                      description={t(descriptionKey)}
                    >
                      <TriStateSelect
                        value={rdp[key] as boolean | undefined}
                        onChange={(value) => updateRdp(key, value)}
                      />
                    </SettingRow>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 pt-3 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setTerminal({});
                setRdp({});
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
