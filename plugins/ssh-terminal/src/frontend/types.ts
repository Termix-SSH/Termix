/**
 * Host and terminal shapes as the terminal reads them. The plugin keeps its
 * own copy instead of importing core's types; only the fields it uses matter,
 * and the index signatures let the rest of a host record through.
 */

export interface TerminalConfig {
  localEcho?: "default" | "off" | "auto" | "on";
  cursorBlink: boolean;
  cursorStyle: "block" | "underline" | "bar";
  fontSize: number;
  fontFamily: string;
  letterSpacing: number;
  lineHeight: number;
  theme: string;

  scrollback: number;
  bellStyle: "none" | "sound" | "visual" | "both";
  rightClickSelectsWord: boolean;
  macOptionIsMeta: boolean;
  fastScrollModifier: "alt" | "ctrl" | "shift";
  fastScrollSensitivity: number;
  minimumContrastRatio: number;

  backspaceMode: "normal" | "control-h";
  agentForwarding: boolean;
  environmentVariables: Array<{ key: string; value: string }>;
  startupSnippetId: number | null;
  autoMosh: boolean;
  moshCommand: string;
  sudoPasswordAutoFill: boolean;
  sudoPassword?: string | null;
  keepaliveInterval?: number;
  keepaliveCountMax?: number;
  autoTmux: boolean;
  syntaxHighlighting: boolean;
  syntaxHighlightingOptions?: {
    logLevels: boolean;
    paths: boolean;
    timestamps: boolean;
    ipAddresses: boolean;
    urls: boolean;
    numbers: boolean;
  };
  backgroundImage?: string;
  backgroundImageOpacity?: number;
  allowLegacyAlgorithms?: boolean;
  linkClickBehavior?: "confirm" | "direct";
  useSSHTitle?: boolean;
  agentSocketPath?: string;
  agentIdentity?: string;
  customThemeColors?: {
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
  };
}

export type HostBackspaceMode = TerminalConfig["backspaceMode"];

/** A host as the shell hands it to a tab. */
export interface Host {
  id: number | string;
  name?: string;
  ip: string;
  port: number;
  username: string;
  terminalConfig?: Partial<TerminalConfig> | null;
  pluginSettings?: Record<string, Record<string, unknown>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/** Enough of a snippet for the variables dialog. */
export interface Snippet {
  id: number;
  name: string;
  content: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export type TabType = string;
