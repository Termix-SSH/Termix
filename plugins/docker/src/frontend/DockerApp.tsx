import { ConnectionScreen, FullScreenAppWrapper } from "@termix/plugin-sdk/ui";
import React from "react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import { DockerManager } from "./DockerManager.tsx";
import { toDockerHost } from "./types";

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
            host={toDockerHost(
              hostConfig as unknown as Record<string, unknown>,
            )}
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
