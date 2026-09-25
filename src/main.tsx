/* eslint-disable react-refresh/only-export-components */
import { prepareClientCacheVersion } from "@/lib/client-cache-version";
import { StrictMode, Suspense, lazy, useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./ui/index.css";
import { ThemeProvider } from "@/components/theme-provider";
import "./ui/i18n/i18n";
import { isElectron } from "@/lib/electron";
import { getEmbeddedServerFailure } from "@/lib/embedded-server-status";
import { Toaster } from "@/components/sonner";
import {
  Auth,
  getStoredAuth,
  clearStoredAuth,
  markDesktopManualLogout,
  clearDesktopManualLogout,
} from "@/auth/Auth";
import { getUserInfo, getCurrentToken, appReadyPromise } from "@/main-axios";
import { applyAccentColor, applyFontSize, applyUiFont } from "@/lib/theme";
import { installElectronWheelZoomGuard } from "@/lib/electron-wheel-zoom";
import type { FontSizeId, UiFontId } from "@/types/ui-types";
import { useServiceWorker } from "@/hooks/use-service-worker";
import { useTranslation } from "react-i18next";
import { UiPreferencesProvider } from "@/contexts/UiPreferencesContext";
import { ConnectionDefaultsProvider } from "@/contexts/ConnectionDefaultsContext";
import { BrandingProvider } from "@/contexts/BrandingContext";
import {
  fetchGuestViews,
  startPluginRuntime,
  stopPluginRuntime,
} from "@/plugin-host/loader";
import { settledPromise } from "@/plugin-host/plugin-store";
import { resetShellBridge } from "@/plugin-host/shell-bridge";
import { preloadPermissions } from "@/hooks/use-permissions";
import { getUserPreferences } from "@/api/open-tabs-api";
import { standaloneViewFor } from "@/shell/tab-registry";
import { PluginViewPlaceholder } from "@/plugin-host/PluginViewPlaceholder";

const AppShell = lazy(() =>
  import("@/AppShell").then((m) => ({ default: m.AppShell })),
);

const ElectronVersionCheck = lazy(() =>
  import("@/user/ElectronVersionCheck").then((module) => ({
    default: module.ElectronVersionCheck,
  })),
);

type Phase =
  | "verifying"
  | "idle-auth"
  | "loading-app"
  | "fading-in"
  | "idle-app"
  | "fading-out";

type LogoutOptions = {
  manual?: boolean;
};

function FullscreenApp() {
  const searchParams = new URLSearchParams(window.location.search);
  const view = searchParams.get("view");
  const hostId = searchParams.get("hostId");

  switch (view) {
    default: {
      const def = view ? standaloneViewFor(view) : undefined;
      if (!def?.standalone) {
        return view ? <PluginViewPlaceholder kind="tab" viewId={view} /> : null;
      }
      const Standalone = def.standalone;
      return (
        <Standalone
          hostId={hostId || undefined}
          view={view!}
          params={searchParams}
        />
      );
    }
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
        // Plugin views (metrics, Docker, remote desktop) register their
        // full-screen component when their plugin starts.
        await startPluginRuntime().catch(() => {});
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
  // Dedupes concurrent handleLogout() calls within the same tick -- see
  // handleLogout for why phase state alone isn't sufficient for this.
  const loggingOutRef = useRef(false);

  useEffect(() => {
    const savedAccent = localStorage.getItem("termix-accent");
    if (savedAccent) applyAccentColor(savedAccent);
    const savedSize = localStorage.getItem(
      "termix-font-size",
    ) as FontSizeId | null;
    applyFontSize(savedSize ?? "md");
    applyUiFont(
      (localStorage.getItem("termix-ui-font") as UiFontId | null) ??
        "jetbrains-mono",
    );
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
            if (token) {
              localStorage.setItem("jwt", token);
              // Remote Sync's engine (main process) needs this local JWT to
              // authenticate against the embedded backend during sync, same
              // as a fresh login provides via handleLogin below -- a session
              // restore (the common case on every normal launch) must hand
              // it over too, or sync silently never runs after the first
              // app restart.
              window.electronAPI
                ?.invoke?.("notify-local-login", token)
                .catch(() => {});
            }
          } catch {
            // Non-fatal: WebSocket connections will fall back to cookie auth
          }
        }
        fadingInFromLoginRef.current = false;
        setPhase("loading-app");
        await Promise.all([
          startPluginRuntime()
            .catch(() => {})
            .then(() => settledPromise()),
          preloadPermissions(),
          getUserPreferences().catch(() => undefined),
        ]);
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
        // Transient failure: retry rather than logging out. In Electron the
        // embedded local backend is bundled, always-on infrastructure that
        // always eventually comes up (a slow cold boot just takes longer),
        // and Auth.tsx never shows a login form for it anyway -- so there's
        // no reason to ever give up and manufacture a logout here. Outside
        // Electron a genuinely broken backend still needs to surface the
        // login screen eventually, so that case keeps a retry cap.
        if (!isElectron() && verifyRetryCount >= 5) {
          clearStoredAuth();
          setPhase("idle-auth");
          return;
        }
        // "Always eventually comes up" holds only while the embedded
        // backend is still booting. If the main process reports it exited
        // for good -- a port conflict being by far the most common cause --
        // retrying forever leaves the user on an endless spinner with no
        // hint of what is wrong, so hand over to Auth, which reports the
        // reason instead.
        void getEmbeddedServerFailure().then((failure) => {
          if (failure) {
            setPhase("idle-auth");
            return;
          }
          const delay = isElectron()
            ? Math.min(1000 * 2 ** verifyRetryCount, 10000)
            : 3000;
          timerRef.current = setTimeout(() => {
            setVerifyRetryCount((c) => c + 1);
          }, delay);
        });
      });
  }, [phase, verifyRetryCount]);

  function handleLogin(u: string) {
    loggingOutRef.current = false;
    clearDesktopManualLogout();
    setAuthUsername(u);
    fadingInFromLoginRef.current = true;
    setPhase("loading-app");
    void (async () => {
      await Promise.all([
        startPluginRuntime()
          .catch(() => {})
          .then(() => settledPromise()),
        preloadPermissions(),
        getUserPreferences().catch(() => undefined),
      ]);
      setPhase("fading-in");
      timerRef.current = setTimeout(() => setPhase("idle-app"), 450);
    })();
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

  function handleLogout(options?: LogoutOptions) {
    // A single background hiccup can trigger several independent 401s at
    // once (e.g. a burst of unrelated polls all failing together in the
    // same tick), each calling this. React batches the resulting setPhase
    // calls, so checking `phase` here can't distinguish the first call in
    // a batch from the second -- both would see the same pre-update value
    // and both would proceed, each overwriting timerRef with a fresh
    // 450ms timer. A steady trickle of these could keep resetting the
    // countdown so the transition never actually completes, which looks
    // exactly like "nothing happens." loggingOutRef is synchronous and
    // isn't subject to batching, so it correctly dedupes within one tick.
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    // The next user may see different plugins, so nothing they registered
    // should survive into the next session.
    void stopPluginRuntime();
    resetShellBridge();
    clearStoredAuth();
    localStorage.removeItem("jwt");
    if (isElectron() && options?.manual) {
      markDesktopManualLogout();
    }
    if (isElectron()) {
      window.electronAPI?.clearSessionCookies?.().catch(() => {});
    } else {
      const isSecure = window.location.protocol === "https:";
      document.cookie = isSecure
        ? "jwt=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; Secure; SameSite=Lax"
        : "jwt=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax";
    }
    setPhase("fading-out");
    timerRef.current = setTimeout(() => {
      setAuthUsername("");
      setPhase("idle-auth");
      loggingOutRef.current = false;
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

  if (phase === "verifying" || phase === "loading-app") {
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
            <UiPreferencesProvider>
              <ConnectionDefaultsProvider>
                <AppShell username={authUsername} onLogout={handleLogout} />
              </ConnectionDefaultsProvider>
            </UiPreferencesProvider>
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

/**
 * An anonymous guest link (a shared session, a collab room). The view comes
 * from a guest plugin's standalone tab view, so the guest-capable plugins
 * load first, without a session.
 */
function GuestView({ view }: { view: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    startPluginRuntime({ guest: true })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);
  if (!ready) return null;
  const def = standaloneViewFor(view);
  if (!def?.standalone) {
    return <PluginViewPlaceholder kind="tab" viewId={view} />;
  }
  const Standalone = def.standalone;
  return (
    <Standalone
      view={view}
      params={new URLSearchParams(window.location.search)}
    />
  );
}

/**
 * Picks between a guest link and a signed-in full-screen view. Guests never
 * have a JWT or cookie to verify, so a guest view skips FullscreenAppGate.
 */
function ViewRouter({ view }: { view: string }) {
  const [guestViews, setGuestViews] = useState<string[] | null>(null);
  useEffect(() => {
    void fetchGuestViews().then(setGuestViews);
  }, []);
  if (!guestViews) return null;
  if (guestViews.includes(view)) return <GuestView view={view} />;
  return (
    <UiPreferencesProvider>
      <ConnectionDefaultsProvider>
        <FullscreenAppGate />
      </ConnectionDefaultsProvider>
    </UiPreferencesProvider>
  );
}

function RootApp() {
  const [showVersionCheck, setShowVersionCheck] = useState(true);

  useServiceWorker();

  const searchParams = new URLSearchParams(window.location.search);
  const view = searchParams.get("view");

  if (view !== null) {
    return (
      <Suspense fallback={null}>
        <ViewRouter view={view} />
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
        <BrandingProvider>
          <RootApp />
        </BrandingProvider>
      </ThemeProvider>
    </StrictMode>,
  );
});
