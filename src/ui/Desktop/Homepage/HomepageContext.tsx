import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { getServerStats, getSSHHosts, getServerStatusById, getServerMetricsById, getQuickAccessData, getUserCount } from '@/ui/main-axios.ts';

interface ServerStats {
  totalHosts: number;
  pinnedHosts: number;
  tunnelHosts: number;
  activeTunnels: number;
  onlineHosts: number;
  offlineHosts: number;
  totalUsers: number;
  credentialsCount: number;
}

interface ServerInfo {
  id: number;
  name: string;
  ip: string;
  port: number;
  username: string;
  status: "online" | "offline" | "unknown";
  lastSeen?: string;
  cpuUsage?: number;
  memoryUsage?: number;
  diskUsage?: number;
}

interface PinnedHost {
  id: number;
  name: string;
  ip: string;
  port: number;
  username: string;
  lastUsed?: string;
}

interface RecentCredential {
  id: number;
  name: string;
  username: string;
  lastUsed?: string;
}

interface HomepageContextType {
  // Server Stats
  serverStats: ServerStats | null;
  servers: ServerInfo[];
  serverStatsLoading: boolean;
  
  // Quick Access
  pinnedHosts: PinnedHost[];
  recentCredentials: RecentCredential[];
  quickAccessLoading: boolean;
  
  // Actions
  refreshServerStats: () => Promise<void>;
  refreshQuickAccess: () => Promise<void>;
}

const HomepageContext = createContext<HomepageContextType | undefined>(undefined);

export function HomepageProvider({ children, isAuthenticated }: { children: ReactNode; isAuthenticated: boolean }) {
  // Server Stats State
  const [serverStats, setServerStats] = useState<ServerStats | null>(null);
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [serverStatsLoading, setServerStatsLoading] = useState(true);
  
  // Quick Access State
  const [pinnedHosts, setPinnedHosts] = useState<PinnedHost[]>([]);
  const [recentCredentials, setRecentCredentials] = useState<RecentCredential[]>([]);
  const [quickAccessLoading, setQuickAccessLoading] = useState(true);

  const fetchServerData = async () => {
    try {
      const [statsData, hostsData, userCountData] = await Promise.all([
        getServerStats(),
        getSSHHosts(),
        getUserCount().catch(() => ({ count: 1 })) // Fallback to 1 if not admin
      ]);

      if (statsData) {
        setServerStats({
          ...statsData,
          totalUsers: userCountData?.count || 1
        });
      }

      if (hostsData) {
        const serversWithStats = await Promise.all(
          hostsData.map(async (host: any) => {
            let status: "online" | "offline" | "unknown" = "unknown";
            let cpuUsage: number | undefined;
            let memoryUsage: number | undefined;
            
            try {
              const [statusRes, metricsRes] = await Promise.all([
                getServerStatusById(host.id),
                getServerMetricsById(host.id).catch(() => null)
              ]);
              
              if (statusRes?.status === "online") {
                status = "online";
                if (metricsRes) {
                  cpuUsage = metricsRes.cpu.percent || undefined;
                  memoryUsage = metricsRes.memory.percent || undefined;
                }
              } else {
                status = "offline";
              }
            } catch (error) {
              status = "offline";
            }

            return {
              id: host.id,
              name: host.name || `${host.username}@${host.ip}`,
              ip: host.ip,
              port: host.port,
              username: host.username,
              status,
              lastSeen: undefined,
              cpuUsage,
              memoryUsage,
              diskUsage: undefined,
            };
          })
        );
        setServers(serversWithStats);
      }
    } catch (error) {
      console.error("Failed to fetch server data:", error);
    } finally {
      setServerStatsLoading(false);
    }
  };

  const fetchQuickAccessData = async () => {
    try {
      const data = await getQuickAccessData();
      setPinnedHosts(data?.pinnedHosts || []);
      setRecentCredentials(data?.recentCredentials || []);
    } catch (error) {
      console.error("Failed to fetch quick access data:", error);
    } finally {
      setQuickAccessLoading(false);
    }
  };

  const refreshServerStats = async () => {
    setServerStatsLoading(true);
    await fetchServerData();
  };

  const refreshQuickAccess = async () => {
    setQuickAccessLoading(true);
    await fetchQuickAccessData();
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchServerData();
      fetchQuickAccessData();
      
      // Refresh server stats every 30 seconds
      const serverInterval = setInterval(fetchServerData, 30000);
      
      return () => {
        clearInterval(serverInterval);
      };
    } else {
      // Reset data when not authenticated
      setServerStats(null);
      setServers([]);
      setPinnedHosts([]);
      setRecentCredentials([]);
      setServerStatsLoading(false);
      setQuickAccessLoading(false);
    }
  }, [isAuthenticated]);

  const value: HomepageContextType = {
    serverStats,
    servers,
    serverStatsLoading,
    pinnedHosts,
    recentCredentials,
    quickAccessLoading,
    refreshServerStats,
    refreshQuickAccess,
  };

  return (
    <HomepageContext.Provider value={value}>
      {children}
    </HomepageContext.Provider>
  );
}

export function useHomepage() {
  const context = useContext(HomepageContext);
  if (context === undefined) {
    throw new Error('useHomepage must be used within a HomepageProvider');
  }
  return context;
}
