/* eslint-disable react-refresh/only-export-components */
import { prepareClientCacheVersion } from "@/lib/client-cache-version";
import { StrictMode, Suspense, lazy, useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { ThemeProvider } from "@/components/theme-provider";
import "./i18n/i18n";
import { isElectron } from "@/lib/electron";

const DesktopApp = lazy(() => import("@/ui/desktop/DesktopApp.tsx"));
const MobileApp = lazy(() =>
  import("@/ui/mobile/MobileApp.tsx").then((module) => ({
    default: module.MobileApp,
  })),
);
const HostManagerApp = lazy(
  () => import("./ui/desktop/apps/host-manager/HostManagerApp.tsx"),
);
const TerminalApp = lazy(
  () => import("./ui/desktop/apps/features/terminal/TerminalApp.tsx"),
);
const FileManagerApp = lazy(
  () => import("./ui/desktop/apps/features/file-manager/FileManagerApp.tsx"),
);
const TunnelApp = lazy(
  () => import("./ui/desktop/apps/features/tunnel/TunnelApp.tsx"),
);
const ServerStatsApp = lazy(
  () => import("./ui/desktop/apps/features/server-stats/ServerStatsApp.tsx"),
);
const DockerApp = lazy(
  () => import("./ui/desktop/apps/features/docker/DockerApp.tsx"),
);
const GuacamoleApp = lazy(
  () => import("@/ui/desktop/apps/features/guacamole/GuacamoleApp.tsx"),
);
const ElectronVersionCheck = lazy(() =>
  import("@/ui/desktop/user/ElectronVersionCheck.tsx").then((module) => ({
    default: module.ElectronVersionCheck,
  })),
);

const FullscreenApp: React.FC = () => {
  const searchParams = new URLSearchParams(window.location.search);
  const view = searchParams.get("view");
  const hostId = searchParams.get("hostId");

  switch (view) {
    case "host-manager":
      return <HostManagerApp />;
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
      return <DesktopApp />;
  }
};
import { useServiceWorker } from "@/hooks/use-service-worker";

function useWindowWidth() {
  const [width, setWidth] = useState(window.innerWidth);
  const lastSwitchTime = useRef(0);
  const isCurrentlyMobile = useRef(window.innerWidth < 768);
  const hasSwitchedOnce = useRef(false);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
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

  const renderApp = () => {
    if (isFullscreen) {
      return <FullscreenApp />;
    }

    if (isElectron()) {
      return <DesktopApp />;
    }

    if (isTermixMobile) {
      return <MobileApp key="mobile" />;
    }

    return isMobile ? <MobileApp key="mobile" /> : <DesktopApp key="desktop" />;
  };

  return (
    <>
      {!isFullscreen && (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            backgroundColor: "var(--bg-base)",
            backgroundImage: `linear-gradient(
              135deg,
              transparent 0%,
              transparent 49%,
              rgba(128, 128, 128, 0.03) 49%,
              rgba(128, 128, 128, 0.03) 51%,
              transparent 51%,
              transparent 100%
            )`,
            backgroundSize: "80px 80px",
            zIndex: 0,
          }}
        />
      )}
      <div className="relative min-h-screen" style={{ zIndex: 1 }}>
        {isElectron() && showVersionCheck && !isFullscreen ? (
          <Suspense fallback={null}>
            <ElectronVersionCheck
              onContinue={() => setShowVersionCheck(false)}
              isAuthenticated={false}
            />
          </Suspense>
        ) : (
          <Suspense fallback={null}>{renderApp()}</Suspense>
        )}
      </div>
    </>
  );
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
