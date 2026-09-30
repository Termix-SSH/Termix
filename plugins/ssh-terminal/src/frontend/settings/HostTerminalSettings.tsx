import { useMemo, useState, useEffect } from "react";
import { setThemePreview } from "../look/theme-preview";
import { Info, Palette, X, Zap } from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  FakeSwitch,
  HostDefaultBadge,
  Input,
  SectionCard,
  Select2,
  SettingRow,
  Slider,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@termix/plugin-sdk/ui";
import {
  useSettings,
  useTranslation,
  type HostEditorSectionProps,
} from "@termix/plugin-sdk/frontend";
import { TerminalPreview } from "../look/TerminalPreview";
import {
  TERMINAL_THEMES,
  TERMINAL_FONTS,
  BELL_STYLES,
  FAST_SCROLL_MODIFIERS,
  CURSOR_STYLES,
} from "../look/terminal-themes";
import {
  TERMINAL_FONT_ZOOM_MIN,
  TERMINAL_FONT_ZOOM_MAX,
} from "../look/terminal-font-zoom";
import {
  readHostTerminalSettings,
  readUserSettings,
  type BackspaceMode,
  type BellStyle,
  type CursorStyle,
  type FastScrollModifier,
  type HostTerminalSettings as HostTerminalValues,
  type SavedCustomTheme,
} from "../../shared/terminal-settings";
import { invalidateTerminalClientSettings } from "../terminal-settings";

const PLUGIN_ID = "ssh-terminal";
const CUSTOM_FONT_OPTION = "__custom__";

type HostPluginSettings = Record<string, Record<string, unknown>>;

/**
 * The host editor's terminal appearance and behavior cards. The values are
 * this plugin's host settings, kept on the editor form under pluginSettings
 * and saved with the host.
 */
