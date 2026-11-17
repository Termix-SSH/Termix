import * as React from "react";
import { isElectron } from "@/lib/electron";
import { getForeignRuntime } from "@/components/foreign/foreign-runtime";
import { useFrameState } from "@/plugin-frame/frame-store";

const MOBILE_BREAKPOINT = 768;

/**
 * Phone layout below the breakpoint. The desktop app always stays desktop.
 * In a plugin frame the frame's own width says nothing (a narrow tile is not
 * a phone), so it follows the shell's answer. The runtime is set before
 * anything renders and never changes.
 */
export function useIsMobile() {
  const runtime = getForeignRuntime();
  const useSource =
    runtime && !runtime.withOwn ? useShellIsMobile : useWindowIsMobile;
  return useSource();
}

function useShellIsMobile() {
  return useFrameState((state) => state.isMobile);
}

function useWindowIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(
    undefined,
  );

  React.useEffect(() => {
    if (isElectron()) {
      setIsMobile(false);
      return;
    }
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}
