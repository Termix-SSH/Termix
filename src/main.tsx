/* eslint-disable react-refresh/only-export-components */
import { prepareClientCacheVersion } from "@/lib/client-cache-version";
import { StrictMode, Suspense, lazy, useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./ui/index.css";
import { ThemeProvider } from "@/components/theme-provider";
import "./ui/i18n/i18n";
import { isElectron } from "@/lib/electron";
import { Toaster } from "@/components/sonner";
import { Auth, getStoredAuth, clearStoredAuth } from "@/auth/Auth";
import { applyAccentColor, applyFontSize } from "@/lib/theme";
import type { FontSizeId } from "@/types/ui-types";
import { useServiceWorker } from "@/hooks/use-service-worker";

const AppShell = lazy(() =>
  import("@/AppShell").then((m) => ({ default: m.AppShell })),
);

// Full-screen apps opened via query params (e.g. from external links or Electron)
const TerminalApp = lazy(() => import("@/features/terminal/TerminalApp"));
const FileManagerApp = lazy(
  () => import("@/features/file-manager/FileManagerApp"),
);
const TunnelApp = lazy(() => import("@/features/tunnel/TunnelApp"));
const ServerStatsApp = lazy(
  () => import("@/features/server-stats/ServerStatsApp"),
);
const DockerApp = lazy(() => import("@/features/docker/DockerApp"));
const GuacamoleApp = lazy(() => import("@/features/guacamole/GuacamoleApp"));

const ElectronVersionCheck = lazy(() =>
  import("@/user/ElectronVersionCheck").then((module) => ({
    default: module.ElectronVersionCheck,
  })),
);

type Phase = "idle-auth" | "fading-in" | "idle-app" | "fading-out";

function useWindowWidth() {
  const [width, setWidth] = useState(window.innerWidth);
  const lastSwitchTime = useRef(0);
  const isCurrentlyMobile = useRef(window.innerWidth < 768);
  const hasSwitchedOnce = useRef(false);

  useEffect(() => {
    let timeoutId: number;
    const handleResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        const newWidth = window.innerWidth;
        const newIsMobile = newWidth < 768;
        const now = Date.now();
        if (hasSwitchedOnce.current && now - lastSwitchTime.current < 10000) {
          setWidth(newWidth);
          return;
        }
        if (
          newIsMobile !== isCurrentlyMobile.current &&
          now - lastSwitchTime.current > 5000
        ) {
          lastSwitchTime.current = now;
          isCurrentlyMobile.current = newIsMobile;
          hasSwitchedOnce.current = true;
          setWidth(newWidth);
        } else {
          setWidth(newWidth);
        }
      }, 2000);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return width;
}

function FullscreenApp() {
  const searchParams = new URLSearchParams(window.location.search);
  const view = searchParams.get("view");
  const hostId = searchParams.get("hostId");

  switch (view) {
    case "terminal":
      return <TerminalApp hostId={hostId || undefined} />;
    case "file-manager":
      return <FileManagerApp hostId={hostId || undefined} />;
    case "tunnel":
      return <TunnelApp hostId={hostId || undefined} />;
    case "server-stats":
      return <ServerStatsApp hostId={hostId || undefined} />;
    case "docker":
      return <DockerApp hostId={hostId || undefined} />;
    case "rdp":
    case "vnc":
    case "telnet":
      return <GuacamoleApp hostId={hostId || undefined} />;
    default:
      return null;
  }
}

function App() {
  const stored = getStoredAuth();
  const [phase, setPhase] = useState<Phase>(
    stored?.loggedIn ? "idle-app" : "idle-auth",
  );
  const [authUsername, setAuthUsername] = useState(stored?.username ?? "");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const savedAccent = localStorage.getItem("termix-accent");
    if (savedAccent) applyAccentColor(savedAccent);
    const savedSize = localStorage.getItem(
      "termix-font-size",
    ) as FontSizeId | null;
    applyFontSize(savedSize ?? "lg");
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function handleLogin(u: string) {
    setAuthUsername(u);
    setPhase("fading-in");
    timerRef.current = setTimeout(() => setPhase("idle-app"), 450);
  }

  function handleLogout() {
    clearStoredAuth();
    setPhase("fading-out");
    timerRef.current = setTimeout(() => {
      setAuthUsername("");
      setPhase("idle-auth");
    }, 450);
  }

  const showApp =
    phase === "idle-app" || phase === "fading-in" || phase === "fading-out";
  const showAuth =
    phase === "idle-auth" || phase === "fading-in" || phase === "fading-out";
  const appOpacity = phase === "idle-app" ? 1 : 0;
  const authOpacity = phase === "idle-auth" ? 1 : 0;

  return (
    <>
      {showApp && (
        <div
          className="fixed inset-0 z-0 transition-opacity duration-[450ms] ease-in-out"
          style={{
            opacity: appOpacity,
            pointerEvents: phase === "idle-app" ? "auto" : "none",
          }}
        >
          <Suspense fallback={null}>
            <AppShell username={authUsername} onLogout={handleLogout} />
          </Suspense>
        </div>
      )}

      {showAuth && (
        <div
          className="fixed inset-0 z-10 transition-opacity duration-[450ms] ease-in-out"
          style={{
            opacity: authOpacity,
            pointerEvents: phase === "idle-auth" ? "auto" : "none",
          }}
        >
          <Auth onLogin={handleLogin} />
        </div>
      )}

      <Toaster position="bottom-right" />
    </>
  );
}

function RootApp() {
  const width = useWindowWidth();
  const isMobile = width < 768;
  const [showVersionCheck, setShowVersionCheck] = useState(true);

  useServiceWorker();

  const userAgent =
    navigator.userAgent ||
    navigator.vendor ||
    (window as Window & { opera?: string }).opera ||
    "";
  const isTermixMobile = /Termix-Mobile/.test(userAgent);
  const searchParams = new URLSearchParams(window.location.search);
  const isFullscreen = searchParams.has("view");

  if (isFullscreen) {
    return (
      <Suspense fallback={null}>
        <FullscreenApp />
      </Suspense>
    );
  }

  if (isElectron() && showVersionCheck) {
    return (
      <Suspense fallback={null}>
        <ElectronVersionCheck onContinue={() => setShowVersionCheck(false)} />
      </Suspense>
    );
  }

  return <App />;
}

prepareClientCacheVersion().finally(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
        <RootApp />
      </ThemeProvider>
    </StrictMode>,
  );
});
