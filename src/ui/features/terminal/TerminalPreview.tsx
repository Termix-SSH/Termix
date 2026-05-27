import { useTheme } from "@/components/theme-provider";
import { TERMINAL_THEMES, TERMINAL_FONTS } from "@/lib/terminal-themes";

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
  lineHeight = 1.0,
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

  const colors = TERMINAL_THEMES[resolvedTheme]?.colors;
  const fontFallback =
    TERMINAL_FONTS.find((f) => f.value === fontFamily)?.fallback ||
    TERMINAL_FONTS[0].fallback;

  return (
    <div className="border border-input overflow-hidden">
      <div
        className="p-3 font-mono"
        style={{
          fontSize: `${fontSize}px`,
          fontFamily: fontFallback,
          letterSpacing: `${letterSpacing}px`,
          lineHeight,
          background: colors?.background || "var(--bg-base)",
          color: colors?.foreground || "var(--foreground)",
        }}
      >
        <div>
          <span style={{ color: colors?.green }}>deploy@web-01</span>
          <span style={{ color: colors?.brightBlack }}>:</span>
          <span style={{ color: colors?.blue }}>~</span>
          <span style={{ color: colors?.brightBlack }}>$</span>
          <span> ls -la</span>
        </div>
        <div style={{ color: colors?.brightBlack }}>total 48</div>
        <div>
          <span style={{ color: colors?.cyan }}>drwxr-xr-x</span>
          <span style={{ color: colors?.brightBlack }}>
            {" "}
            5 deploy deploy 4096 May 1 09:12{" "}
          </span>
          <span style={{ color: colors?.blue }}>.</span>
        </div>
        <div>
          <span style={{ color: colors?.cyan }}>drwxr-xr-x</span>
          <span style={{ color: colors?.brightBlack }}>
            {" "}
            3 root root 4096 Apr 15 18:44{" "}
          </span>
          <span style={{ color: colors?.blue }}>..</span>
        </div>
        <div>
          <span style={{ color: colors?.cyan }}>-rw-r--r--</span>
          <span style={{ color: colors?.brightBlack }}>
            {" "}
            1 deploy deploy 220 Apr 15 18:44{" "}
          </span>
          <span>.bash_logout</span>
        </div>
        <div>
          <span style={{ color: colors?.cyan }}>-rwxr-xr-x</span>
          <span style={{ color: colors?.brightBlack }}>
            {" "}
            1 deploy deploy 8192 May 1 08:55{" "}
          </span>
          <span style={{ color: colors?.green }}>deploy.sh</span>
        </div>
        <div className="flex items-center gap-0.5 mt-0.5">
          <span style={{ color: colors?.green }}>deploy@web-01</span>
          <span style={{ color: colors?.brightBlack }}>:</span>
          <span style={{ color: colors?.blue }}>~</span>
          <span style={{ color: colors?.brightBlack }}>$</span>
          <span> </span>
          <span
            className="inline-block"
            style={{
              width: cursorStyle === "block" ? "0.6em" : "0.12em",
              height: cursorStyle === "underline" ? "0.12em" : `${fontSize}px`,
              background: colors?.cursor || colors?.foreground || "#f7f7f7",
              animation: cursorBlink
                ? "termPreviewBlink 1s step-end infinite"
                : "none",
              verticalAlign:
                cursorStyle === "underline" ? "bottom" : "text-bottom",
            }}
          />
        </div>
      </div>
      <style>{`
        @keyframes termPreviewBlink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
