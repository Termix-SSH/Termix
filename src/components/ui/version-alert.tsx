import React from "react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { ExternalLink, Download, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";

interface VersionAlertProps {
  updateInfo: {
    success: boolean;
    status?: "up_to_date" | "requires_update";
    localVersion?: string;
    remoteVersion?: string;
    latest_release?: {
      tag_name: string;
      name: string;
      published_at: string;
      html_url: string;
      body: string;
    };
    cached?: boolean;
    cache_age?: number;
    error?: string;
  };
  onDownload?: () => void;
}

export function VersionAlert({ updateInfo, onDownload }: VersionAlertProps) {
  const { t } = useTranslation();

  if (!updateInfo.success) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>{t("versionCheck.error")}</AlertTitle>
        <AlertDescription>
          {updateInfo.error || t("versionCheck.checkFailed")}
        </AlertDescription>
      </Alert>
    );
  }

  if (updateInfo.status === "up_to_date") {
    return (
      <Alert>
        <Download className="h-4 w-4" />
        <AlertTitle>{t("versionCheck.upToDate")}</AlertTitle>
        <AlertDescription>
          {t("versionCheck.currentVersion", {
            version: updateInfo.localVersion,
          })}
        </AlertDescription>
      </Alert>
    );
  }

  if (updateInfo.status === "requires_update") {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>{t("versionCheck.updateAvailable")}</AlertTitle>
        <AlertDescription className="space-y-3">
          <div>
            {t("versionCheck.newVersionAvailable", {
              current: updateInfo.localVersion,
              latest: updateInfo.remoteVersion,
            })}
          </div>

          {updateInfo.latest_release && (
            <div className="text-sm text-muted-foreground">
              <div className="font-medium">
                {updateInfo.latest_release.name}
              </div>
              <div className="text-xs">
                {t("versionCheck.releasedOn", {
                  date: new Date(
                    updateInfo.latest_release.published_at,
                  ).toLocaleDateString(),
                })}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            {updateInfo.latest_release?.html_url && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (onDownload) {
                    onDownload();
                  } else {
                    window.open(updateInfo.latest_release!.html_url, "_blank");
                  }
                }}
                className="flex items-center gap-1"
              >
                <ExternalLink className="h-3 w-3" />
                {t("versionCheck.downloadUpdate")}
              </Button>
            )}
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}
