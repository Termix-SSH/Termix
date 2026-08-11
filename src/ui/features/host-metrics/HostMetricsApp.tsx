import React from "react";
import { useTranslation } from "react-i18next";
import { HostMetricsTab } from "@/features/host-metrics/HostMetricsTab.tsx";
import { FullScreenAppWrapper } from "@/features/FullScreenAppWrapper.tsx";
import { ConnectionScreen } from "@/components/connection/ConnectionScreen.tsx";

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
