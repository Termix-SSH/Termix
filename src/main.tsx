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
import { getUserInfo, getCurrentToken, appReadyPromise } from "@/main-axios";
import { applyAccentColor, applyFontSize } from "@/lib/theme";
import { installElectronWheelZoomGuard } from "@/lib/electron-wheel-zoom";
import type { FontSizeId } from "@/types/ui-types";
import { useServiceWorker } from "@/hooks/use-service-worker";
import { useTranslation } from "react-i18next";

const AppShell = lazy(() =>
  import("@/AppShell").then((m) => ({ default: m.AppShell })),
);

// Full-screen apps opened via query params (e.g. from external links or Electron)
const TerminalApp = lazy(() =>
  import("@/features/terminal/TerminalApp").then((m) => ({
    default: m.default,
  })),
);
const FileManagerApp = lazy(() =>
  import("@/features/file-manager/FileManagerApp").then((m) => ({
    default: m.default,
  })),
);
const TunnelApp = lazy(() =>
  import("@/features/tunnel/TunnelApp").then((m) => ({ default: m.default })),
);
const HostMetricsApp = lazy(() =>
  import("@/features/host-metrics/HostMetricsApp").then((m) => ({
    default: m.default,
  })),
);
const DockerApp = lazy(() =>
  import("@/features/docker/DockerApp").then((m) => ({ default: m.default })),
);
const GuacamoleApp = lazy(() =>
  import("@/features/guacamole/GuacamoleApp").then((m) => ({
    default: m.default,
  })),
);
// --- tmux-monitor ---
const TmuxMonitorApp = lazy(() =>
  import("@/features/tmux-monitor/TmuxMonitorApp").then((m) => ({
    default: m.default,
  })),
);

const HomepageApp = lazy(() =>
  import("@/features/homepage/HomepageApp").then((m) => ({
    default: m.default,
  })),
);

const ElectronVersionCheck = lazy(() =>
  import("@/user/ElectronVersionCheck").then((module) => ({
    default: module.ElectronVersionCheck,
  })),
);

// Anonymous guest view for shared terminal/RDP/VNC/Telnet sessions (?view=shared&token=<linkToken>).
// Rendered outside FullscreenAppGate since guests never have a JWT/cookie to verify.
const SharedSessionView = lazy(
  () => import("@/features/session-sharing/SharedSessionView"),
);

type Phase =
  | "verifying"
  | "idle-auth"
  | "fading-in"
  | "idle-app"
  | "fading-out";

function FullscreenApp() {
  const searchParams = new URLSearchParams(window.location.search);
  const view = searchParams.get("view");
  const hostId = searchParams.get("hostId");
  const tmuxSession = searchParams.get("tmuxSession");
  const path = searchParams.get("path");

  switch (view) {
    case "terminal":
      return (
        <TerminalApp
          hostId={hostId || undefined}
          tmuxSession={tmuxSession || undefined}
        />
      );
    case "file-manager":
      return (
        <FileManagerApp
          hostId={hostId || undefined}
          initialPath={path || undefined}
        />
      );
    case "tunnel":
      return <TunnelApp hostId={hostId || undefined} />;
    case "host-metrics":
    case "server-stats":
      return <HostMetricsApp hostId={hostId || undefined} />;
    case "docker":
      return <DockerApp hostId={hostId || undefined} />;
    case "rdp":
    case "vnc":
    case "telnet":
      return (
        <GuacamoleApp
          hostId={hostId || undefined}
          protocol={view as "rdp" | "vnc" | "telnet"}
        />
      );
    case "tmux-monitor": // --- tmux-monitor ---
    case "tmux_monitor": // tab type spelling, so copied links also resolve
      return <TmuxMonitorApp hostId={hostId || undefined} />;
    case "homepage":
      return <HomepageApp />;
    default:
      return null;
  }
}

