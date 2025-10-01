import React, { useState, useEffect, type FC } from "react";
import { Terminal } from "@/ui/Mobile/Apps/Terminal/Terminal.tsx";
import { TerminalKeyboard } from "@/ui/Mobile/Apps/Terminal/TerminalKeyboard.tsx";
import { BottomNavbar } from "@/ui/Mobile/Navigation/BottomNavbar.tsx";
import { LeftSidebar } from "@/ui/Mobile/Navigation/LeftSidebar.tsx";
import {
  TabProvider,
  useTabs,
} from "@/ui/Mobile/Navigation/Tabs/TabContext.tsx";
import { getUserInfo, getCookie } from "@/ui/main-axios.ts";
import { HomepageAuth } from "@/ui/Mobile/Homepage/HomepageAuth.tsx";
import { useTranslation } from "react-i18next";
import { Toaster } from "@/components/ui/sonner.tsx";

const AppContent: FC = () => {
  const { t } = useTranslation();
  const { tabs, currentTab, getTab, removeTab } = useTabs();
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(true);
  const [ready, setReady] = React.useState(true);

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const checkAuth = () => {
      setAuthLoading(true);
      getUserInfo()
        .then((meRes) => {
          setIsAuthenticated(true);
          setIsAdmin(!!meRes.is_admin);
          setUsername(meRes.username || null);

          if (!meRes.data_unlocked) {
            console.warn("User data is locked - re-authentication required");
            setIsAuthenticated(false);
            setIsAdmin(false);
            setUsername(null);
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
      <div className="h-screen w-screen flex items-center justify-center bg-dark-bg-darkest">
        <p className="text-white">{t("common.loading")}</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-dark-bg p-4">
        <HomepageAuth
          setLoggedIn={setIsAuthenticated}
          setIsAdmin={setIsAdmin}
          setUsername={setUsername}
          setUserId={(id) => {}}
          loggedIn={isAuthenticated}
          authLoading={authLoading}
          dbError={null}
          setDbError={(err) => {}}
          onAuthSuccess={handleAuthSuccess}
        />
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-dark-bg-darkest overflow-y-hidden overflow-x-hidden relative">
      <div className="flex-1 min-h-0 relative">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`absolute inset-0 mb-2 ${tab.id === currentTab ? "visible" : "invisible"} ${ready ? "opacity-100" : "opacity-0"}`}
          >
            <Terminal
              ref={tab.terminalRef}
              hostConfig={tab.hostConfig}
              isVisible={tab.id === currentTab}
            />
          </div>
        ))}
        {tabs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-white gap-3 px-4 text-center">
            <h1 className="text-lg font-semibold">
              {t("mobile.selectHostToStart")}
            </h1>
            <p className="text-sm text-gray-300 max-w-xs">
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

export const MobileApp: FC = () => {
  return (
    <TabProvider>
      <AppContent />
    </TabProvider>
  );
};
