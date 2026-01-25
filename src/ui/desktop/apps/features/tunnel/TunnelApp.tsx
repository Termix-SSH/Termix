import React from "react";
import { TunnelManager } from "@/ui/desktop/apps/features/tunnel/TunnelManager.tsx";
import { FullScreenAppWrapper } from "@/ui/desktop/apps/FullScreenAppWrapper.tsx";

interface TunnelAppProps {
  hostId?: string;
}

const TunnelApp: React.FC<TunnelAppProps> = ({ hostId }) => {
  return (
    <FullScreenAppWrapper hostId={hostId}>
      {(hostConfig, loading) => {
        if (loading) {
          return (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2"></div>
                <p className="text-muted-foreground">Loading host...</p>
              </div>
            </div>
          );
        }

        if (!hostConfig) {
          return (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-red-500 mb-4">Host not found</p>
              </div>
            </div>
          );
        }

        return (
          <TunnelManager
            hostConfig={hostConfig}
            title={hostConfig.name || `${hostConfig.username}@${hostConfig.ip}`}
            isVisible={true}
            isTopbarOpen={false}
            embedded={true}
          />
        );
      }}
    </FullScreenAppWrapper>
  );
};

export default TunnelApp;