function FullscreenAppGate() {
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);
  const [authFailed, setAuthFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    appReadyPromise
      .then(() => getUserInfo())
      .then(async () => {
        if (isElectron()) {
          try {
            const token = await getCurrentToken();
            if (token) localStorage.setItem("jwt", token);
          } catch {
            // WebSocket connections can still fall back to cookie auth.
          }
        }
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        if (!cancelled) setAuthFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (authFailed) {
    return <FullscreenApp />;
  }

  if (!ready) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  return <FullscreenApp />;
}

function App() {
  const stored = getStoredAuth();
  const [phase, setPhase] = useState<Phase>(
    stored?.loggedIn ? "verifying" : "idle-auth",
  );
  const [authUsername, setAuthUsername] = useState(stored?.username ?? "");
  const [verifyRetryCount, setVerifyRetryCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track whether fading-in came from a fresh login (vs. session verification on page load).
  // When session-verified, Auth must not mount during the transition — it would trigger
  // silent OIDC redirect and cause an infinite refresh loop.
  const fadingInFromLoginRef = useRef(false);

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

  // Verify stored session against the server before rendering AppShell.
  // Wait for API instances to be initialized with correct embedded/server config first.
  // In Electron, also repopulate localStorage["jwt"] so WebSocket connections can auth
  // after a session restore (the token is only written to localStorage during a fresh login).
  useEffect(() => {
    if (phase !== "verifying") return;
    appReadyPromise
      .then(() => getUserInfo())
      .then(async () => {
        if (isElectron()) {
          try {
            const token = await getCurrentToken();
            if (token) localStorage.setItem("jwt", token);
          } catch {
            // Non-fatal: WebSocket connections will fall back to cookie auth
          }
        }
        fadingInFromLoginRef.current = false;
        setPhase("fading-in");
        timerRef.current = setTimeout(() => setPhase("idle-app"), 450);
      })
      .catch((err: unknown) => {
        // Only treat a genuine auth rejection (401/403) as "not logged in".
        // Anything else (network hiccup, backend still starting up, a
        // transient 5xx) is not proof the session is invalid -- clearing
        // stored auth here would drop the user back to Auth.tsx, which in
        // Electron immediately mints a brand-new auto-session, silently
        // swapping out the JWT/cookie from under any still-in-flight
        // requests and causing spurious "Session expired" toasts.
        const status =
          (err as { status?: number; response?: { status?: number } })
            ?.status ??
          (err as { response?: { status?: number } })?.response?.status;
        if (status === 401 || status === 403) {
          clearStoredAuth();
          setPhase("idle-auth");
          return;
        }
        // Transient failure: retry shortly rather than logging out. Cap
        // retries so a genuinely broken backend still surfaces the login
        // screen eventually instead of spinning forever.
        if (verifyRetryCount >= 5) {
          clearStoredAuth();
          setPhase("idle-auth");
          return;
        }
        timerRef.current = setTimeout(() => {
          setVerifyRetryCount((c) => c + 1);
        }, 3000);
      });
  }, [phase, verifyRetryCount]);

  function handleLogin(u: string) {
    setAuthUsername(u);
    fadingInFromLoginRef.current = true;
    setPhase("fading-in");
    timerRef.current = setTimeout(() => setPhase("idle-app"), 450);
    if (isElectron()) {
      window.electronAPI?.startC2SAutoStartTunnels?.().catch(() => {});
      const localJwt = localStorage.getItem("jwt");
      if (localJwt) {
        window.electronAPI
          ?.invoke?.("notify-local-login", localJwt)
          .catch(() => {});
      }
    }
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
    phase === "idle-auth" ||
    (phase === "fading-in" && fadingInFromLoginRef.current) ||
    phase === "fading-out";
  const appOpacity = phase === "idle-app" ? 1 : 0;
  const authOpacity = phase === "idle-auth" ? 1 : 0;

  const { t } = useTranslation();
  const isTransitioning = phase === "fading-in" || phase === "fading-out";

  if (phase === "verifying") {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {isTransitioning && (
        <div className="fixed inset-0 z-0 flex items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-4">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground">
              {t("common.loading")}
            </p>
          </div>
        </div>
      )}

      {showApp && (
        <div
          className="fixed inset-0 z-10 transition-opacity duration-[450ms] ease-in-out"
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
          className="fixed inset-0 z-20 transition-opacity duration-[450ms] ease-in-out"
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
  const [showVersionCheck, setShowVersionCheck] = useState(true);

  useServiceWorker();

  const searchParams = new URLSearchParams(window.location.search);
  const isFullscreen = searchParams.has("view");

  // Anonymous guests have no cookie/JWT at all, so this bypasses FullscreenAppGate's
  // auth check entirely rather than waiting on a getUserInfo() call that would always fail.
  if (searchParams.get("view") === "shared") {
    return (
      <Suspense fallback={null}>
        <SharedSessionView />
      </Suspense>
    );
  }

  if (isFullscreen) {
    return (
      <Suspense fallback={null}>
        <FullscreenAppGate />
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

installElectronWheelZoomGuard();

prepareClientCacheVersion().finally(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
        <RootApp />
      </ThemeProvider>
    </StrictMode>,
  );
});
