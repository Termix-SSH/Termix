import React from "react";
import { useTranslation } from "react-i18next";
import { FileManager } from "@/features/file-manager/FileManager.tsx";
import { FullScreenAppWrapper } from "@/features/FullScreenAppWrapper.tsx";

interface FileManagerAppProps {
  hostId?: string;
}

const FileManagerApp: React.FC<FileManagerAppProps> = ({ hostId }) => {
  const { t } = useTranslation();
  return (
    <FullScreenAppWrapper hostId={hostId}>
      {(hostConfig, loading) => {
        if (loading) {
          return (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2"></div>
                <p className="text-muted-foreground">
                  {t("hosts.loadingHost")}
                </p>
              </div>
            </div>
          );
        }

        if (!hostConfig) {
          return (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-red-500 mb-4">{t("hosts.hostNotFound")}</p>
              </div>
            </div>
          );
        }

        return (
          <FileManager
            embedded={true}
            initialHost={hostConfig}
            onClose={() => {}}
          />
        );
      }}
    </FullScreenAppWrapper>
  );
};

export default FileManagerApp;
