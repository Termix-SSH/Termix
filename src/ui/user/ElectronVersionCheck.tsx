import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/button.tsx";
import { VersionAlert } from "@/components/version-alert.tsx";
import { useTranslation } from "react-i18next";
import { isElectron } from "@/lib/electron";
import { checkElectronUpdate } from "@/main-axios.ts";

interface VersionCheckModalProps {
  onContinue: () => void;
}

type ElectronWindow = Window & {
  electronAPI?: {
    getAppVersion?: () => Promise<string | undefined>;
  };
};

export function ElectronVersionCheck({ onContinue }: VersionCheckModalProps) {
  const { t } = useTranslation();
  const [versionInfo, setVersionInfo] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [versionChecking, setVersionChecking] = useState(false);
  const [versionDismissed] = useState(false);

  const versionModalTitle =
    versionInfo?.status === "beta"
      ? t("versionCheck.betaVersion")
      : t("versionCheck.updateRequired");

  const checkForUpdates = useCallback(async () => {
    setVersionChecking(true);
    try {
      const updateInfo = await checkElectronUpdate();
      setVersionInfo(updateInfo);

      const currentVersion = await (
        window as ElectronWindow
      ).electronAPI?.getAppVersion?.();
      const dismissedVersion = localStorage.getItem(
        "electron-version-check-dismissed",
      );

      if (dismissedVersion === currentVersion) {
        onContinue();
        return;
      }

      if (updateInfo?.status === "up_to_date") {
        if (currentVersion) {
          localStorage.setItem(
            "electron-version-check-dismissed",
            currentVersion,
          );
        }
        onContinue();
        return;
      }
    } catch (error) {
      console.error("Failed to check for updates:", error);
      setVersionInfo({ success: false, error: "Check failed" });
    } finally {
      setVersionChecking(false);
    }
  }, [onContinue]);

  useEffect(() => {
    const updateCheckDisabled =
      localStorage.getItem("disableUpdateCheck") === "true";
    if (updateCheckDisabled) {
      onContinue();
      return;
    }
    if (isElectron()) {
      checkForUpdates();
    } else {
      onContinue();
    }
  }, [checkForUpdates, onContinue]);

  const handleDownloadUpdate = () => {
    if (versionInfo?.latest_release?.html_url) {
      window.open(versionInfo.latest_release.html_url, "_blank");
    }
  };

  const handleContinue = async () => {
    const currentVersion = await (
      window as ElectronWindow
    ).electronAPI?.getAppVersion?.();
    if (currentVersion) {
      localStorage.setItem("electron-version-check-dismissed", currentVersion);
    }
    onContinue();
  };

  if (!isElectron()) {
    return null;
  }

  if (versionChecking && !versionInfo) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background p-6 z-50">
        <div className="flex flex-col gap-5 p-6 border border-border bg-background max-w-md w-full items-center">
          <div className="w-5 h-5 border-2 border-accent-brand border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">
            {t("versionCheck.checkingUpdates")}
          </p>
        </div>
      </div>
    );
  }

  if (!versionInfo || versionDismissed) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background p-6 z-50">
        <div className="flex flex-col gap-5 p-6 border border-border bg-background max-w-md w-full">
          <p className="font-bold">{t("versionCheck.checkUpdates")}</p>
          {versionInfo && !versionDismissed && (
            <VersionAlert
              updateInfo={versionInfo}
              onDownload={handleDownloadUpdate}
            />
          )}
          <Button
            onClick={handleContinue}
            className="w-full bg-accent-brand hover:bg-accent-brand/90 text-background font-bold rounded-none"
          >
            {t("common.continue")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background p-6 z-50">
      <div className="flex flex-col gap-5 p-6 border border-border bg-background max-w-md w-full">
        <p className="font-bold">{versionModalTitle}</p>
        <VersionAlert
          updateInfo={versionInfo}
          onDownload={handleDownloadUpdate}
        />
        <Button
          onClick={handleContinue}
          className="w-full bg-accent-brand hover:bg-accent-brand/90 text-background font-bold rounded-none"
        >
          {t("common.continue")}
        </Button>
      </div>
    </div>
  );
}
