import type { TerminalTheme } from "@/constants/terminal-themes.ts";
import {
  TERMINAL_THEMES,
  TERMINAL_FONTS,
} from "@/constants/terminal-themes.ts";
import { useTheme } from "@/components/theme-provider.tsx";

interface TerminalPreviewProps {
  theme: string;
  fontSize?: number;
  fontFamily?: string;
  cursorStyle?: "block" | "underline" | "bar";
  cursorBlink?: boolean;
  letterSpacing?: number;
  lineHeight?: number;
}

export function TerminalPreview({
  theme = "termix",
  fontSize = 14,
  fontFamily = "Caskaydia Cove Nerd Font Mono",
  cursorStyle = "bar",
  cursorBlink = true,
  letterSpacing = 0,
  lineHeight = 1.2,
}: TerminalPreviewProps) {
  const { theme: appTheme } = useTheme();

  const resolvedTheme =
    theme === "termix"
      ? appTheme === "dark" ||
        (appTheme === "system" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches)
        ? "termixDark"
        : "termixLight"
      : theme;

  return (
    <div className="border border-input rounded-md overflow-hidden">
      <div
        className="p-4 font-mono text-sm"
        style={{
          fontSize: `${fontSize}px`,
          fontFamily:
            TERMINAL_FONTS.find((f) => f.value === fontFamily)?.fallback ||
            TERMINAL_FONTS[0].fallback,
          letterSpacing: `${letterSpacing}px`,
          lineHeight,
          background:
            TERMINAL_THEMES[resolvedTheme]?.colors.background ||
            "var(--bg-base)",
          color:
            TERMINAL_THEMES[resolvedTheme]?.colors.foreground ||
            "var(--foreground)",
        }}
      >
        <div>
          <span style={{ color: TERMINAL_THEMES[resolvedTheme]?.colors.green }}>
            user@termix
          </span>
          <span>:</span>
          <span style={{ color: TERMINAL_THEMES[resolvedTheme]?.colors.blue }}>
            ~
          </span>
          <span>$ ls -la</span>
        </div>
        <div>
          <span style={{ color: TERMINAL_THEMES[resolvedTheme]?.colors.blue }}>
            drwxr-xr-x
          </span>
          <span> 5 user </span>
          <span style={{ color: TERMINAL_THEMES[resolvedTheme]?.colors.cyan }}>
            docs
          </span>
        </div>
        <div>
          <span style={{ color: TERMINAL_THEMES[resolvedTheme]?.colors.green }}>
            -rwxr-xr-x
          </span>
          <span> 1 user </span>
          <span style={{ color: TERMINAL_THEMES[resolvedTheme]?.colors.green }}>
            script.sh
          </span>
        </div>
        <div>
          <span>-rw-r--r--</span>
          <span> 1 user </span>
          <span>README.md</span>
        </div>
        <div>
          <span style={{ color: TERMINAL_THEMES[resolvedTheme]?.colors.green }}>
            user@termix
          </span>
          <span>:</span>
          <span style={{ color: TERMINAL_THEMES[resolvedTheme]?.colors.blue }}>
            ~
          </span>
          <span>$ </span>
          <span
            className="inline-block"
            style={{
              width: cursorStyle === "block" ? "0.6em" : "0.1em",
              height:
                cursorStyle === "underline"
                  ? "0.15em"
                  : cursorStyle === "bar"
                    ? `${fontSize}px`
                    : `${fontSize}px`,
              background:
                TERMINAL_THEMES[resolvedTheme]?.colors.cursor || "#f7f7f7",
              animation: cursorBlink ? "blink 1s step-end infinite" : "none",
              verticalAlign:
                cursorStyle === "underline" ? "bottom" : "text-bottom",
            }}
          />
        </div>
      </div>
      <style>{`
        @keyframes blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
