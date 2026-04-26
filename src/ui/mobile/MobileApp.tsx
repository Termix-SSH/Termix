import React, {
  useState,
  useEffect,
  Component,
  type FC,
  type ReactNode,
} from "react";
import { Terminal } from "@/ui/mobile/apps/terminal/Terminal.tsx";
import { TerminalKeyboard } from "@/ui/mobile/apps/terminal/TerminalKeyboard.tsx";
import { BottomNavbar } from "@/ui/mobile/navigation/BottomNavbar.tsx";
import { LeftSidebar } from "@/ui/mobile/navigation/LeftSidebar.tsx";
import {
  TabProvider,
  useTabs,
} from "@/ui/mobile/navigation/tabs/TabContext.tsx";
import {
  getUserInfo,
  isCurrentAuthInvalidationError,
} from "@/ui/main-axios.ts";
import { Auth } from "@/ui/mobile/authentication/Auth.tsx";
import { useTranslation } from "react-i18next";
import { Toaster } from "@/components/ui/sonner.tsx";
import { dbHealthMonitor } from "@/lib/db-health-monitor.ts";

type ReactNativeWindow = Window & {
  ReactNativeWebView?: {
    postMessage: (message: string) => void;
  };
};

function isReactNativeWebView(): boolean {
  return (
    typeof window !== "undefined" &&
    !!(window as ReactNativeWindow).ReactNativeWebView
  );
}

const AppContent: FC = () => {
  const { t } = useTranslation();
  const { tabs, currentTab, getTab } = useTabs();
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(true);
  const [ready, setReady] = React.useState(true);

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [, setIsAdmin] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const isAuthenticatedRef = React.useRef(false);

  useEffect(() => {
    isAuthenticatedRef.current = isAuthenticated;
  }, [isAuthenticated]);

  useEffect(() => {
    const handleSessionExpired = () => {
      setIsAuthenticated(false);
      setIsAdmin(false);
      setUsername(null);
    };

    dbHealthMonitor.on("session-expired", handleSessionExpired);
    return () => dbHealthMonitor.off("session-expired", handleSessionExpired);
  }, []);

  useEffect(() => {
    const checkAuth = () => {
      setAuthLoading(true);
      getUserInfo()
        .then((meRes) => {
          if (typeof meRes === "string" || !meRes.username) {
            setIsAuthenticated(false);
            setIsAdmin(false);
            setUsername(null);
          } else {
            setIsAuthenticated(true);
            setIsAdmin(!!meRes.is_admin);
            setUsername(meRes.username || null);
          }
        })
        .catch((err) => {
          if (isCurrentAuthInvalidationError(err)) {
            setIsAuthenticated(false);
            setIsAdmin(false);
            setUsername(null);
            console.warn(t("errors.sessionExpired"));
            return;
          }

          if (!isAuthenticatedRef.current) {
            setIsAuthenticated(false);
            setIsAdmin(false);
            setUsername(null);
          }
        })
        .finally(() => setAuthLoading(false));
    };

    checkAuth();

    const handleStorageChange = () => checkAuth();
    window.addEventListener("storage", handleStorageChange);

    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      fitCurrentTerminal();
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const handleAuthSuccess = (authData: {
    isAdmin: boolean;
    username: string | null;
    userId: string | null;
  }) => {
    setIsAuthenticated(true);
    setIsAdmin(authData.isAdmin);
    setUsername(authData.username);
  };

  const fitCurrentTerminal = () => {
    const tab = getTab(currentTab as number);
    if (tab && tab.terminalRef?.current?.fit) {
      tab.terminalRef.current.fit();
    }
  };

  React.useEffect(() => {
    if (tabs.length > 0) {
      setReady(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fitCurrentTerminal();
          setReady(true);
        });
      });
    }
  }, [currentTab]);

  const closeSidebar = () => setIsSidebarOpen(false);

  const handleKeyboardLayoutChange = () => {
    fitCurrentTerminal();
  };

  function handleKeyboardInput(input: string) {
    const currentTerminalTab = getTab(currentTab as number);
    if (
      currentTerminalTab &&
      currentTerminalTab.terminalRef?.current?.sendInput
    ) {
      currentTerminalTab.terminalRef.current.sendInput(input);
    }
  }

  if (authLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-canvas">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || isReactNativeWebView()) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-canvas p-4">
        <Auth
          setLoggedIn={setIsAuthenticated}
          setIsAdmin={setIsAdmin}
          setUsername={setUsername}
          setUserId={() => {}}
          loggedIn={isAuthenticated}
          authLoading={authLoading}
          dbError={null}
          setDbError={() => {}}
          onAuthSuccess={handleAuthSuccess}
        />
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-deepest overflow-y-hidden overflow-x-hidden relative">
      <div className="flex-1 min-h-0 relative">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`absolute inset-0 mb-2 bg-elevated ${tab.id === currentTab ? "visible" : "invisible"} ${ready ? "opacity-100" : "opacity-0"}`}
          >
            <Terminal
              ref={tab.terminalRef}
              hostConfig={tab.hostConfig}
              isVisible={tab.id === currentTab}
            />
          </div>
        ))}
        {tabs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-foreground gap-3 px-4 text-center">
            <h1 className="text-lg font-semibold">
              {t("mobile.selectHostToStart")}
            </h1>
            <p className="text-sm text-foreground-secondary max-w-xs">
              {t("mobile.limitedSupportMessage")}
            </p>
            <button
              className="mt-4 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors"
              onClick={() =>
                window.open("https://docs.termix.site/install", "_blank")
              }
            >
              {t("mobile.viewMobileAppDocs")}
            </button>
          </div>
        )}
      </div>
      {currentTab && (
        <div className="mb-1 z-10">
          <TerminalKeyboard
            onSendInput={handleKeyboardInput}
            onLayoutChange={handleKeyboardLayoutChange}
          />
        </div>
      )}
      <BottomNavbar onSidebarOpenClick={() => setIsSidebarOpen(true)} />

      {isSidebarOpen && (
        <div
          className="absolute inset-0 bg-black/30 backdrop-blur-sm z-10"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <div className="absolute top-0 left-0 h-full z-20 pointer-events-none">
        <div
          onClick={(e) => {
            e.stopPropagation();
          }}
          className="pointer-events-auto"
        >
          <LeftSidebar
            isSidebarOpen={isSidebarOpen}
            setIsSidebarOpen={setIsSidebarOpen}
            onHostConnect={closeSidebar}
            disabled={!isAuthenticated || authLoading}
            username={username}
          />
        </div>
      </div>
      <Toaster
        position="bottom-center"
        richColors={false}
        closeButton
        duration={5000}
        offset={20}
      />
    </div>
  );
};

class TabErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; errorCount: number }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, errorCount: 0 };
  }

  static getDerivedStateFromError(error: Error) {
    if (error.message?.includes("useTabs must be used within a TabProvider")) {
      return { hasError: true };
    }
    throw error;
  }

  componentDidCatch(error: Error) {
    if (error.message?.includes("useTabs must be used within a TabProvider")) {
      console.warn(
        "TabProvider mounting race condition detected, recovering...",
      );
      this.setState((prev) => ({ errorCount: prev.errorCount + 1 }));
      setTimeout(() => {
        this.setState({ hasError: false });
      }, 0);
    }
  }

  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

export const MobileApp: FC = () => {
  return (
    <TabProvider>
      <TabErrorBoundary>
        <AppContent />
      </TabErrorBoundary>
    </TabProvider>
  );
};
