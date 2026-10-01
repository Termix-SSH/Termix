import { FullScreenAppWrapper, ConnectionScreen } from "@termix/plugin-sdk/ui";
import React from "react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import { HostMetricsTab } from "./HostMetricsTab.tsx";

interface HostMetricsAppProps {
  hostId?: string;
}

const HostMetricsApp: React.FC<HostMetricsAppProps> = ({ hostId }) => {
  const { t } = useTranslation();
  return (
    <FullScreenAppWrapper hostId={hostId}>
      {(hostConfig, phase) => {
        if (phase === "loading") {
          return (
            <div className="relative h-full w-full">
              <ConnectionScreen
                status="connecting"
                message={t("hosts.loadingHost")}
              />
            </div>
          );
        }

        if (!hostConfig) {
          return (
            <div className="relative h-full w-full">
              <ConnectionScreen
                status="disconnected"
                message={t("hosts.hostNotFound")}
              />
            </div>
          );
        }

        return (
          <HostMetricsTab
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

export default HostMetricsApp;
