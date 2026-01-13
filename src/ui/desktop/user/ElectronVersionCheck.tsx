import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button.tsx";
import { VersionAlert } from "@/components/ui/version-alert.tsx";
import { useTranslation } from "react-i18next";
import { checkElectronUpdate, isElectron } from "@/ui/main-axios.ts";
import { useTheme } from "@/components/theme-provider";

interface VersionCheckModalProps {
  onContinue: () => void;
  isAuthenticated?: boolean;
}

export function ElectronVersionCheck({
  onContinue,
  isAuthenticated = false,
}: VersionCheckModalProps) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const [versionInfo, setVersionInfo] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [versionChecking, setVersionChecking] = useState(false);
  const [versionDismissed] = useState(false);

  const isDarkMode =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  const lineColor = isDarkMode ? "#151517" : "#f9f9f9";

  useEffect(() => {
    const updateCheckDisabled = localStorage.getItem("disableUpdateCheck") === "true";
    if (updateCheckDisabled) {
      onContinue();
      return;
    }
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

      const currentVersion = await (window as any).electronAPI?.getAppVersion();
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
  };

  const handleDownloadUpdate = () => {
    if (versionInfo?.latest_release?.html_url) {
      window.open(versionInfo.latest_release.html_url, "_blank");
    }
  };

  const handleContinue = async () => {
    const currentVersion = await (window as any).electronAPI?.getAppVersion();
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
      <div
        className="fixed inset-0 flex items-center justify-center z-50"
        style={{
          background: "var(--bg-elevated)",
          backgroundImage: `repeating-linear-gradient(
            45deg,
            transparent,
            transparent 35px,
            ${lineColor} 35px,
            ${lineColor} 37px
          )`,
        }}
      >
        <div className="w-[420px] max-w-full p-8 flex flex-col backdrop-blur-sm bg-card/50 rounded-2xl shadow-xl border-2 border-edge overflow-y-auto thin-scrollbar my-2 animate-in fade-in zoom-in-95 duration-300">
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
      <div
        className="fixed inset-0 flex items-center justify-center z-50"
        style={{
          background: "var(--bg-elevated)",
          backgroundImage: `repeating-linear-gradient(
            45deg,
            transparent,
            transparent 35px,
            ${lineColor} 35px,
            ${lineColor} 37px
          )`,
        }}
      >
        <div className="w-[420px] max-w-full p-8 flex flex-col backdrop-blur-sm bg-card/50 rounded-2xl shadow-xl border-2 border-edge overflow-y-auto thin-scrollbar my-2 animate-in fade-in zoom-in-95 duration-300">
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
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{
        background: "var(--bg-elevated)",
        backgroundImage: `repeating-linear-gradient(
          45deg,
          transparent,
          transparent 35px,
          ${lineColor} 35px,
          ${lineColor} 37px
        )`,
      }}
    >
      <div className="w-[420px] max-w-full p-8 flex flex-col backdrop-blur-sm bg-card/50 rounded-2xl shadow-xl border-2 border-edge overflow-y-auto thin-scrollbar my-2 animate-in fade-in zoom-in-95 duration-300">
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
