import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { FakeSwitch, SettingRow } from "@/components/section-card";
import { useConnectionDefaults } from "@/contexts/ConnectionDefaultsContext";
import { TERMINAL_FONTS, TERMINAL_THEMES } from "@/lib/terminal-themes";
import type {
  RemoteDesktopDefaults,
  TerminalDefaults,
} from "@/lib/connection-defaults";

const inputClass =
  "h-8 w-full border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring";

export function ConnectionDefaultsSettings() {
  const { t } = useTranslation();
  const defaults = useConnectionDefaults();
  const [terminal, setTerminal] = useState<TerminalDefaults>({});
  const [rdp, setRdp] = useState<RemoteDesktopDefaults>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!defaults.ready) return;
    setTerminal(defaults.terminal);
    setRdp(defaults.rdp);
  }, [defaults.ready, defaults.terminal, defaults.rdp]);

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
      toast.success(
        t("newUi.sidebar.userProfile.connectionDefaultsSaved", {
          defaultValue: "Connection defaults saved",
        }),
      );
    } catch {
      toast.error(
        t("newUi.sidebar.userProfile.connectionDefaultsSaveFailed", {
          defaultValue: "Failed to save connection defaults",
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 border-b border-border py-3">
      <div>
        <div className="text-sm font-medium">
          {t("newUi.sidebar.userProfile.terminalDefaults", {
            defaultValue: "Terminal defaults",
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("newUi.sidebar.userProfile.connectionDefaultsDescription", {
            defaultValue:
              "Hosts inherit these values unless they define an override.",
          })}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("hosts.fontFamilyLabel")}
          <select
            className={inputClass}
            value={terminal.fontFamily ?? ""}
            onChange={(event) =>
              updateTerminal("fontFamily", event.target.value || undefined)
            }
          >
            <option value="">
              {t("common.default", { defaultValue: "Default" })}
            </option>
            {TERMINAL_FONTS.map((font) => (
              <option key={font.value} value={font.value}>
                {font.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("hosts.fontSizeLabel")}
          <input
            className={inputClass}
            type="number"
            min={8}
            max={32}
            value={terminal.fontSize ?? ""}
            placeholder="14"
            onChange={(event) =>
              updateTerminal(
                "fontSize",
                event.target.value ? Number(event.target.value) : undefined,
              )
            }
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("hosts.themeLabel", { defaultValue: "Theme" })}
          <select
            className={inputClass}
            value={terminal.theme ?? ""}
            onChange={(event) =>
              updateTerminal("theme", event.target.value || undefined)
            }
          >
            <option value="">
              {t("common.default", { defaultValue: "Default" })}
            </option>
            <option value="termix">Termix</option>
            {Object.keys(TERMINAL_THEMES).map((theme) => (
              <option key={theme} value={theme}>
                {theme}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("hosts.cursorStyleLabel")}
          <select
            className={inputClass}
            value={terminal.cursorStyle ?? ""}
            onChange={(event) =>
              updateTerminal(
                "cursorStyle",
                (event.target.value || undefined) as
                  TerminalDefaults["cursorStyle"] | undefined,
              )
            }
          >
            <option value="">
              {t("common.default", { defaultValue: "Default" })}
            </option>
            <option value="block">Block</option>
            <option value="bar">Bar</option>
            <option value="underline">Underline</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("hosts.scrollbackBufferLabel")}
          <input
            className={inputClass}
            type="number"
            min={1000}
            max={100000}
            step={1000}
            value={terminal.scrollback ?? ""}
            placeholder="10000"
            onChange={(event) =>
              updateTerminal(
                "scrollback",
                event.target.value ? Number(event.target.value) : undefined,
              )
            }
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("hosts.lineHeightLabel")}
          <input
            className={inputClass}
            type="number"
            min={0.8}
            max={2}
            step={0.05}
            value={terminal.lineHeight ?? ""}
            placeholder="1"
            onChange={(event) =>
              updateTerminal(
                "lineHeight",
                event.target.value ? Number(event.target.value) : undefined,
              )
            }
          />
        </label>
      </div>
      <SettingRow
        label={t("hosts.cursorBlinkLabel", { defaultValue: "Cursor blink" })}
        description=""
      >
        <FakeSwitch
          checked={terminal.cursorBlink ?? true}
          onChange={(value) => updateTerminal("cursorBlink", value)}
        />
      </SettingRow>

      <div className="border-t border-border pt-3">
        <div className="text-sm font-medium">
          {t("newUi.sidebar.userProfile.rdpDefaults", {
            defaultValue: "RDP defaults",
          })}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("hosts.guac.colorDepth")}
          <select
            className={inputClass}
            value={rdp.colorDepth ?? ""}
            onChange={(event) =>
              updateRdp(
                "colorDepth",
                event.target.value ? Number(event.target.value) : undefined,
              )
            }
          >
            <option value="">
              {t("common.default", { defaultValue: "Default" })}
            </option>
            <option value="16">16-bit</option>
            <option value="24">24-bit</option>
            <option value="32">32-bit</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("hosts.guac.resizeMethod")}
          <select
            className={inputClass}
            value={rdp.resizeMethod ?? ""}
            onChange={(event) =>
              updateRdp("resizeMethod", event.target.value || undefined)
            }
          >
            <option value="">
              {t("common.default", { defaultValue: "Default" })}
            </option>
            <option value="display-update">Display update</option>
            <option value="reconnect">Reconnect</option>
          </select>
        </label>
      </div>
      {(
        [
          ["forceLossless", "hosts.guac.forceLossless", "Force lossless"],
          ["enableWallpaper", "hosts.guac.enableWallpaper", "Wallpaper"],
          [
            "enableFontSmoothing",
            "hosts.guac.enableFontSmoothing",
            "Font smoothing",
          ],
          [
            "enableDesktopComposition",
            "hosts.guac.enableDesktopComposition",
            "Desktop composition",
          ],
          ["disableAudio", "hosts.guac.disableAudio", "Disable audio"],
          ["enablePrinting", "hosts.guac.enablePrinting", "Printing"],
          ["enableDrive", "hosts.guac.enableDrive", "Drive redirection"],
          ["disableCopy", "hosts.guac.disableCopy", "Disable copy"],
          ["disablePaste", "hosts.guac.disablePaste", "Disable paste"],
        ] as const
      ).map(([key, label, defaultValue]) => (
        <SettingRow key={key} label={t(label, { defaultValue })} description="">
          <FakeSwitch
            checked={Boolean(rdp[key])}
            onChange={(value) => updateRdp(key, value)}
          />
        </SettingRow>
      ))}

      <div className="flex justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setTerminal({});
            setRdp({});
          }}
        >
          {t("common.reset")}
        </Button>
        <Button size="sm" disabled={saving || !defaults.ready} onClick={save}>
          {saving ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </div>
  );
}
