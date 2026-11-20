/* eslint-disable react-refresh/only-export-components */
import "@/diagnostics/install-page";
import { prepareClientCacheVersion } from "@/lib/client-cache-version";
import {
  TitleBar,
  TITLE_BAR_OFFSET,
  useTitleBarOverlayColors,
} from "@/shell/TitleBar";
import { StrictMode, Suspense, lazy, useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./ui/index.css";
import { ThemeProvider } from "@/components/theme-provider";
import "./ui/i18n/i18n";
import { isElectron } from "@/lib/electron";
import { isEmbeddedAuthFrame } from "@/lib/embedded-frame";
import { captureAppReturn } from "@/lib/app-return";
import { rememberViewLink, resumeViewLink } from "@/lib/view-link-resume";
import { getEmbeddedServerFailure } from "@/lib/embedded-server-status";
import { Toaster } from "@/components/sonner";
import {
  Auth,
  getStoredAuth,
  clearStoredAuth,
  storeAuth,
  markDesktopManualLogout,
  clearDesktopManualLogout,
} from "@/auth/Auth";
import {
  getUserInfo,
  getCurrentToken,
  appReadyPromise,
  logoutUser,
} from "@/main-axios";
import { applyAccentColor, applyFontSize, applyUiFont } from "@/lib/theme";
import { installElectronWheelZoomGuard } from "@/lib/electron-wheel-zoom";
import type { FontSizeId, UiFontId } from "@/types/ui-types";
import { useServiceWorker } from "@/hooks/use-service-worker";
import { useTranslation } from "react-i18next";
import { UiPreferencesProvider } from "@/contexts/UiPreferencesContext";
import { BrandingProvider } from "@/contexts/BrandingContext";
import {
  fetchGuestViews,
  pluginsBooted,
  startPluginRuntime,
  stopPluginRuntime,
} from "@/plugin-host/loader";
import { settledPromise } from "@/plugin-host/plugin-store";
import { resetShellBridge } from "@/plugin-host/shell-bridge";
import { loadLook, resetLook } from "@/look/look-store";
import { resetPluginThemes } from "@/look/theme-registry";
import { resetPluginLayouts } from "@/look/layout-registry";
import { preloadPermissions } from "@/hooks/use-permissions";
import { getUserPreferences } from "@/api/open-tabs-api";
import { standaloneViewFor, useTabTypes } from "@/shell/tab-registry";
import { LoadingState } from "@/components/loading-state";
import { BootProgress } from "@/shell/ColdBootStage";
import { DiagnosticsHost } from "@/diagnostics/DiagnosticsHost";
import { ReportLink } from "@/diagnostics/ReportLink";
import { diagnosticsRequested } from "@/diagnostics/open-diagnostics";
import { ForeignViewHost } from "@/plugin-host/frames/foreign-views";
import { DataWatchHost } from "@/plugin-host/frames/data-watches";
import { PluginViewPlaceholder } from "@/plugin-host/PluginViewPlaceholder";
import {
  resolveStartupOnboarding,
  type StartupOnboarding,
} from "@/onboarding/startup";

const AppShell = lazy(() =>
  import("@/AppShell").then((m) => ({ default: m.AppShell })),
);
const OnboardingStage = lazy(() =>
  import("@/onboarding/OnboardingStage").then((m) => ({
    default: m.OnboardingStage,
  })),
);

/** Longest the loading screen waits for plugin frames to start. */
const BOOT_WAIT_MS = 15_000;

/**
 * Everything the shell needs before it shows, so nothing moves or pops in
 * right after the loading screen goes away.
 */
function loadApp(): Promise<unknown> {
  const plugins = startPluginRuntime()
    .catch(() => {})
    .then(() => settledPromise())
    .then(() =>
      Promise.race([
        pluginsBooted(),
        new Promise((resolve) => setTimeout(resolve, BOOT_WAIT_MS)),
      ]),
    );
  return Promise.all([
    plugins,
    preloadPermissions(),
    getUserPreferences().catch(() => undefined),
    loadLook(),
  ]);
}

type Phase =
  | "verifying"
  | "idle-auth"
  | "loading-app"
  | "onboarding"
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

/**
 * A signed-out browser gets the normal login for a full-screen link and comes
 * back to it afterwards. The desktop app and the embedded sign-in frames
 * hand a login to their own shell, so they keep the bare view.
 */
function signsInForViewLink(): boolean {
  return !isElectron() && !isEmbeddedAuthFrame();
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
        if (cancelled) return;
        if (signsInForViewLink()) {
          rememberViewLink();
          window.history.replaceState(
            {},
            document.title,
            window.location.pathname,
          );
        }
        setAuthFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (authFailed) {
    return signsInForViewLink() ? <App /> : <FullscreenApp />;
  }

  if (!ready) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          <ReportLink label={t("diagnostics.slowBoot")} afterMs={20_000} />
        </div>
      </div>
    );
  }

  return <FullscreenApp />;
}

