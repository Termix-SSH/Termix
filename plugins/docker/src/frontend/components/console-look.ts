import { useEffect, useState } from "react";
import {
  invokeAction,
  type PluginHostRecord,
} from "@termix/plugin-sdk/frontend";

/** What the SSH terminal's "terminal.resolveTheme" action answers. */
export interface ConsoleLook {
  colors: Record<string, string | undefined> & {
    background: string;
    foreground: string;
  };
  fontFamily: string;
  fontSize: number;
  cursorStyle: "block" | "underline" | "bar";
  cursorBlink: boolean;
  letterSpacing: number;
  lineHeight: number;
  scrollback: number;
}

/** Plain colors, for when the SSH terminal plugin is off. */
export const FALLBACK_CONSOLE_LOOK: ConsoleLook = {
  colors: {
    background: "#0c0d0b",
    foreground: "#fafafa",
    cursor: "#fafafa",
    cursorAccent: "#0c0d0b",
  },
  fontFamily: '"SF Mono", Consolas, "Liberation Mono", monospace',
  fontSize: 14,
  cursorStyle: "bar",
  cursorBlink: true,
  letterSpacing: 0,
  lineHeight: 1,
  scrollback: 10000,
};

/** The look the SSH terminal uses on this host, or plain colors without it. */
export function useConsoleLook(
  host: PluginHostRecord | null | undefined,
  appTheme: string,
): ConsoleLook {
  const [look, setLook] = useState<ConsoleLook>(FALLBACK_CONSOLE_LOOK);
  // The terminal's settings live with the terminal, so it resolves them from
  // the host id.
  const hostId = host?.id;
  useEffect(() => {
    let active = true;
    invokeAction("terminal.resolveTheme", { hostId, appTheme })
      .then((resolved) => {
        if (active) setLook((resolved as ConsoleLook) ?? FALLBACK_CONSOLE_LOOK);
      })
      .catch(() => {
        if (active) setLook(FALLBACK_CONSOLE_LOOK);
      });
    return () => {
      active = false;
    };
  }, [hostId, appTheme]);

  return look;
}
