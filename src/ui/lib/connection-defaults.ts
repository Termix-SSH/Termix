import type { GuacamoleConfig } from "@/types/guacamole-config";
import type { TerminalConfig } from "@/types";

export type TerminalDefaults = Partial<
  Pick<
    TerminalConfig,
    | "cursorBlink"
    | "cursorStyle"
    | "fontSize"
    | "fontFamily"
    | "letterSpacing"
    | "lineHeight"
    | "theme"
    | "scrollback"
    | "bellStyle"
    | "minimumContrastRatio"
    | "backgroundImage"
    | "backgroundImageOpacity"
    | "customThemeColors"
  >
>;

export type RemoteDesktopDefaults = Partial<GuacamoleConfig>;

function parseObject<T extends object>(value?: string | null): Partial<T> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Partial<T>)
      : {};
  } catch {
    return {};
  }
}

export function parseTerminalDefaults(value?: string | null): TerminalDefaults {
  return parseObject<TerminalDefaults>(value);
}

export function parseRemoteDesktopDefaults(
  value?: string | null,
): RemoteDesktopDefaults {
  return parseObject<RemoteDesktopDefaults>(value);
}

// Booleans have three states in the defaults UI: unset means the host decides.
export type TriState = "inherit" | "on" | "off";

export function toTriState(value?: boolean): TriState {
  if (value === undefined) return "inherit";
  return value ? "on" : "off";
}

export function fromTriState(value: TriState): boolean | undefined {
  if (value === "inherit") return undefined;
  return value === "on";
}

export function resolveConnectionDefaults<T extends object>(
  defaults: Partial<T>,
  overrides?: Partial<T> | null,
): Partial<T> {
  return { ...defaults, ...overrides };
}