function App() {
  // Keeps the window controls the system draws in the colors of the theme.
  useTitleBarOverlayColors();
  const stored = getStoredAuth();
  // A sign in for the mobile app always shows the login form, so the app gets
  // its own fresh session.
  const [appReturn] = useState(captureAppReturn);
  const [phase, setPhase] = useState<Phase>(
    stored?.loggedIn && !appReturn ? "verifying" : "idle-auth",
  );
  const [authUsername, setAuthUsername] = useState(stored?.username ?? "");
  const [verifyRetryCount, setVerifyRetryCount] = useState(0);
  const [startup, setStartup] = useState<StartupOnboarding | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      .then(async (info) => {
        // The stored name can be an earlier account, after a switch or rename.
        if (info.username) {
          setAuthUsername(info.username);
          storeAuth(info.username);
        }
        if (isElectron()) {
          try {
            const token = await getCurrentToken();
            if (token) localStorage.setItem("jwt", token);
          } catch {
            // Non-fatal: WebSocket connections will fall back to cookie auth
          }
        }
        if (resumeViewLink()) return;
        setPhase("loading-app");
        await loadApp();
        await enterApp();
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
    // enterApp only touches state setters and refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, verifyRetryCount]);

  function fadeIntoApp() {
    setPhase("fading-in");
    timerRef.current = setTimeout(() => setPhase("idle-app"), 450);
  }

  /** Opens on onboarding first when there is something to show. */
  async function enterApp() {
    const plan = await resolveStartupOnboarding().catch(() => null);
    setStartup(plan);
    if (plan?.mode) {
      setPhase("onboarding");
      return;
    }
    fadeIntoApp();
  }

  function handleLogin(u: string) {
    loggingOutRef.current = false;
    clearDesktopManualLogout();
    if (resumeViewLink()) {
      setPhase("loading-app");
      return;
    }
    setAuthUsername(u);
    setPhase("loading-app");
    void (async () => {
      await loadApp();
      await enterApp();
    })();
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
    // Ends the session on the server too. A login method may send the
    // browser on, such as to the identity provider's sign out page.
    const serverLogout = options?.manual
      ? logoutUser()
          .then((result) => {
            const target = result?.redirectUrl;
            if (target && !isElectron() && /^https?:\/\//i.test(target)) {
              window.location.assign(target);
            }
          })
          .catch(() => {})
      : Promise.resolve();
    // The next user may see different plugins, so nothing they registered
    // should survive into the next session.
    void stopPluginRuntime();
    resetShellBridge();
    resetLook();
    resetPluginThemes();
    resetPluginLayouts();
    clearStoredAuth();
    localStorage.removeItem("jwt");
    if (isElectron() && options?.manual) {
      markDesktopManualLogout();
    }
    if (isElectron()) {
      void serverLogout.finally(() => {
        window.electronAPI?.clearSessionCookies?.().catch(() => {});
      });
    } else {
      const isSecure = window.location.protocol === "https:";
      document.cookie = isSecure
        ? "jwt=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; Secure; SameSite=Lax"
        : "jwt=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax";
    }
    // The app never mounted, so there is nothing to fade out of.
    if (phase === "onboarding") {
      setStartup(null);
      setAuthUsername("");
      setPhase("idle-auth");
      loggingOutRef.current = false;
      return;
    }
    setPhase("fading-out");
    timerRef.current = setTimeout(() => {
      setStartup(null);
      setAuthUsername("");
      setPhase("idle-auth");
      loggingOutRef.current = false;
    }, 450);
  }

  const showApp =
    phase === "idle-app" || phase === "fading-in" || phase === "fading-out";
  const showAuth = phase === "idle-auth" || phase === "fading-out";
  const appOpacity = phase === "idle-app" ? 1 : 0;
  const authOpacity = phase === "idle-auth" ? 1 : 0;

  const { t } = useTranslation();
  const isTransitioning = phase === "fading-in" || phase === "fading-out";
  // The desktop app draws a title bar on top of the window, so everything
  // below it starts lower. The bar sets the offset only while it shows.
  const titleBarOffset = TITLE_BAR_OFFSET;

  if (phase === "verifying" || phase === "loading-app") {
    return (
      <div
        className="fixed inset-0 flex items-center justify-center bg-background"
        style={{ paddingTop: titleBarOffset }}
      >
        <TitleBar />
        <div className="flex flex-col items-center gap-4">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          {phase === "loading-app" && <BootProgress />}
          <ReportLink label={t("diagnostics.slowBoot")} afterMs={20_000} />
        </div>
      </div>
    );
  }

  return (
    <>
      <TitleBar />

      {isTransitioning && (
        <div
          className="fixed inset-0 z-0 flex items-center justify-center bg-background"
          style={{ paddingTop: titleBarOffset }}
        >
          <div className="flex flex-col items-center gap-4">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground">
              {t("common.loading")}
            </p>
          </div>
        </div>
      )}

      {(showApp || phase === "onboarding") && (
        // One provider from onboarding into the app, so nothing chosen in
        // onboarding is lost or fetched twice on the way.
        <UiPreferencesProvider initial={startup?.preferences}>
          {phase === "onboarding" && startup?.mode && (
            <Suspense fallback={null}>
              <OnboardingStage
                mode={startup.mode}
                initialPlugins={startup.plugins}
                shellReady={false}
                onDone={fadeIntoApp}
                onLogout={() => handleLogout({ manual: true })}
              />
            </Suspense>
          )}
          {showApp && (
            <div
              className="fixed inset-0 z-10 transition-opacity duration-[450ms] ease-in-out"
              style={{
                opacity: appOpacity,
                pointerEvents: phase === "idle-app" ? "auto" : "none",
                paddingTop: titleBarOffset,
              }}
            >
              <Suspense fallback={null}>
                <AppShell username={authUsername} onLogout={handleLogout} />
              </Suspense>
            </div>
          )}
        </UiPreferencesProvider>
      )}

      {showAuth && (
        <div
          className="fixed inset-0 z-20 transition-opacity duration-[450ms] ease-in-out"
          style={{
            opacity: authOpacity,
            pointerEvents: phase === "idle-auth" ? "auto" : "none",
            paddingTop: titleBarOffset,
          }}
        >
          <Auth onLogin={handleLogin} />
        </div>
      )}

      <Toaster position="bottom-right" />
    </>
  );
}

/** Longer than a frame gets to start, so a slow one still shows. */
const GUEST_VIEW_WAIT_MS = 25_000;

/**
 * An anonymous guest link (a shared session, a collab room). The view comes
 * from a guest plugin's standalone tab view, so the guest-capable plugins
 * load first, without a session.
 */
function GuestView({ view }: { view: string }) {
  const [ready, setReady] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  // A plugin in a frame registers its view once its frame has started.
  useTabTypes();
  useEffect(() => {
    startPluginRuntime({ guest: true })
      .catch(() => {})
      .finally(() => setReady(true));
    const timer = setTimeout(() => setGaveUp(true), GUEST_VIEW_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);
  const def = ready ? standaloneViewFor(view) : undefined;
  if (!def?.standalone) {
    return gaveUp ? (
      <PluginViewPlaceholder kind="tab" viewId={view} />
    ) : (
      <LoadingState className="h-screen" />
    );
  }
  const Standalone = def.standalone;
  return (
    <>
      <Standalone
        view={view}
        params={new URLSearchParams(window.location.search)}
      />
      {/* A guest view in a frame draws other plugins' parts, like a shared
          terminal or desktop, through these. The signed-in shell mounts
          them with FrameStateSync. */}
      <ForeignViewHost />
      <DataWatchHost />
    </>
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
      <FullscreenAppGate />
    </UiPreferencesProvider>
  );
}

function RootApp() {
  useServiceWorker();

  const searchParams = new URLSearchParams(window.location.search);
  const view = searchParams.get("view");

  // Only the report: nothing else starts, so a broken plugin cannot get in
  // the way.
  if (diagnosticsRequested()) {
    return (
      <>
        <DiagnosticsHost />
        <Toaster position="bottom-right" />
      </>
    );
  }

  if (view !== null) {
    return (
      <Suspense fallback={null}>
        <ViewRouter view={view} />
        <DiagnosticsHost />
      </Suspense>
    );
  }

  return (
    <>
      <App />
      <DiagnosticsHost />
    </>
  );
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
