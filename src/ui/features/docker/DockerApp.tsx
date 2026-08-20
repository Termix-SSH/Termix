import React from "react";
import { useTranslation } from "react-i18next";
import { DockerManager } from "@/features/docker/DockerManager.tsx";
import { FullScreenAppWrapper } from "@/features/FullScreenAppWrapper.tsx";
import { ConnectionScreen } from "@/components/connection/ConnectionScreen.tsx";

interface DockerAppProps {
  hostId?: string;
}

const DockerApp: React.FC<DockerAppProps> = ({ hostId }) => {
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
          <DockerManager
            hostConfig={hostConfig}
            title={hostConfig.name || `${hostConfig.username}@${hostConfig.ip}`}
            isVisible={true}
            isTopbarOpen={false}
            embedded={true}
            onClose={() => {}}
          />
        );
      }}
    </FullScreenAppWrapper>
  );
};

export default DockerApp;
