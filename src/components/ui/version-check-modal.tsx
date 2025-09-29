import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button.tsx";
import { VersionAlert } from "@/components/ui/version-alert.tsx";
import { RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { checkElectronUpdate, isElectron } from "@/ui/main-axios.ts";

interface VersionCheckModalProps {
  onDismiss: () => void;
  onContinue: () => void;
  isAuthenticated?: boolean;
}

export function VersionCheckModal({
  onDismiss,
  onContinue,
  isAuthenticated = false,
}: VersionCheckModalProps) {
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

      if (updateInfo?.status === "up_to_date") {
        onContinue();
        return;
      }
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
      <div className="fixed inset-0 flex items-center justify-center z-50">
        {!isAuthenticated && (
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `linear-gradient(
                135deg,
                transparent 0%,
                transparent 49%,
                rgba(255, 255, 255, 0.03) 49%,
                rgba(255, 255, 255, 0.03) 51%,
                transparent 51%,
                transparent 100%
              )`,
              backgroundSize: "80px 80px",
            }}
          />
        )}
        <div className="bg-dark-bg border-2 border-dark-border rounded-lg p-6 max-w-md w-full mx-4 relative z-10">
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

  if (!versionInfo || versionDismissed) {
    return (
      <div className="fixed inset-0 flex items-center justify-center z-50">
        {!isAuthenticated && (
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `linear-gradient(
                135deg,
                transparent 0%,
                transparent 49%,
                rgba(255, 255, 255, 0.03) 49%,
                rgba(255, 255, 255, 0.03) 51%,
                transparent 51%,
                transparent 100%
              )`,
              backgroundSize: "80px 80px",
            }}
          />
        )}
        <div className="bg-dark-bg border-2 border-dark-border rounded-lg p-6 max-w-md w-full mx-4 relative z-10">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">
              {t("versionCheck.checkUpdates")}
            </h2>
          </div>

          {versionInfo && !versionDismissed && (
            <div className="mb-4">
              <VersionAlert
                updateInfo={versionInfo}
                onDownload={handleDownloadUpdate}
              />
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={handleContinue} className="flex-1 h-10">
              {t("common.continue")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50">
      {!isAuthenticated && (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `linear-gradient(
              135deg,
              transparent 0%,
              transparent 49%,
              rgba(255, 255, 255, 0.03) 49%,
              rgba(255, 255, 255, 0.03) 51%,
              transparent 51%,
              transparent 100%
            )`,
            backgroundSize: "80px 80px",
          }}
        />
      )}
      <div className="bg-dark-bg border-2 border-dark-border rounded-lg p-6 max-w-md w-full mx-4 relative z-10">
        <div className="mb-4">
          <h2 className="text-lg font-semibold">
            {t("versionCheck.updateRequired")}
          </h2>
        </div>

        <div className="mb-4">
          <VersionAlert
            updateInfo={versionInfo}
            onDownload={handleDownloadUpdate}
          />
        </div>

        <div className="flex gap-2">
          <Button onClick={handleContinue} className="flex-1 h-10">
            {t("common.continue")}
          </Button>
        </div>
      </div>
    </div>
  );
}
