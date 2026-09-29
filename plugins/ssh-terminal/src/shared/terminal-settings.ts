/**
 * The terminal's look and behavior: this plugin's host, user and admin
 * settings, and the 2.8 `terminalConfig` shape they replaced.
 *
 * Shared by the backend (import, the 2.8 host payload) and the frontend (the
 * terminal and the host editor), so both read one list of keys.
 */

export interface TerminalThemeColors {
  background: string;
  foreground: string;
  cursor?: string;
  cursorAccent?: string;
  selectionBackground?: string;
  selectionForeground?: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface SyntaxHighlightingOptions {
  logLevels: boolean;
  paths: boolean;
  timestamps: boolean;
  ipAddresses: boolean;
  urls: boolean;
  numbers: boolean;
}

export type CursorStyle = "block" | "underline" | "bar";
export type BellStyle = "none" | "sound" | "visual" | "both";
export type FastScrollModifier = "alt" | "ctrl" | "shift";
export type BackspaceMode = "normal" | "control-h";
export type HostLocalEcho = "default" | "off" | "auto" | "on";
export type HostLinkClickBehavior = "default" | "confirm" | "direct";

/** How a terminal looks. A host follows the user's defaults unless it opts out. */
export interface TerminalAppearance {
  theme: string;
  cursorBlink: boolean;
  cursorStyle: CursorStyle;
  fontSize: number;
  fontFamily: string;
  scrollback: number;
  letterSpacing: number;
  lineHeight: number;
  bellStyle: BellStyle;
  minimumContrastRatio: number;
  backgroundImage: string;
  backgroundImageOpacity: number;
  customThemeColors: TerminalThemeColors | null;
}

/** How a terminal behaves on one host. Always the host's own. */
export interface TerminalBehavior {
  rightClickSelectsWord: boolean;
  macOptionIsMeta: boolean;
  fastScrollModifier: FastScrollModifier;
  fastScrollSensitivity: number;
  backspaceMode: BackspaceMode;
  autoMosh: boolean;
  moshCommand: string;
  autoTmux: boolean;
  useSSHTitle: boolean;
  syntaxHighlighting: boolean;
  syntaxHighlightingOptions: SyntaxHighlightingOptions;
  linkClickBehavior: HostLinkClickBehavior;
  localEcho: HostLocalEcho;
  passwordPromptAutoFill: boolean;
  sudoPasswordAutoFill: boolean;
}

/** Everything the host editor's Terminal tab edits. */
export interface HostTerminalSettings
  extends TerminalAppearance, TerminalBehavior {
  inheritAppearance: boolean;
}

export const APPEARANCE_KEYS = [
  "theme",
  "cursorBlink",
  "cursorStyle",
  "fontSize",
  "fontFamily",
  "scrollback",
  "letterSpacing",
  "lineHeight",
  "bellStyle",
  "minimumContrastRatio",
  "backgroundImage",
  "backgroundImageOpacity",
  "customThemeColors",
] as const satisfies readonly (keyof TerminalAppearance)[];

export const BEHAVIOR_KEYS = [
  "rightClickSelectsWord",
  "macOptionIsMeta",
  "fastScrollModifier",
  "fastScrollSensitivity",
  "backspaceMode",
  "autoMosh",
  "moshCommand",
  "autoTmux",
  "useSSHTitle",
  "syntaxHighlighting",
  "syntaxHighlightingOptions",
  "linkClickBehavior",
  "localEcho",
  "passwordPromptAutoFill",
  "sudoPasswordAutoFill",
] as const satisfies readonly (keyof TerminalBehavior)[];

export const INHERIT_APPEARANCE_KEY = "inheritAppearance";

export const DEFAULT_MOSH_COMMAND = "mosh-server new -s -l LANG=en_US.UTF-8";
export const DEFAULT_FONT_FAMILY = "Caskaydia Cove Nerd Font Mono";

export const DEFAULT_SYNTAX_HIGHLIGHTING: SyntaxHighlightingOptions = {
  logLevels: true,
  paths: true,
  timestamps: true,
  ipAddresses: true,
  urls: true,
  numbers: true,
};

export const DEFAULT_APPEARANCE: TerminalAppearance = {
  theme: "termix",
  cursorBlink: true,
  cursorStyle: "bar",
  fontSize: 14,
  fontFamily: DEFAULT_FONT_FAMILY,
  scrollback: 10000,
  letterSpacing: 0,
  lineHeight: 1,
  bellStyle: "none",
  minimumContrastRatio: 1,
  backgroundImage: "",
  backgroundImageOpacity: 0.15,
  customThemeColors: null,
};

export const DEFAULT_BEHAVIOR: TerminalBehavior = {
  rightClickSelectsWord: false,
  macOptionIsMeta: false,
  fastScrollModifier: "alt",
  fastScrollSensitivity: 5,
  backspaceMode: "normal",
  autoMosh: false,
  moshCommand: "",
  autoTmux: false,
  useSSHTitle: false,
  syntaxHighlighting: true,
  syntaxHighlightingOptions: DEFAULT_SYNTAX_HIGHLIGHTING,
  linkClickBehavior: "default",
  localEcho: "default",
  passwordPromptAutoFill: true,
  sudoPasswordAutoFill: false,
};

export const DEFAULT_HOST_TERMINAL_SETTINGS: HostTerminalSettings = {
  ...DEFAULT_APPEARANCE,
  ...DEFAULT_BEHAVIOR,
  inheritAppearance: true,
};

/** The user's terminal defaults: any appearance key, unset ones inherit. */
export type TerminalDefaults = Partial<TerminalAppearance>;

export interface SavedCustomTheme {
  id: string;
  name: string;
  colors: TerminalThemeColors;
}

/** The ssh-terminal user settings the terminal reads. */
export interface TerminalUserSettings {
  terminalDefaults: TerminalDefaults;
  customThemes: SavedCustomTheme[];
  commandAutocomplete: boolean;
  localEcho: "off" | "auto" | "on";
  linkClickBehavior: "confirm" | "direct";
}

export const DEFAULT_USER_SETTINGS: TerminalUserSettings = {
  terminalDefaults: {},
  customThemes: [],
  commandAutocomplete: false,
  localEcho: "auto",
  linkClickBehavior: "confirm",
};

/** The admin's defaults for a new host's terminal. */
export interface NewHostTerminalDefaults {
  fontSize: number;
  fontFamily: string;
  theme: string;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  autoTmux: boolean;
}

/** Admin field -> the host field it seeds (manifest defaultFrom). */
export const NEW_HOST_ADMIN_KEYS = {
  newHostFontSize: "fontSize",
  newHostFontFamily: "fontFamily",
  newHostTheme: "theme",
  newHostCursorStyle: "cursorStyle",
  newHostCursorBlink: "cursorBlink",
  newHostAutoTmux: "autoTmux",
} as const satisfies Record<string, keyof NewHostTerminalDefaults>;

const ENUMS: Record<string, readonly string[]> = {
  cursorStyle: ["block", "underline", "bar"],
  bellStyle: ["none", "sound", "visual", "both"],
  fastScrollModifier: ["alt", "ctrl", "shift"],
  backspaceMode: ["normal", "control-h"],
  linkClickBehavior: ["default", "confirm", "direct"],
  localEcho: ["default", "off", "auto", "on"],
};

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** A JSON string or an object as an object, anything else as null. */
export function asObject(value: unknown): Record<string, unknown> | null {
  let parsed = value;
  if (typeof parsed === "string") {
    if (!parsed) return null;
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  return isObject(parsed) ? parsed : null;
}

function finite(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** One key's value, typed, or undefined when it does not fit the key. */
function pick(key: string, value: unknown): unknown {
  if (value === undefined) return undefined;
  if (ENUMS[key]) {
    return typeof value === "string" && ENUMS[key].includes(value)
      ? value
      : undefined;
  }
  switch (key) {
    case "theme":
      if (typeof value !== "string" || !value) return undefined;
      // 2.8 spelled the app-following theme several ways.
      return [
        "Termix Dark",
        "Termix Light",
        "termixDark",
        "termixLight",
      ].includes(value)
        ? "termix"
        : value;
    case "fontFamily":
      return typeof value === "string" && value ? value : undefined;
    case "backgroundImage":
    case "moshCommand":
      return value === null
        ? ""
        : typeof value === "string"
          ? value
          : undefined;
    case "customThemeColors":
      return value === null ? null : isObject(value) ? value : undefined;
    case "syntaxHighlightingOptions":
      return isObject(value)
        ? { ...DEFAULT_SYNTAX_HIGHLIGHTING, ...value }
        : undefined;
    case "fontSize":
    case "scrollback":
    case "letterSpacing":
    case "lineHeight":
    case "minimumContrastRatio":
    case "backgroundImageOpacity":
    case "fastScrollSensitivity":
      return finite(value);
    default:
      return typeof value === "boolean" ? value : undefined;
  }
}

/** The keys of an object that fit, typed, with everything else dropped. */
export function pickTerminalValues(
  source: Record<string, unknown> | null | undefined,
  keys: readonly string[],
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  if (!source) return values;
  for (const key of keys) {
    const value = pick(key, source[key]);
    if (value !== undefined) values[key] = value;
  }
  return values;
}

/**
 * The host settings a 2.8 `terminalConfig` carried: every behavior key it
 * set, and the appearance keys only when it set any, which is also what
 * turns `inheritAppearance` off (2.8 stripped them to follow the user).
 */
export function hostSettingsFromTerminalConfig(
  terminalConfig: unknown,
): Record<string, unknown> {
  const config = asObject(terminalConfig);
  if (!config) return {};
  const behavior = pickTerminalValues(config, BEHAVIOR_KEYS);
  const appearance = pickTerminalValues(config, APPEARANCE_KEYS);
  const values: Record<string, unknown> = { ...behavior };
  if (APPEARANCE_KEYS.some((key) => key in config)) {
    Object.assign(values, appearance, { [INHERIT_APPEARANCE_KEY]: false });
  }
  return values;
}

/** Stored host values over the defaults, each one typed. */
export function readHostTerminalSettings(
  values: Record<string, unknown> | null | undefined,
): HostTerminalSettings {
  const typed = pickTerminalValues(values, [
    ...APPEARANCE_KEYS,
    ...BEHAVIOR_KEYS,
  ]);
  const inherit = values?.[INHERIT_APPEARANCE_KEY];
  return {
    ...DEFAULT_HOST_TERMINAL_SETTINGS,
    ...typed,
    inheritAppearance: typeof inherit === "boolean" ? inherit : true,
  } as HostTerminalSettings;
}

export function readUserSettings(
  values: Record<string, unknown> | null | undefined,
): TerminalUserSettings {
  const source = values ?? {};
  const defaults = asObject(source.terminalDefaults);
  const themes = Array.isArray(source.customThemes)
    ? source.customThemes
    : typeof source.customThemes === "string"
      ? (() => {
          try {
            const parsed = JSON.parse(source.customThemes as string);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })()
      : [];
  return {
    terminalDefaults: pickTerminalValues(
      defaults,
      APPEARANCE_KEYS,
    ) as TerminalDefaults,
    customThemes: themes.filter(
      (theme): theme is SavedCustomTheme =>
        isObject(theme) &&
        typeof theme.id === "string" &&
        typeof theme.name === "string" &&
        isObject(theme.colors),
    ),
    commandAutocomplete: source.commandAutocomplete === true,
    localEcho:
      source.localEcho === "off" || source.localEcho === "on"
        ? source.localEcho
        : "auto",
    linkClickBehavior:
      source.linkClickBehavior === "direct" ? "direct" : "confirm",
  };
}

/**
 * What a terminal on a host runs with: the defaults, then the user's
 * terminal defaults, then the host's own look when it does not follow the
 * user, then the host's behavior.
 */
export function resolveTerminalSettings(
  host: HostTerminalSettings | null | undefined,
  userDefaults: TerminalDefaults = {},
): TerminalAppearance & TerminalBehavior {
  const own = host ?? DEFAULT_HOST_TERMINAL_SETTINGS;
  const appearance: TerminalAppearance = {
    ...DEFAULT_APPEARANCE,
    ...pickTerminalValues(userDefaults, APPEARANCE_KEYS),
  };
  if (!own.inheritAppearance) {
    for (const key of APPEARANCE_KEYS) {
      (appearance as unknown as Record<string, unknown>)[key] = own[key];
    }
  }
  const behavior = {} as TerminalBehavior;
  for (const key of BEHAVIOR_KEYS) {
    (behavior as unknown as Record<string, unknown>)[key] = own[key];
  }
  return { ...appearance, ...behavior };
}

/**
 * The host's settings in the 2.8 `terminalConfig` shape, for clients that
 * still read it (Termix-Mobile). The look is left out while the host follows
 * the user, the way 2.8 stored it.
 */
export function terminalConfigFromHostSettings(
  values: Record<string, unknown>,
): Record<string, unknown> {
  const settings = readHostTerminalSettings(values);
  const config: Record<string, unknown> = {};
  for (const key of BEHAVIOR_KEYS) config[key] = settings[key];
  if (!settings.inheritAppearance) {
    for (const key of APPEARANCE_KEYS) config[key] = settings[key];
  }
  if (config.linkClickBehavior === "default") delete config.linkClickBehavior;
  if (config.localEcho === "default") delete config.localEcho;
  return config;
}
