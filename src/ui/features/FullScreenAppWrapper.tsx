import React, { useEffect, useState } from "react";
import { TabProvider } from "@/shell/TabContext.tsx";
import { CommandHistoryProvider } from "@/features/terminal/command-history/CommandHistoryContext.tsx";
import { SidebarProvider } from "@/components/sidebar.tsx";
import {
  getSSHHosts,
  getUserInfo,
  isElectron,
  requestDesktopAutoSession,
} from "@/main-axios.ts";
import type { SSHHost } from "@/types";
import { Auth } from "@/auth/Auth.tsx";
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
    // Popped-out windows (terminal/tunnel/file-manager/etc.) share the main
    // window's session rather than owning their own login -- there's no
    // login form to fall back to here. On a cold Electron launch this
    // window's renderer can start before the embedded backend has finished
    // booting, so a bare failure isn't proof of "logged out"; in Electron
    // it's retried forever (the embedded backend is bundled, always-on
    // infrastructure that always eventually comes up) with a fallback to
    // the same auto-session exchange the main window uses, since a login
    // form must never appear for the local backend. Outside Electron a
    // capped retry still applies, matching the web app's normal behavior.
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const maxAttempts = 10;

    const checkAuth = async (attempt: number) => {
      try {
        const userInfo = await getUserInfo();
        if (cancelled) return;
        if (userInfo) {
          setIsAuthenticated(true);
          setAuthLoading(false);
          return;
        }
      } catch {
        // fall through to retry/auto-session below
      }
      if (cancelled) return;

      if (isElectron()) {
        const outcome = await requestDesktopAutoSession();
        if (cancelled) return;
        if (outcome.kind === "success") {
          setIsAuthenticated(true);
          setAuthLoading(false);
          return;
        }
        if (outcome.kind === "declined") {
          setIsAuthenticated(false);
          setAuthLoading(false);
          return;
        }
        // "retry": keep retrying indefinitely with capped backoff.
        const delay = Math.min(1000 * 2 ** attempt, 10000);
        retryTimer = setTimeout(() => {
          if (!cancelled) checkAuth(attempt + 1);
        }, delay);
        return;
      }

      if (attempt >= maxAttempts) {
        setIsAuthenticated(false);
        setAuthLoading(false);
        return;
      }
      retryTimer = setTimeout(() => {
        if (!cancelled) checkAuth(attempt + 1);
      }, 1000);
    };

    checkAuth(0);
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
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

  // Electron never reaches an unauthenticated render: checkAuth above
  // retries and falls back to the same auto-session exchange the main
  // window uses, so this branch is web-only there -- a real "not logged
  // in" case for a bookmarked/shared full-screen link.

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
              <Auth onLogin={handleAuthSuccess} />
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
