import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { useXTerm } from "react-xtermjs";
import { useTheme } from "@/components/theme-provider";
import { resolveTermixThemeColors } from "@/features/terminal/terminal-theme";
import { DEFAULT_TERMINAL_CONFIG, TERMINAL_FONTS } from "@/lib/terminal-themes";
import { ensureTerminalFontsLoaded } from "@/features/terminal/terminal-global-styles";

export function LocalTerminal({
  instanceId,
  isVisible,
}: {
  instanceId: string;
  isVisible: boolean;
}) {
  const { theme: appTheme } = useTheme();
  const { instance: terminal, ref: xtermRef } = useXTerm();
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [isWindows, setIsWindows] = useState(false);
  const [shell, setShell] = useState<"default" | "wsl">("default");

  useEffect(() => {
    window.electronAPI?.getPlatform().then((platform) => {
      setIsWindows(platform === "win32");
    });
  }, []);

  const fit = useCallback(() => {
    const fitAddon = fitAddonRef.current;
    const sessionId = sessionIdRef.current;
    if (!terminal || !fitAddon) return;
    fitAddon.fit();
    if (sessionId) {
      window.electronAPI.resizeLocalTerminal(
        sessionId,
        terminal.cols,
        terminal.rows,
      );
    }
  }, [terminal]);

  useEffect(() => {
    if (!terminal) return;
    const colors = resolveTermixThemeColors("termix", appTheme);
    const font = TERMINAL_FONTS.find(
      (item) => item.value === DEFAULT_TERMINAL_CONFIG.fontFamily,
    );
    ensureTerminalFontsLoaded(font?.value ?? TERMINAL_FONTS[0].value);
    terminal.options.theme = colors;
    terminal.options.fontFamily = font?.fallback ?? TERMINAL_FONTS[0].fallback;
    terminal.options.fontSize = DEFAULT_TERMINAL_CONFIG.fontSize;
  }, [appTheme, terminal]);

  useEffect(() => {
    if (!terminal || !window.electronAPI?.isElectron) return;
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    terminal.loadAddon(fitAddon);
    fitAddon.fit();

    let disposed = false;
    let removeData = () => {};
    let removeExit = () => {};
    const input = terminal.onData((data) => {
      const sessionId = sessionIdRef.current;
      if (sessionId) window.electronAPI.writeLocalTerminal(sessionId, data);
    });

    window.electronAPI
      .startLocalTerminal({ cols: terminal.cols, rows: terminal.rows, shell })
      .then(({ sessionId }) => {
        if (disposed) {
          window.electronAPI.closeLocalTerminal(sessionId);
          return;
        }
        sessionIdRef.current = sessionId;
        removeData = window.electronAPI.onLocalTerminalData(sessionId, (data) =>
          terminal.write(data),
        );
        removeExit = window.electronAPI.onLocalTerminalExit(
          sessionId,
          (exitCode) => {
            sessionIdRef.current = null;
            terminal.write(
              `\r\n\x1b[33mProcess exited (${exitCode})\x1b[0m\r\n`,
            );
          },
        );
        return window.electronAPI.readyLocalTerminal(sessionId);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        terminal.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`);
      });

    const observer = new ResizeObserver(() => fit());
    if (xtermRef.current) observer.observe(xtermRef.current);
    return () => {
      disposed = true;
      observer.disconnect();
      input.dispose();
      removeData();
      removeExit();
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = null;
      if (sessionId) window.electronAPI.closeLocalTerminal(sessionId);
      fitAddonRef.current = null;
      fitAddon.dispose();
    };
  }, [fit, instanceId, shell, terminal, xtermRef]);

  useEffect(() => {
    if (isVisible) requestAnimationFrame(fit);
  }, [fit, isVisible]);

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {isWindows && (
        <div className="flex justify-end border-b border-border px-2 py-1">
          <select
            aria-label="Local terminal shell"
            className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
            value={shell}
            onChange={(event) =>
              setShell(event.target.value === "wsl" ? "wsl" : "default")
            }
          >
            <option value="default">PowerShell</option>
            <option value="wsl">WSL</option>
          </select>
        </div>
      )}
      <div ref={xtermRef} className="min-h-0 flex-1 p-2" />
    </div>
  );
}
