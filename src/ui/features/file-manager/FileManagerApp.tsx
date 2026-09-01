import React from "react";
import { useTranslation } from "react-i18next";
import { FileManager } from "@/features/file-manager/FileManager.tsx";
import { FullScreenAppWrapper } from "@/features/FullScreenAppWrapper.tsx";
import { ConnectionScreen } from "@/components/connection/ConnectionScreen.tsx";

interface FileManagerAppProps {
  hostId?: string;
  initialPath?: string;
}

const FileManagerApp: React.FC<FileManagerAppProps> = ({
  hostId,
  initialPath,
}) => {
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
          <FileManager
            initialHost={hostConfig}
            initialPath={initialPath}
            onClose={() => {}}
          />
        );
      }}
    </FullScreenAppWrapper>
  );
};

export default FileManagerApp;
