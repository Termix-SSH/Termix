import React from "react";
import { useTranslation } from "react-i18next";
import { HostMetricsTab } from "@/features/host-metrics/HostMetricsTab.tsx";
import { FullScreenAppWrapper } from "@/features/FullScreenAppWrapper.tsx";

interface HostMetricsAppProps {
  hostId?: string;
}

const HostMetricsApp: React.FC<HostMetricsAppProps> = ({ hostId }) => {
  const { t } = useTranslation();
  return (
    <FullScreenAppWrapper hostId={hostId}>
      {(hostConfig, loading) => {
        if (loading) {
          return (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-b-2 border-white"></div>
                <p className="text-muted-foreground">
                  {t("hosts.loadingHost")}
                </p>
              </div>
            </div>
          );
        }

        if (!hostConfig) {
          return (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <p className="mb-4 text-red-500">{t("hosts.hostNotFound")}</p>
              </div>
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
