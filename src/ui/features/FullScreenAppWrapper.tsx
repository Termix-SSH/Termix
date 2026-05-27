import React, { useEffect, useState } from "react";
import { TabProvider } from "@/shell/TabContext.tsx";
import { CommandHistoryProvider } from "@/features/terminal/command-history/CommandHistoryContext.tsx";
import { SidebarProvider } from "@/components/sidebar.tsx";
import { getSSHHosts, getUserInfo } from "@/main-axios.ts";
import type { SSHHost } from "@/types";
import { Dashboard } from "@/dashboard/Dashboard.tsx";
import { Toaster } from "@/components/sonner.tsx";
import { dbHealthMonitor } from "@/lib/db-health-monitor.ts";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";

interface FullScreenAppWrapperProps {
  hostId?: string;
  children: (hostConfig: SSHHost | null, loading: boolean) => React.ReactNode;
}

export const FullScreenAppWrapper: React.FC<FullScreenAppWrapperProps> = ({
  hostId,
  children,
}) => {
  const { t } = useTranslation();
  const [hostConfig, setHostConfig] = useState<SSHHost | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [, setIsAdmin] = useState(false);

  useEffect(() => {
    const handleSessionExpired = () => {
      setIsAuthenticated(false);
      setIsAdmin(false);
      setHostConfig(null);
    };

    dbHealthMonitor.on("session-expired", handleSessionExpired);
    return () => dbHealthMonitor.off("session-expired", handleSessionExpired);
  }, []);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const userInfo = await getUserInfo();
        if (userInfo) {
          setIsAuthenticated(true);
        }
      } catch {
        setIsAuthenticated(false);
      } finally {
        setAuthLoading(false);
      }
    };

    checkAuth();
  }, []);

  useEffect(() => {
    const fetchHost = async () => {
      if (!hostId || !isAuthenticated) {
        setLoading(false);
        return;
      }

      try {
        const hosts = await getSSHHosts();
        const host = hosts.find((h) => h.id === parseInt(hostId, 10));
        if (host) {
          setHostConfig(host);
        }
      } catch (error) {
        console.error("Failed to fetch host:", error);
      } finally {
        setLoading(false);
      }
    };

    if (!authLoading && isAuthenticated) {
      fetchHost();
    }
  }, [hostId, isAuthenticated, authLoading]);

  const handleAuthSuccess = () => {
    setIsAuthenticated(true);
    window.location.reload();
  };

  if (authLoading) {
    return (
      <div
        className="w-full h-screen overflow-hidden flex flex-col items-center justify-center gap-4"
        style={{ backgroundColor: "var(--bg-base)" }}
      >
        <RefreshCw
          className="size-8 animate-spin"
          style={{ color: "var(--foreground)" }}
        />
        <p className="text-sm" style={{ color: "var(--foreground-secondary)" }}>
          {t("common.loading")}
        </p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <SidebarProvider>
        <TabProvider>
          <CommandHistoryProvider>
            <div
              className="w-full h-screen overflow-hidden flex items-center justify-center"
              style={{ backgroundColor: "var(--bg-base)" }}
            >
              <Dashboard
                isAuthenticated={false}
                authLoading={authLoading}
                onAuthSuccess={handleAuthSuccess}
                isTopbarOpen={false}
                onSelectView={() => {}}
              />
              <Toaster
                position="bottom-right"
                richColors={false}
                closeButton
                duration={5000}
                offset={20}
              />
            </div>
          </CommandHistoryProvider>
        </TabProvider>
      </SidebarProvider>
    );
  }

  return (
    <SidebarProvider>
      <TabProvider>
        <CommandHistoryProvider>
          <div
            className="w-full h-screen overflow-hidden"
            style={{ backgroundColor: "var(--bg-base)" }}
          >
            {children(hostConfig, loading)}
          </div>
        </CommandHistoryProvider>
      </TabProvider>
    </SidebarProvider>
  );
};