export function HostTerminalSettings({
  form: editorForm,
  updateForm,
}: Pick<HostEditorSectionProps, "form" | "setField" | "updateForm" | "host">) {
  const { t } = useTranslation();
  const userSettings = useSettings("user");
  // The preview ends when the editor section goes away.
  useEffect(() => () => setThemePreview(null), []);

  const stored = ((editorForm?.pluginSettings as HostPluginSettings)?.[
    PLUGIN_ID
  ] ?? {}) as Record<string, unknown>;
  // The form holds what the host follows, so this is what it will look like.
  const form = readHostTerminalSettings(stored) as HostTerminalValues;

  const writeValues = (values: Record<string, unknown>) =>
    updateForm((current) => {
      const all = (current.pluginSettings ?? {}) as HostPluginSettings;
      return {
        ...current,
        pluginSettings: {
          ...all,
          [PLUGIN_ID]: { ...(all[PLUGIN_ID] ?? {}), ...values },
        },
      };
    });

  const setField = <K extends keyof HostTerminalValues>(
    key: K,
    value: HostTerminalValues[K],
  ) => writeValues({ [key]: value });

  const [isCustomFont, setIsCustomFont] = useState(
    () => !TERMINAL_FONTS.some((f) => f.value === form.fontFamily),
  );
  const savedThemes: SavedCustomTheme[] = useMemo(
    () => readUserSettings(userSettings.values).customThemes,
    [userSettings.values],
  );
  const [savingTheme, setSavingTheme] = useState(false);

  const saveThemes = async (updated: SavedCustomTheme[]) => {
    await userSettings.save({ customThemes: updated });
    invalidateTerminalClientSettings();
  };

  const handleSaveAsGlobalTheme = async () => {
    const colors = form.customThemeColors;
    if (!colors) return;
    const name = window.prompt(t("hosts.saveGlobalThemeNamePrompt"));
    if (!name || !name.trim()) return;
    setSavingTheme(true);
    try {
      await saveThemes([
        ...savedThemes,
        {
          id:
            "theme-" +
            Date.now() +
            "-" +
            Math.random().toString(36).slice(2, 8),
          name: name.trim(),
          colors,
        },
      ]);
      toast.success(t("hosts.saveGlobalThemeSuccess"));
    } catch {
      toast.error(t("hosts.saveGlobalThemeError"));
    } finally {
      setSavingTheme(false);
    }
  };

  const handleDeleteGlobalTheme = async (id: string) => {
    try {
      await saveThemes(savedThemes.filter((theme) => theme.id !== id));
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
          <>
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
                <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("hosts.colorTheme")}
                  <HostDefaultBadge settingKey="theme" />
                </label>
                <Select2
                  value={form.theme}
                  onChange={(e) => {
                    const newTheme = e.target.value;
                    setField("theme", newTheme);
                    setThemePreview(newTheme);
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
                  <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.fontFamilyLabel")}
                    <HostDefaultBadge settingKey="fontFamily" />
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
                  <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.fontSizeLabel")}
                    <HostDefaultBadge settingKey="fontSize" />
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
                <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("hosts.cursorStyleLabel")}
                  <HostDefaultBadge settingKey="cursorStyle" />
                </label>
                <Select2
                  value={form.cursorStyle}
                  onChange={(e) =>
                    setField("cursorStyle", e.target.value as CursorStyle)
                  }
                  className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                >
                  {CURSOR_STYLES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {t(s.labelKey)}
                    </option>
                  ))}
                </Select2>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.letterSpacingPx")}
                    <HostDefaultBadge settingKey="letterSpacing" />
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
                  <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.lineHeightLabel")}
                    <HostDefaultBadge settingKey="lineHeight" />
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
                <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("hosts.bellStyleLabel")}
                  <HostDefaultBadge settingKey="bellStyle" />
                </label>
                <Select2
                  value={form.bellStyle}
                  onChange={(e) =>
                    setField("bellStyle", e.target.value as BellStyle)
                  }
                  className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                >
                  {BELL_STYLES.map((b) => (
                    <option key={b.value} value={b.value}>
                      {t(b.labelKey)}
                    </option>
                  ))}
                </Select2>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("hosts.backspaceModeLabel")}
                  <HostDefaultBadge settingKey="backspaceMode" />
                </label>
                <Select2
                  value={form.backspaceMode}
                  onChange={(e) =>
                    setField("backspaceMode", e.target.value as BackspaceMode)
                  }
                  className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="normal">
                    {t("hosts.backspaceModeNormal")}
                  </option>
                  <option value="control-h">
                    {t("hosts.backspaceModeControlH")}
                  </option>
                </Select2>
              </div>
            </div>
          </>
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
                <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("hosts.customThemeColors")}
                  <HostDefaultBadge settingKey="customThemeColors" />
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
            defaultKey="cursorBlink"
            description={t("hosts.cursorBlinkingDesc")}
          >
            <FakeSwitch
              checked={form.cursorBlink}
              onChange={(v) => setField("cursorBlink", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.rightClickSelectsWordLabel")}
            defaultKey="rightClickSelectsWord"
            description={t("hosts.rightClickSelectsWordShortDesc")}
          >
            <FakeSwitch
              checked={form.rightClickSelectsWord}
              onChange={(v) => setField("rightClickSelectsWord", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.macOptionIsMetaLabel")}
            defaultKey="macOptionIsMeta"
            description={t("hosts.macOptionIsMetaShortDesc")}
          >
            <FakeSwitch
              checked={form.macOptionIsMeta}
              onChange={(v) => setField("macOptionIsMeta", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.syntaxHighlightingLabel")}
            defaultKey="syntaxHighlighting"
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
                  defaultKey="syntaxHighlightingOptions"
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
            <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.backgroundImageLabel")}
              <HostDefaultBadge settingKey="backgroundImage" />
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
                <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("hosts.backgroundImageOpacityLabel")}
                  <HostDefaultBadge settingKey="backgroundImageOpacity" />
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
              <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.scrollbackBufferLabel")}
                <HostDefaultBadge settingKey="scrollback" />
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
            defaultKey="autoTmux"
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
            label={t("hosts.useSSHTitleLabel")}
            defaultKey="useSSHTitle"
            description={t("hosts.useSSHTitleDesc")}
          >
            <FakeSwitch
              checked={form.useSSHTitle}
              onChange={(v) => setField("useSSHTitle", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.enableAutoMosh")}
            defaultKey="autoMosh"
            description={t("hosts.enableAutoMoshDesc")}
          >
            <FakeSwitch
              checked={form.autoMosh}
              onChange={(v) => setField("autoMosh", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.passwordPromptAutoFillLabel")}
            defaultKey="passwordPromptAutoFill"
            description={t("hosts.passwordPromptAutoFillDesc")}
          >
            <FakeSwitch
              checked={form.passwordPromptAutoFill}
              onChange={(v) => setField("passwordPromptAutoFill", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.sudoPasswordAutoFillLabel")}
            defaultKey="sudoPasswordAutoFill"
            description={t("hosts.sudoPasswordAutoFillDesc")}
          >
            <FakeSwitch
              checked={form.sudoPasswordAutoFill}
              onChange={(v) => setField("sudoPasswordAutoFill", v)}
            />
          </SettingRow>
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.localEchoLabel")}
              <HostDefaultBadge settingKey="localEcho" />
            </label>
            <Select2
              value={form.localEcho}
              onChange={(e) =>
                setField("localEcho", e.target.value as "off" | "auto" | "on")
              }
              className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
            >
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
            <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.linkClickBehaviorLabel")}
              <HostDefaultBadge settingKey="linkClickBehavior" />
            </label>
            <Select2
              value={form.linkClickBehavior}
              onChange={(e) =>
                setField(
                  "linkClickBehavior",
                  e.target.value as "confirm" | "direct",
                )
              }
              className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
            >
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-border pt-4">
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.fastScrollModifierLabel")}
                <HostDefaultBadge settingKey="fastScrollModifier" />
              </label>
              <Select2
                value={form.fastScrollModifier}
                onChange={(e) =>
                  setField(
                    "fastScrollModifier",
                    e.target.value as FastScrollModifier,
                  )
                }
                className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
              >
                {FAST_SCROLL_MODIFIERS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {t(m.labelKey)}
                  </option>
                ))}
              </Select2>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("hosts.fastScrollSensitivityLabel")}
                  <HostDefaultBadge settingKey="fastScrollSensitivity" />
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
              <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.moshCommandLabel")}
                <HostDefaultBadge settingKey="moshCommand" />
              </label>
              <Input
                placeholder="mosh"
                value={form.moshCommand}
                onChange={(e) => setField("moshCommand", e.target.value)}
              />
            </div>
          )}
        </div>
      </SectionCard>
    </>
  );
}
