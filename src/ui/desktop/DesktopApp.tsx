import React, { useState, useEffect, useCallback, useRef } from "react";
import { LeftSidebar } from "@/ui/desktop/navigation/LeftSidebar.tsx";
import { Dashboard } from "@/ui/desktop/apps/dashboard/Dashboard.tsx";
import { AppView } from "@/ui/desktop/navigation/AppView.tsx";
import { HostManager } from "@/ui/desktop/apps/host-manager/hosts/HostManager.tsx";
import {
  TabProvider,
  useTabs,
} from "@/ui/desktop/navigation/tabs/TabContext.tsx";
import { TopNavbar } from "@/ui/desktop/navigation/TopNavbar.tsx";
import { CommandHistoryProvider } from "@/ui/desktop/apps/features/terminal/command-history/CommandHistoryContext.tsx";
import { AdminSettings } from "@/ui/desktop/apps/admin/AdminSettings.tsx";
import { UserProfile } from "@/ui/desktop/user/UserProfile.tsx";
import { Toaster } from "@/components/ui/sonner.tsx";
import { CommandPalette } from "@/ui/desktop/apps/command-palette/CommandPalette.tsx";
import { getUserInfo } from "@/ui/main-axios.ts";
import { useTheme } from "@/components/theme-provider";

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
  const [transitionPhase, setTransitionPhase] = useState<
    "idle" | "fadeOut" | "fadeIn"
  >("idle");
  const { currentTab, tabs } = useTabs();
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(400);

  const isDarkMode =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  const lineColor = isDarkMode ? "#151517" : "#f9f9f9";

  const lastShiftPressTime = useRef(0);

  // DEBUG: Theme toggle - double-tap left Alt/Option to toggle light/dark mode
  // Comment out the next line and the AltLeft handler below to disable
  const lastAltPressTime = useRef(0);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === "ShiftLeft") {
        if (event.repeat) {
          return;
        }
        const now = Date.now();
        if (now - lastShiftPressTime.current < 300) {
          setIsCommandPaletteOpen((isOpen) => !isOpen);
          lastShiftPressTime.current = 0;
        } else {
          lastShiftPressTime.current = now;
        }
      }

      // DEBUG: Double-tap left Alt/Option to toggle light/dark theme
      // Remove or comment out this block for production
      /* DEBUG_THEME_TOGGLE_START */
      if (event.code === "AltLeft" && !event.repeat) {
        const now = Date.now();
        if (now - lastAltPressTime.current < 300) {
          // Use setTheme to properly update React state (not just DOM class)
          const currentIsDark =
            theme === "dark" ||
            (theme === "system" &&
              window.matchMedia("(prefers-color-scheme: dark)").matches);
          const newTheme = currentIsDark ? "light" : "dark";
          setTheme(newTheme);
          console.log("[DEBUG] Theme toggled:", newTheme);
          lastAltPressTime.current = 0;
        } else {
          lastAltPressTime.current = now;
        }
      }
      /* DEBUG_THEME_TOGGLE_END */

      if (event.key === "Escape") {
        setIsCommandPaletteOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [theme, setTheme]);

  useEffect(() => {
    const checkAuth = () => {
      setAuthLoading(true);
      getUserInfo()
        .then((meRes) => {
          if (typeof meRes === "string" || !meRes.username) {
            setIsAuthenticated(false);
            setIsAdmin(false);
            setUsername(null);
            localStorage.removeItem("jwt");
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

          localStorage.removeItem("jwt");

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
      setTransitionPhase("fadeOut");

      setTimeout(() => {
        setIsAuthenticated(true);
        setIsAdmin(authData.isAdmin);
        setUsername(authData.username);
        setTransitionPhase("fadeIn");

        setTimeout(() => {
          setIsTransitioning(false);
          setTransitionPhase("idle");
        }, 800);
      }, 1200);
    },
    [],
  );

  const handleLogout = useCallback(async () => {
    setIsTransitioning(true);
    setTransitionPhase("fadeOut");

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
    currentTabData?.type === "file_manager" ||
    currentTabData?.type === "tunnel" ||
    currentTabData?.type === "docker";
  const showHome = currentTabData?.type === "home";
  const showSshManager = currentTabData?.type === "ssh_manager";
  const showAdmin = currentTabData?.type === "admin";
  const showProfile = currentTabData?.type === "user_profile";

  if (authLoading) {
    return (
      <div
        className="h-screen w-screen flex items-center justify-center"
        style={{
          background: "var(--bg-elevated)",
          backgroundImage: `repeating-linear-gradient(
            225deg,
            transparent,
            transparent 35px,
            ${lineColor} 35px,
            ${lineColor} 37px
          )`,
        }}
      >
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-background">
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        setIsOpen={setIsCommandPaletteOpen}
      />
      {!isAuthenticated && (
        <div className="fixed inset-0 flex items-center justify-center z-[10000] bg-background">
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
            <AppView
              isTopbarOpen={isTopbarOpen}
              rightSidebarOpen={rightSidebarOpen}
              rightSidebarWidth={rightSidebarWidth}
            />
          </div>

          {showHome && (
            <div className="h-screen w-full visible pointer-events-auto static overflow-hidden">
              <Dashboard
                onSelectView={handleSelectView}
                isAuthenticated={isAuthenticated}
                authLoading={authLoading}
                onAuthSuccess={handleAuthSuccess}
                isTopbarOpen={isTopbarOpen}
                rightSidebarOpen={rightSidebarOpen}
                rightSidebarWidth={rightSidebarWidth}
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
                _updateTimestamp={currentTabData?._updateTimestamp}
                rightSidebarOpen={rightSidebarOpen}
                rightSidebarWidth={rightSidebarWidth}
              />
            </div>
          )}

          {showAdmin && (
            <div className="h-screen w-full visible pointer-events-auto static overflow-hidden">
              <AdminSettings
                isTopbarOpen={isTopbarOpen}
                rightSidebarOpen={rightSidebarOpen}
                rightSidebarWidth={rightSidebarWidth}
              />
            </div>
          )}

          {showProfile && (
            <div className="h-screen w-full visible pointer-events-auto static overflow-auto thin-scrollbar">
              <UserProfile
                isTopbarOpen={isTopbarOpen}
                rightSidebarOpen={rightSidebarOpen}
                rightSidebarWidth={rightSidebarWidth}
              />
            </div>
          )}

          <TopNavbar
            isTopbarOpen={isTopbarOpen}
            setIsTopbarOpen={setIsTopbarOpen}
            onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
            onRightSidebarStateChange={(isOpen, width) => {
              setRightSidebarOpen(isOpen);
              setRightSidebarWidth(width);
            }}
          />
        </LeftSidebar>
      )}

      {isTransitioning && (
        <div
          className={`fixed inset-0 z-[20000] transition-opacity duration-700 ${
            transitionPhase === "fadeOut" ? "opacity-100" : "opacity-0"
          }`}
          style={{
            background: "var(--bg-elevated)",
            backgroundImage: `repeating-linear-gradient(
              45deg,
              transparent,
              transparent 35px,
              ${lineColor} 35px,
              ${lineColor} 37px
            )`,
          }}
        >
          {transitionPhase === "fadeOut" && (
            <>
              <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
                <div
                  className="absolute w-0 h-0 bg-primary/10 rounded-full"
                  style={{
                    animation:
                      "ripple 2.5s cubic-bezier(0.4, 0, 0.2, 1) forwards",
                    animationDelay: "0ms",
                    willChange: "width, height, opacity",
                    transform: "translateZ(0)",
                  }}
                />
                <div
                  className="absolute w-0 h-0 bg-primary/7 rounded-full"
                  style={{
                    animation:
                      "ripple 2.5s cubic-bezier(0.4, 0, 0.2, 1) forwards",
                    animationDelay: "200ms",
                    willChange: "width, height, opacity",
                    transform: "translateZ(0)",
                  }}
                />
                <div
                  className="absolute w-0 h-0 bg-primary/5 rounded-full"
                  style={{
                    animation:
                      "ripple 2.5s cubic-bezier(0.4, 0, 0.2, 1) forwards",
                    animationDelay: "400ms",
                    willChange: "width, height, opacity",
                    transform: "translateZ(0)",
                  }}
                />
                <div
                  className="absolute w-0 h-0 bg-primary/3 rounded-full"
                  style={{
                    animation:
                      "ripple 2.5s cubic-bezier(0.4, 0, 0.2, 1) forwards",
                    animationDelay: "600ms",
                    willChange: "width, height, opacity",
                    transform: "translateZ(0)",
                  }}
                />
                <div
                  className="relative z-10 text-center"
                  style={{
                    animation:
                      "logoFade 1.6s cubic-bezier(0.4, 0, 0.2, 1) forwards",
                    willChange: "opacity, transform",
                  }}
                >
                  <div
                    className="text-7xl font-bold tracking-wider"
                    style={{
                      fontFamily:
                        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                      animation:
                        "logoGlow 1.6s cubic-bezier(0.4, 0, 0.2, 1) forwards",
                      willChange: "color, text-shadow",
                    }}
                  >
                    TERMIX
                  </div>
                  <div
                    className="text-sm text-muted-foreground mt-3 tracking-widest"
                    style={{
                      animation:
                        "subtitleFade 1.6s cubic-bezier(0.4, 0, 0.2, 1) forwards",
                      willChange: "opacity, transform",
                    }}
                  >
                    SSH SERVER MANAGER
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
                    transform: scale(0.85) translateZ(0);
                  }
                  25% {
                    opacity: 1;
                    transform: scale(1) translateZ(0);
                  }
                  75% {
                    opacity: 1;
                    transform: scale(1) translateZ(0);
                  }
                  100% {
                    opacity: 0;
                    transform: scale(1.05) translateZ(0);
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
                    transform: translateY(10px) translateZ(0);
                  }
                  50% {
                    opacity: 1;
                    transform: translateY(0) translateZ(0);
                  }
                  75% {
                    opacity: 1;
                    transform: translateY(0) translateZ(0);
                  }
                  100% {
                    opacity: 0;
                    transform: translateY(-5px) translateZ(0);
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
      <CommandHistoryProvider>
        <AppContent />
      </CommandHistoryProvider>
    </TabProvider>
  );
}

export default DesktopApp;
