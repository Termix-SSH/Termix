import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Info, Palette, Plus, X, Zap } from "lucide-react";
import { toast } from "sonner";
import { Select2 } from "@/components/select2";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { Slider } from "@/components/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/tooltip";
import { SectionCard, SettingRow, FakeSwitch } from "@/components/section-card";
import { TerminalPreview } from "@/components/terminal-preview/TerminalPreview";
import {
  TERMINAL_THEMES,
  TERMINAL_FONTS,
  BELL_STYLES,
  FAST_SCROLL_MODIFIERS,
  CURSOR_STYLES,
} from "@/lib/terminal-themes";
import {
  TERMINAL_FONT_ZOOM_MIN,
  TERMINAL_FONT_ZOOM_MAX,
} from "@/lib/terminal-look/terminal-font-zoom";
import {
  getUserPreferences,
  saveUserPreferences,
  parseCustomThemes,
  type SavedCustomTheme,
} from "@/api/open-tabs-api";
import { useTabsSafe } from "@/shell/TabContext";
import type {
  HostBackspaceMode,
  HostBellStyle,
  HostCursorStyle,
  HostEditorForm,
  HostFastScrollModifier,
} from "./HostEditorData";

const CUSTOM_FONT_OPTION = "__custom__";

export interface HostTerminalSettingsProps {
  // The host editor form, as handed to a host editor section.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any;
  setField: (key: string, value: unknown) => void;
  snippets?: unknown[];
}

