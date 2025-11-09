import React, { useState, useEffect, useCallback, useRef } from "react";
import { LeftSidebar } from "@/ui/desktop/navigation/LeftSidebar.tsx";
import { Dashboard } from "@/ui/desktop/apps/dashboard/Dashboard.tsx";
import { AppView } from "@/ui/desktop/navigation/AppView.tsx";
import { HostManager } from "@/ui/desktop/apps/host-manager/HostManager.tsx";
import {
  TabProvider,
  useTabs,
} from "@/ui/desktop/navigation/tabs/TabContext.tsx";
import { TopNavbar } from "@/ui/desktop/navigation/TopNavbar.tsx";
import { AdminSettings } from "@/ui/desktop/admin/AdminSettings.tsx";
import { UserProfile } from "@/ui/desktop/user/UserProfile.tsx";
import { Toaster } from "@/components/ui/sonner.tsx";
import { CommandPalette } from "@/ui/desktop/apps/command-palette/CommandPalette.tsx";
import { getUserInfo } from "@/ui/main-axios.ts";

function AppContent() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [isTopbarOpen, setIsTopbarOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem("topNavbarOpen");
    return saved !== null ? JSON.parse(saved) : true;
  });
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionPhase, setTransitionPhase] = useState<'idle' | 'fadeOut' | 'fadeIn'>('idle');
  const { currentTab, tabs } = useTabs();
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  const lastShiftPressTime = useRef(0);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === "ShiftLeft") {
        const now = Date.now();
        if (now - lastShiftPressTime.current < 300) {
          setIsCommandPaletteOpen((isOpen) => !isOpen);
        }
        lastShiftPressTime.current = now;
      }
      if (event.key === "Escape") {
        setIsCommandPaletteOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
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
          setIsAuthenticated(false);
          setIsAdmin(false);
          setUsername(null);

          const errorCode = err?.response?.data?.code;
          if (errorCode === "SESSION_EXPIRED") {
            console.warn("Session expired - please log in again");
          }
        })
        .finally(() => {
          setAuthLoading(false);
        });
    };

    checkAuth();

    const handleStorageChange = () => checkAuth();
    window.addEventListener("storage", handleStorageChange);

    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  useEffect(() => {
    localStorage.setItem("topNavbarOpen", JSON.stringify(isTopbarOpen));
  }, [isTopbarOpen]);

  const handleSelectView = () => {};

  const handleAuthSuccess = useCallback(
    (authData: {
      isAdmin: boolean;
      username: string | null;
      userId: string | null;
    }) => {
      setIsTransitioning(true);
      setTransitionPhase('fadeOut');

      setTimeout(() => {
        setIsAuthenticated(true);
        setIsAdmin(authData.isAdmin);
        setUsername(authData.username);
        setTransitionPhase('fadeIn');

        setTimeout(() => {
          setIsTransitioning(false);
          setTransitionPhase('idle');
        }, 800);
      }, 1200);
    },
    [],
  );

  const handleLogout = useCallback(async () => {
    setIsTransitioning(true);
    setTransitionPhase('fadeOut');

    setTimeout(async () => {
      try {
        const { logoutUser, isElectron } = await import("@/ui/main-axios.ts");
        await logoutUser();

        if (isElectron()) {
          localStorage.removeItem("jwt");
        }
      } catch (error) {
        console.error("Logout failed:", error);
      }

      window.location.reload();
    }, 1200);
  }, []);

  const currentTabData = tabs.find((tab) => tab.id === currentTab);
  const showTerminalView =
    currentTabData?.type === "terminal" ||
    currentTabData?.type === "server" ||
    currentTabData?.type === "file_manager";
  const showHome = currentTabData?.type === "home";
  const showSshManager = currentTabData?.type === "ssh_manager";
  const showAdmin = currentTabData?.type === "admin";
  const showProfile = currentTabData?.type === "user_profile";

  return (
    <div>
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        setIsOpen={setIsCommandPaletteOpen}
      />
      {!isAuthenticated && !authLoading && (
        <div className="fixed inset-0 flex items-center justify-center z-[10000]">
          <Dashboard
            onSelectView={handleSelectView}
            isAuthenticated={isAuthenticated}
            authLoading={authLoading}
            onAuthSuccess={handleAuthSuccess}
            isTopbarOpen={isTopbarOpen}
          />
        </div>
      )}

      {isAuthenticated && (
        <LeftSidebar
            onSelectView={handleSelectView}
            disabled={!isAuthenticated || authLoading}
            isAdmin={isAdmin}
            username={username}
            onLogout={handleLogout}
          >
          <div
            className="h-screen w-full visible pointer-events-auto static overflow-hidden"
            style={{ display: showTerminalView ? "block" : "none" }}
          >
            <AppView isTopbarOpen={isTopbarOpen} />
          </div>

          {showHome && (
            <div className="h-screen w-full visible pointer-events-auto static overflow-hidden">
              <Dashboard
                onSelectView={handleSelectView}
                isAuthenticated={isAuthenticated}
                authLoading={authLoading}
                onAuthSuccess={handleAuthSuccess}
                isTopbarOpen={isTopbarOpen}
              />
            </div>
          )}

          {showSshManager && (
            <div className="h-screen w-full visible pointer-events-auto static overflow-hidden">
              <HostManager
                onSelectView={handleSelectView}
                isTopbarOpen={isTopbarOpen}
                initialTab={currentTabData?.initialTab}
                hostConfig={currentTabData?.hostConfig}
              />
            </div>
          )}

          {showAdmin && (
            <div className="h-screen w-full visible pointer-events-auto static overflow-hidden">
              <AdminSettings isTopbarOpen={isTopbarOpen} />
            </div>
          )}

          {showProfile && (
            <div className="h-screen w-full visible pointer-events-auto static overflow-auto">
              <UserProfile isTopbarOpen={isTopbarOpen} />
            </div>
          )}

          <TopNavbar
            isTopbarOpen={isTopbarOpen}
            setIsTopbarOpen={setIsTopbarOpen}
            onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
          />
        </LeftSidebar>
      )}

      {isTransitioning && (
        <div
          className={`fixed inset-0 bg-background z-[20000] transition-opacity duration-700 ${
            transitionPhase === 'fadeOut' ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {transitionPhase === 'fadeOut' && (
            <>
              <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
                <div className="absolute w-0 h-0 bg-primary/10 rounded-full"
                     style={{
                       animation: 'ripple 2.5s cubic-bezier(0.4, 0, 0.2, 1) forwards',
                       animationDelay: '0ms'
                     }}
                />
                <div className="absolute w-0 h-0 bg-primary/7 rounded-full"
                     style={{
                       animation: 'ripple 2.5s cubic-bezier(0.4, 0, 0.2, 1) forwards',
                       animationDelay: '200ms'
                     }}
                />
                <div className="absolute w-0 h-0 bg-primary/5 rounded-full"
                     style={{
                       animation: 'ripple 2.5s cubic-bezier(0.4, 0, 0.2, 1) forwards',
                       animationDelay: '400ms'
                     }}
                />
                <div className="absolute w-0 h-0 bg-primary/3 rounded-full"
                     style={{
                       animation: 'ripple 2.5s cubic-bezier(0.4, 0, 0.2, 1) forwards',
                       animationDelay: '600ms'
                     }}
                />
                <div className="relative z-10 text-center"
                     style={{
                       animation: 'logoFade 1.6s cubic-bezier(0.4, 0, 0.2, 1) forwards'
                     }}>
                  <div className="text-7xl font-bold tracking-wider"
                       style={{
                         fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                         animation: 'logoGlow 1.6s cubic-bezier(0.4, 0, 0.2, 1) forwards'
                       }}>
                    TERMIX
                  </div>
                  <div className="text-sm text-muted-foreground mt-3 tracking-widest"
                       style={{
                         animation: 'subtitleFade 1.6s cubic-bezier(0.4, 0, 0.2, 1) forwards'
                       }}>
                    SSH TERMINAL MANAGER
                  </div>
                </div>
              </div>
              <style>{`
                @keyframes ripple {
                  0% {
                    width: 0;
                    height: 0;
                    opacity: 1;
                  }
                  30% {
                    opacity: 0.6;
                  }
                  70% {
                    opacity: 0.3;
                  }
                  100% {
                    width: 200vmax;
                    height: 200vmax;
                    opacity: 0;
                  }
                }
                @keyframes logoFade {
                  0% {
                    opacity: 0;
                    transform: scale(0.85);
                    filter: blur(8px);
                  }
                  25% {
                    opacity: 1;
                    transform: scale(1);
                    filter: blur(0px);
                  }
                  75% {
                    opacity: 1;
                    transform: scale(1);
                    filter: blur(0px);
                  }
                  100% {
                    opacity: 0;
                    transform: scale(1.05);
                    filter: blur(4px);
                  }
                }
                @keyframes logoGlow {
                  0% {
                    color: hsl(var(--primary));
                    text-shadow: none;
                  }
                  25% {
                    color: hsl(var(--primary));
                    text-shadow:
                      0 0 20px hsla(var(--primary), 0.3),
                      0 0 40px hsla(var(--primary), 0.2),
                      0 0 60px hsla(var(--primary), 0.1);
                  }
                  75% {
                    color: hsl(var(--primary));
                    text-shadow:
                      0 0 20px hsla(var(--primary), 0.3),
                      0 0 40px hsla(var(--primary), 0.2),
                      0 0 60px hsla(var(--primary), 0.1);
                  }
                  100% {
                    color: hsl(var(--primary));
                    text-shadow: none;
                  }
                }
                @keyframes subtitleFade {
                  0%, 30% {
                    opacity: 0;
                    transform: translateY(10px);
                  }
                  50% {
                    opacity: 1;
                    transform: translateY(0);
                  }
                  75% {
                    opacity: 1;
                    transform: translateY(0);
                  }
                  100% {
                    opacity: 0;
                    transform: translateY(-5px);
                  }
                }
              `}</style>
            </>
          )}
        </div>
      )}

      <Toaster
        position="bottom-right"
        richColors={false}
        closeButton
        duration={5000}
        offset={20}
      />
    </div>
  );
}

function DesktopApp() {
  return (
    <TabProvider>
      <AppContent />
    </TabProvider>
  );
}

export default DesktopApp;
