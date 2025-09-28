import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button.tsx";
import { VersionAlert } from "@/components/ui/version-alert.tsx";
import { RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { checkElectronUpdate, isElectron } from "@/ui/main-axios.ts";

interface VersionCheckModalProps {
  onDismiss: () => void;
  onContinue: () => void;
}

export function VersionCheckModal({ onDismiss, onContinue }: VersionCheckModalProps) {
  const { t } = useTranslation();
  const [versionInfo, setVersionInfo] = useState<any>(null);
  const [versionChecking, setVersionChecking] = useState(false);
  const [versionDismissed, setVersionDismissed] = useState(false);

  useEffect(() => {
    if (isElectron()) {
      checkForUpdates();
    } else {
      onContinue();
    }
  }, []);

  const checkForUpdates = async () => {
    setVersionChecking(true);
    try {
      const updateInfo = await checkElectronUpdate();
      setVersionInfo(updateInfo);
    } catch (error) {
      console.error("Failed to check for updates:", error);
      setVersionInfo({ success: false, error: "Check failed" });
    } finally {
      setVersionChecking(false);
    }
  };

  const handleVersionDismiss = () => {
    setVersionDismissed(true);
  };

  const handleDownloadUpdate = () => {
    if (versionInfo?.latest_release?.html_url) {
      window.open(versionInfo.latest_release.html_url, "_blank");
    }
  };

  const handleContinue = () => {
    onContinue();
  };

  if (!isElectron()) {
    return null;
  }

  if (versionChecking && !versionInfo) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-dark-bg border border-dark-border rounded-lg p-6 max-w-md w-full mx-4">
          <div className="flex items-center justify-center mb-4">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
          <p className="text-center text-muted-foreground">
            {t("versionCheck.checkingUpdates")}
          </p>
        </div>
      </div>
    );
  }

  if (!versionInfo || versionInfo.status === "up_to_date" || versionDismissed) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-dark-bg border border-dark-border rounded-lg p-6 max-w-md w-full mx-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">
              {t("versionCheck.checkUpdates")}
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDismiss}
              className="h-6 w-6 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          
          {versionInfo && !versionDismissed && (
            <div className="mb-4">
              <VersionAlert
                updateInfo={versionInfo}
                onDismiss={handleVersionDismiss}
                onDownload={handleDownloadUpdate}
                showDismiss={true}
              />
            </div>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={checkForUpdates}
              disabled={versionChecking}
              className="flex-1"
            >
              {versionChecking ? (
                <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}
              {t("versionCheck.refresh")}
            </Button>
            <Button
              onClick={handleContinue}
              className="flex-1"
            >
              {t("common.continue")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-dark-bg border border-dark-border rounded-lg p-6 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">
            {t("versionCheck.updateRequired")}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDismiss}
            className="h-6 w-6 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        
        <div className="mb-4">
          <VersionAlert
            updateInfo={versionInfo}
            onDismiss={handleVersionDismiss}
            onDownload={handleDownloadUpdate}
            showDismiss={true}
          />
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={checkForUpdates}
            disabled={versionChecking}
            className="flex-1"
          >
            {versionChecking ? (
              <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
            {t("versionCheck.refresh")}
          </Button>
          <Button
            onClick={handleContinue}
            className="flex-1"
          >
            {t("common.continue")}
          </Button>
        </div>
      </div>
    </div>
  );
}
