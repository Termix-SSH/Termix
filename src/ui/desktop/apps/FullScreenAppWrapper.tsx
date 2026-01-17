import React, { useEffect, useState } from "react";
import { TabProvider } from "@/ui/desktop/navigation/tabs/TabContext.tsx";
import { CommandHistoryProvider } from "@/ui/desktop/apps/features/terminal/command-history/CommandHistoryContext.tsx";
import { SidebarProvider } from "@/components/ui/sidebar.tsx";
import { getSSHHosts, getUserInfo } from "@/ui/main-axios.ts";
import type { SSHHost } from "@/types";
import { Dashboard } from "@/ui/desktop/apps/dashboard/Dashboard.tsx";
import { Toaster } from "@/components/ui/sonner.tsx";

interface FullScreenAppWrapperProps {
  hostId?: string;
  children: (hostConfig: SSHHost | null, loading: boolean) => React.ReactNode;
}

export const FullScreenAppWrapper: React.FC<FullScreenAppWrapperProps> = ({
  hostId,
  children,
}) => {
  const [hostConfig, setHostConfig] = useState<SSHHost | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const userInfo = await getUserInfo();
        if (userInfo) {
          setIsAuthenticated(true);
          setIsAdmin(userInfo.isAdmin || false);
        }
      } catch (error) {
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

  const handleAuthSuccess = (authData: {
    isAdmin: boolean;
    username: string | null;
    userId: string | null;
  }) => {
    setIsAuthenticated(true);
    setIsAdmin(authData.isAdmin);
    window.location.reload();
  };

  if (authLoading) {
    return (
      <div
        className="w-full h-screen overflow-hidden flex items-center justify-center"
        style={{ backgroundColor: "#18181b" }}
      >
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
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
              style={{ backgroundColor: "#18181b" }}
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
            style={{ backgroundColor: "#18181b" }}
          >
            {children(hostConfig, loading)}
          </div>
        </CommandHistoryProvider>
      </TabProvider>
    </SidebarProvider>
  );
};