/** The host editor's terminal appearance and behavior cards. */
export function HostTerminalSettings({
  form: rawForm,
  setField: rawSetField,
  snippets: rawSnippets,
}: HostTerminalSettingsProps) {
  const { t } = useTranslation();
  const form = rawForm as HostEditorForm;
  const setField = rawSetField as <K extends keyof HostEditorForm>(
    key: K,
    value: HostEditorForm[K],
  ) => void;
  const snippets = (rawSnippets ?? []) as { id: number; name: string }[];
  const { setPreviewTerminalTheme } = useTabsSafe();
  const [isCustomFont, setIsCustomFont] = useState(
    () => !TERMINAL_FONTS.some((f) => f.value === form.fontFamily),
  );
  const [savedThemes, setSavedThemes] = useState<SavedCustomTheme[]>([]);
  const [savingTheme, setSavingTheme] = useState(false);

  useEffect(() => {
    getUserPreferences()
      .then((prefs) => setSavedThemes(parseCustomThemes(prefs.customThemes)))
      .catch(() => {});
  }, []);

  const handleSaveAsGlobalTheme = async () => {
    const colors = form.customThemeColors;
    if (!colors) return;
    const name = window.prompt(t("hosts.saveGlobalThemeNamePrompt"));
    if (!name || !name.trim()) return;
    setSavingTheme(true);
    try {
      const newTheme: SavedCustomTheme = {
        id: `theme-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: name.trim(),
        colors,
      };
      const updated = [...savedThemes, newTheme];
      await saveUserPreferences({
        customThemes: JSON.stringify(updated),
      });
      setSavedThemes(updated);
      toast.success(t("hosts.saveGlobalThemeSuccess"));
    } catch {
      toast.error(t("hosts.saveGlobalThemeError"));
    } finally {
      setSavingTheme(false);
    }
  };

  const handleDeleteGlobalTheme = async (id: string) => {
    const updated = savedThemes.filter((theme) => theme.id !== id);
    try {
      await saveUserPreferences({
        customThemes: JSON.stringify(updated),
      });
      setSavedThemes(updated);
    } catch {
      toast.error(t("hosts.saveGlobalThemeError"));
    }
  };

  const handleApplyGlobalTheme = (id: string) => {
    const theme = savedThemes.find((entry) => entry.id === id);
    if (!theme) return;
    setField("customThemeColors", { ...theme.colors });
  };

  return (
    <>
      <SectionCard
        title={t("hosts.terminalAppearance")}
        icon={<Palette className="size-3.5" />}
      >
        <div className="flex flex-col gap-4 py-3">
          <SettingRow
            label={t("hosts.useUserDefaults", {
              defaultValue: "Use user defaults",
            })}
            description={t("hosts.useUserTerminalDefaultsDesc", {
              defaultValue:
                "Keep this host synchronized with Terminal defaults from User Profile.",
            })}
          >
            <FakeSwitch
              checked={form.inheritTerminalAppearance}
              onChange={(value) => setField("inheritTerminalAppearance", value)}
            />
          </SettingRow>
          <fieldset
            disabled={form.inheritTerminalAppearance}
            className={
              form.inheritTerminalAppearance
                ? "contents opacity-60"
                : "contents"
            }
          >
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.themePreview")}
              </label>
              <TerminalPreview
                theme={form.theme}
                fontSize={form.fontSize}
                fontFamily={form.fontFamily}
                cursorStyle={form.cursorStyle}
                cursorBlink={form.cursorBlink}
                letterSpacing={form.letterSpacing}
                lineHeight={form.lineHeight}
                customThemeColors={form.customThemeColors ?? undefined}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("hosts.colorTheme")}
                </label>
                <Select2
                  value={form.theme}
                  onChange={(e) => {
                    const newTheme = e.target.value;
                    setField("theme", newTheme);
                    setPreviewTerminalTheme(newTheme);
                    if (newTheme === "custom" && !form.customThemeColors) {
                      setField("customThemeColors", {
                        ...TERMINAL_THEMES.termixDark.colors,
                      });
                    }
                  }}
                  className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                >
                  {Object.entries(TERMINAL_THEMES)
                    .filter(
                      ([key]) => key !== "termixDark" && key !== "termixLight",
                    )
                    .map(([key, theme]) => (
                      <option key={key} value={key}>
                        {theme.name}
                      </option>
                    ))}
                </Select2>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.fontFamilyLabel")}
                  </label>
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="size-3 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {t("hosts.fontFamilyCustomHint")}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <Select2
                  value={isCustomFont ? CUSTOM_FONT_OPTION : form.fontFamily}
                  onChange={(e) => {
                    if (e.target.value === CUSTOM_FONT_OPTION) {
                      setIsCustomFont(true);
                      setField("fontFamily", "");
                    } else {
                      setIsCustomFont(false);
                      setField("fontFamily", e.target.value);
                    }
                  }}
                  className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring font-mono"
                >
                  {TERMINAL_FONTS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                  <option value={CUSTOM_FONT_OPTION}>
                    {t("hosts.fontFamilyCustomOption")}
                  </option>
                </Select2>
                {isCustomFont && (
                  <Input
                    value={form.fontFamily}
                    onChange={(e) => setField("fontFamily", e.target.value)}
                    placeholder={t("hosts.fontFamilyCustomPlaceholder")}
                    className="h-9 text-xs font-mono"
                  />
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.fontSizeLabel")}
                  </label>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {form.fontSize}px
                  </span>
                </div>
                <Slider
                  min={TERMINAL_FONT_ZOOM_MIN}
                  max={TERMINAL_FONT_ZOOM_MAX}
                  step={1}
                  value={[form.fontSize]}
                  onValueChange={([v]) => setField("fontSize", v)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("hosts.cursorStyleLabel")}
                </label>
                <Select2
                  value={form.cursorStyle}
                  onChange={(e) =>
                    setField("cursorStyle", e.target.value as HostCursorStyle)
                  }
                  className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                >
                  {CURSOR_STYLES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select2>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.letterSpacingPx")}
                  </label>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {form.letterSpacing}px
                  </span>
                </div>
                <Slider
                  min={-2}
                  max={10}
                  step={0.5}
                  value={[form.letterSpacing]}
                  onValueChange={([v]) => setField("letterSpacing", v)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.lineHeightLabel")}
                  </label>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {form.lineHeight.toFixed(1)}
                  </span>
                </div>
                <Slider
                  min={1.0}
                  max={2.0}
                  step={0.1}
                  value={[form.lineHeight]}
                  onValueChange={([v]) => setField("lineHeight", v)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("hosts.bellStyleLabel")}
                </label>
                <Select2
                  value={form.bellStyle}
                  onChange={(e) =>
                    setField("bellStyle", e.target.value as HostBellStyle)
                  }
                  className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                >
                  {BELL_STYLES.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                    </option>
                  ))}
                </Select2>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("hosts.backspaceModeLabel")}
                </label>
                <Select2
                  value={form.backspaceMode}
                  onChange={(e) =>
                    setField(
                      "backspaceMode",
                      e.target.value as HostBackspaceMode,
                    )
                  }
                  className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="normal">Normal (DEL)</option>
                  <option value="control-h">Control-H (BS)</option>
                </Select2>
              </div>
            </div>
          </fieldset>
          {form.theme === "custom" && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.savedThemesLabel")}
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-[10px]"
                    disabled={savingTheme || !form.customThemeColors}
                    onClick={handleSaveAsGlobalTheme}
                  >
                    {t("hosts.saveAsGlobalTheme")}
                  </Button>
                </div>
                {savedThemes.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground">
                    {t("hosts.noSavedThemes")}
                  </p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {savedThemes.map((theme) => (
                      <div
                        key={theme.id}
                        className="flex items-center justify-between gap-2 border border-border px-2 py-1"
                      >
                        <button
                          type="button"
                          title={t("hosts.applyGlobalThemeTooltip")}
                          onClick={() => handleApplyGlobalTheme(theme.id)}
                          className="flex items-center gap-2 text-xs text-left flex-1 min-w-0 hover:text-foreground transition-colors"
                        >
                          <span
                            className="size-3.5 shrink-0 border border-border"
                            style={{
                              background: theme.colors.background,
                            }}
                          />
                          <span className="truncate">{theme.name}</span>
                        </button>
                        <button
                          type="button"
                          title={t("hosts.deleteGlobalThemeTooltip")}
                          onClick={() => handleDeleteGlobalTheme(theme.id)}
                          className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("hosts.customThemeColors")}
                </label>
                <button
                  type="button"
                  title={t("hosts.customThemeResetTooltip")}
                  onClick={() =>
                    setField("customThemeColors", {
                      ...TERMINAL_THEMES.termixDark.colors,
                    })
                  }
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("hosts.customThemeResetTooltip")}
                </button>
              </div>
              {(
                [
                  ["background", "customThemeBackground"],
                  ["foreground", "customThemeForeground"],
                  ["cursor", "customThemeCursor"],
                  ["cursorAccent", "customThemeCursorAccent"],
                  ["selectionBackground", "customThemeSelection"],
                ] as const
              ).map(([key, labelKey]) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-2"
                >
                  <label className="text-xs text-muted-foreground min-w-0 flex-1">
                    {t(`hosts.${labelKey}`)}
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="color"
                      value={
                        form.customThemeColors?.[key] ??
                        TERMINAL_THEMES.termixDark.colors[key]
                      }
                      onChange={(e) =>
                        setField("customThemeColors", {
                          ...(form.customThemeColors ??
                            TERMINAL_THEMES.termixDark.colors),
                          [key]: e.target.value,
                        })
                      }
                      className="h-7 w-10 cursor-pointer border border-border bg-background p-0.5"
                    />
                    <span className="text-[10px] font-mono text-muted-foreground w-16 tabular-nums">
                      {form.customThemeColors?.[key] ??
                        TERMINAL_THEMES.termixDark.colors[key]}
                    </span>
                  </div>
                </div>
              ))}
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mt-1">
                {t("hosts.customThemeAnsiColors")}
              </label>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {(
                  [
                    ["black", "customThemeBlack"],
                    ["brightBlack", "customThemeBrightBlack"],
                    ["red", "customThemeRed"],
                    ["brightRed", "customThemeBrightRed"],
                    ["green", "customThemeGreen"],
                    ["brightGreen", "customThemeBrightGreen"],
                    ["yellow", "customThemeYellow"],
                    ["brightYellow", "customThemeBrightYellow"],
                    ["blue", "customThemeBlue"],
                    ["brightBlue", "customThemeBrightBlue"],
                    ["magenta", "customThemeMagenta"],
                    ["brightMagenta", "customThemeBrightMagenta"],
                    ["cyan", "customThemeCyan"],
                    ["brightCyan", "customThemeBrightCyan"],
                    ["white", "customThemeWhite"],
                    ["brightWhite", "customThemeBrightWhite"],
                  ] as const
                ).map(([key, labelKey]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-2"
                  >
                    <label className="text-xs text-muted-foreground min-w-0 flex-1 truncate">
                      {t(`hosts.${labelKey}`)}
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={
                          form.customThemeColors?.[key] ??
                          TERMINAL_THEMES.termixDark.colors[key]
                        }
                        onChange={(e) =>
                          setField("customThemeColors", {
                            ...(form.customThemeColors ??
                              TERMINAL_THEMES.termixDark.colors),
                            [key]: e.target.value,
                          })
                        }
                        className="h-7 w-10 cursor-pointer border border-border bg-background p-0.5"
                      />
                      <span className="text-[10px] font-mono text-muted-foreground w-16 tabular-nums">
                        {form.customThemeColors?.[key] ??
                          TERMINAL_THEMES.termixDark.colors[key]}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <SettingRow
            label={t("hosts.cursorBlinking")}
            description={t("hosts.cursorBlinkingDesc")}
          >
            <FakeSwitch
              checked={form.cursorBlink}
              onChange={(v) => setField("cursorBlink", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.rightClickSelectsWordLabel")}
            description={t("hosts.rightClickSelectsWordShortDesc")}
          >
            <FakeSwitch
              checked={form.rightClickSelectsWord}
              onChange={(v) => setField("rightClickSelectsWord", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.macOptionIsMetaLabel")}
            description={t("hosts.macOptionIsMetaShortDesc")}
          >
            <FakeSwitch
              checked={form.macOptionIsMeta}
              onChange={(v) => setField("macOptionIsMeta", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.syntaxHighlightingLabel")}
            description={t("hosts.syntaxHighlightingDesc")}
          >
            <FakeSwitch
              checked={form.syntaxHighlighting}
              onChange={(v) => setField("syntaxHighlighting", v)}
            />
          </SettingRow>
          {form.syntaxHighlighting && (
            <div className="flex flex-col ml-4">
              {(
                [
                  [
                    "logLevels",
                    "syntaxCategoryLogLevels",
                    "syntaxCategoryLogLevelsDesc",
                  ],
                  ["paths", "syntaxCategoryPaths", "syntaxCategoryPathsDesc"],
                  [
                    "timestamps",
                    "syntaxCategoryTimestamps",
                    "syntaxCategoryTimestampsDesc",
                  ],
                  [
                    "ipAddresses",
                    "syntaxCategoryIpAddresses",
                    "syntaxCategoryIpAddressesDesc",
                  ],
                  ["urls", "syntaxCategoryUrls", "syntaxCategoryUrlsDesc"],
                  [
                    "numbers",
                    "syntaxCategoryNumbers",
                    "syntaxCategoryNumbersDesc",
                  ],
                ] as const
              ).map(([key, labelKey, descKey]) => (
                <SettingRow
                  key={key}
                  label={t(`hosts.${labelKey}`)}
                  description={t(`hosts.${descKey}`)}
                >
                  <FakeSwitch
                    checked={form.syntaxHighlightingOptions?.[key] ?? true}
                    onChange={(v) =>
                      setField("syntaxHighlightingOptions", {
                        ...form.syntaxHighlightingOptions,
                        [key]: v,
                      })
                    }
                  />
                </SettingRow>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.backgroundImageLabel")}
            </label>
            <p className="text-[10px] text-muted-foreground">
              {t("hosts.backgroundImageDesc")}
            </p>
            <input
              type="url"
              value={form.backgroundImage}
              onChange={(e) => setField("backgroundImage", e.target.value)}
              placeholder="https://example.com/image.jpg"
              className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring font-mono"
            />
          </div>
          {form.backgroundImage && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("hosts.backgroundImageOpacityLabel")}
                </label>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {Math.round(form.backgroundImageOpacity * 100)}%
                </span>
              </div>
              <Slider
                min={0.05}
                max={1}
                step={0.05}
                value={[form.backgroundImageOpacity]}
                onValueChange={([v]) => setField("backgroundImageOpacity", v)}
              />
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title={t("hosts.behaviorAndAdvanced")}
        icon={<Zap className="size-3.5" />}
      >
        <div className="flex flex-col gap-4 py-3">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.scrollbackBufferLabel")}
              </label>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {form.scrollback.toLocaleString()}{" "}
                {t("hosts.scrollbackMaxLines")}
              </span>
            </div>
            <Slider
              min={1000}
              max={100000}
              step={1000}
              value={[form.scrollback]}
              onValueChange={([v]) => setField("scrollback", v)}
            />
          </div>
          <SettingRow
            label={t("hosts.enableAutoTmux")}
            description={
              <>
                {t("hosts.enableAutoTmuxDesc")}{" "}
                <a
                  href="https://docs.termix.site/features/terminal/tmux"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent-brand hover:underline"
                >
                  {t("hosts.docsLink")}
                </a>
              </>
            }
          >
            <FakeSwitch
              checked={form.autoTmux}
              onChange={(v) => setField("autoTmux", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.sshAgentForwardingLabel")}
            description={t("hosts.sshAgentForwardingShortDesc")}
          >
            <FakeSwitch
              checked={form.agentForwarding}
              onChange={(v) => setField("agentForwarding", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.useSSHTitleLabel")}
            description={t("hosts.useSSHTitleDesc")}
          >
            <FakeSwitch
              checked={form.useSSHTitle}
              onChange={(v) => setField("useSSHTitle", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.enableAutoMosh")}
            description={t("hosts.enableAutoMoshDesc")}
          >
            <FakeSwitch
              checked={form.autoMosh}
              onChange={(v) => setField("autoMosh", v)}
            />
          </SettingRow>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.localEchoLabel")}
            </label>
            <Select2
              value={form.localEcho}
              onChange={(e) =>
                setField(
                  "localEcho",
                  e.target.value as "default" | "off" | "auto" | "on",
                )
              }
              className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="default">{t("hosts.localEchoDefault")}</option>
              <option value="off">{t("hosts.localEchoOff")}</option>
              <option value="auto">{t("hosts.localEchoAuto")}</option>
              <option value="on">{t("hosts.localEchoOn")}</option>
            </Select2>
            <p className="text-[10px] text-muted-foreground">
              {t("hosts.localEchoDesc")}{" "}
              <a
                href="https://docs.termix.site/features/terminal/appearance"
                target="_blank"
                rel="noreferrer"
                className="text-accent-brand hover:underline"
              >
                {t("hosts.docsLink")}
              </a>
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.linkClickBehaviorLabel")}
            </label>
            <Select2
              value={form.linkClickBehavior}
              onChange={(e) =>
                setField(
                  "linkClickBehavior",
                  e.target.value as "default" | "confirm" | "direct",
                )
              }
              className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="default">
                {t("hosts.linkClickBehaviorDefault")}
              </option>
              <option value="confirm">
                {t("hosts.linkClickBehaviorConfirm")}
              </option>
              <option value="direct">
                {t("hosts.linkClickBehaviorDirect")}
              </option>
            </Select2>
            <p className="text-[10px] text-muted-foreground">
              {t("hosts.linkClickBehaviorDesc")}
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.environmentVariablesLabel")}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] px-2 border-accent-brand/40 text-accent-brand"
                onClick={() =>
                  setField("environmentVariables", [
                    ...form.environmentVariables,
                    { key: "", value: "" },
                  ])
                }
              >
                <Plus className="size-3 mr-1" /> {t("hosts.addVariableBtn")}
              </Button>
            </div>
            {form.environmentVariables.length === 0 && (
              <p className="text-[10px] text-muted-foreground/50">
                {t("hosts.noEnvVars")}
              </p>
            )}
            <div className="flex flex-col gap-2">
              {form.environmentVariables.map((ev, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    className="h-7 text-xs flex-1"
                    placeholder="KEY"
                    value={ev.key}
                    onChange={(e) => {
                      const updated = [...form.environmentVariables];
                      updated[i] = {
                        ...updated[i],
                        key: e.target.value,
                      };
                      setField("environmentVariables", updated);
                    }}
                  />
                  <Input
                    className="h-7 text-xs flex-1"
                    placeholder="VALUE"
                    value={ev.value}
                    onChange={(e) => {
                      const updated = [...form.environmentVariables];
                      updated[i] = {
                        ...updated[i],
                        value: e.target.value,
                      };
                      setField("environmentVariables", updated);
                    }}
                  />
                  <button
                    className="text-destructive"
                    onClick={() =>
                      setField(
                        "environmentVariables",
                        form.environmentVariables.filter((_, idx) => idx !== i),
                      )
                    }
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-border pt-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.fastScrollModifierLabel")}
              </label>
              <Select2
                value={form.fastScrollModifier}
                onChange={(e) =>
                  setField(
                    "fastScrollModifier",
                    e.target.value as HostFastScrollModifier,
                  )
                }
                className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
              >
                {FAST_SCROLL_MODIFIERS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select2>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("hosts.fastScrollSensitivityLabel")}
                </label>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {form.fastScrollSensitivity}
                </span>
              </div>
              <Slider
                min={1}
                max={10}
                step={1}
                value={[form.fastScrollSensitivity]}
                onValueChange={([v]) => setField("fastScrollSensitivity", v)}
              />
            </div>
          </div>
          {form.autoMosh && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.moshCommandLabel")}
              </label>
              <Input
                placeholder="mosh"
                value={form.moshCommand}
                onChange={(e) => setField("moshCommand", e.target.value)}
              />
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-border pt-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.startupSnippetLabel")}
              </label>
              <Select2
                value={form.startupSnippetId ?? ""}
                onChange={(e) =>
                  setField(
                    "startupSnippetId",
                    e.target.value ? Number(e.target.value) : null,
                  )
                }
                className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">{t("hosts.none")}</option>
                {snippets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select2>
            </div>
          </div>
        </div>
      </SectionCard>
    </>
  );
}
