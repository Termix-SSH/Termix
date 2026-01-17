import React, { useEffect, useState } from "react";
import { TabProvider } from "@/ui/desktop/navigation/tabs/TabContext.tsx";
import { CommandHistoryProvider } from "@/ui/desktop/apps/features/terminal/command-history/CommandHistoryContext.tsx";
import { SidebarProvider } from "@/components/ui/sidebar.tsx";
import { getSSHHosts } from "@/ui/main-axios.ts";
import type { SSHHost } from "@/types";

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

  useEffect(() => {
    const fetchHost = async () => {
      if (!hostId) {
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

    fetchHost();
  }, [hostId]);

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
