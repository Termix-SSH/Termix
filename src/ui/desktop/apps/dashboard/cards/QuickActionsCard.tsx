import React from "react";
import { useTranslation } from "react-i18next";
import { FastForward, Server, Key, Settings, User } from "lucide-react";
import { Button } from "@/components/ui/button";

interface QuickActionsCardProps {
  isAdmin: boolean;
  onAddHost: () => void;
  onAddCredential: () => void;
  onOpenAdminSettings: () => void;
  onOpenUserProfile: () => void;
}

export function QuickActionsCard({
  isAdmin,
  onAddHost,
  onAddCredential,
  onOpenAdminSettings,
  onOpenUserProfile,
}: QuickActionsCardProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="border-2 border-edge rounded-md flex flex-col overflow-hidden transition-all duration-150 hover:border-primary/20 !bg-elevated">
      <div className="flex flex-col mx-3 my-2 overflow-y-auto overflow-x-hidden thin-scrollbar">
        <p className="text-xl font-semibold mb-3 mt-1 flex flex-row items-center">
          <FastForward className="mr-3" />
          {t("dashboard.quickActions")}
        </p>
        <div className="grid gap-4 grid-cols-3 auto-rows-min overflow-y-auto overflow-x-hidden thin-scrollbar">
          <Button
            variant="outline"
            className="border-2 !border-edge flex flex-col items-center justify-center h-auto p-3 !bg-canvas"
            onClick={onAddHost}
          >
            <div className="flex flex-col items-center w-full max-w-full">
              <Server
                className="shrink-0"
                style={{ width: "40px", height: "40px" }}
              />
              <span
                className="font-semibold text-sm mt-2 text-center block"
                style={{
                  wordWrap: "break-word",
                  overflowWrap: "break-word",
                  width: "100%",
                  maxWidth: "100%",
                  hyphens: "auto",
                  display: "block",
                  whiteSpace: "normal",
                }}
              >
                {t("dashboard.addHost")}
              </span>
            </div>
          </Button>
          <Button
            variant="outline"
            className="border-2 !border-edge flex flex-col items-center justify-center h-auto p-3 !bg-canvas"
            onClick={onAddCredential}
          >
            <div className="flex flex-col items-center w-full max-w-full">
              <Key
                className="shrink-0"
                style={{ width: "40px", height: "40px" }}
              />
              <span
                className="font-semibold text-sm mt-2 text-center block"
                style={{
                  wordWrap: "break-word",
                  overflowWrap: "break-word",
                  width: "100%",
                  maxWidth: "100%",
                  hyphens: "auto",
                  display: "block",
                  whiteSpace: "normal",
                }}
              >
                {t("dashboard.addCredential")}
              </span>
            </div>
          </Button>
          {isAdmin && (
            <Button
              variant="outline"
              className="border-2 !border-edge flex flex-col items-center justify-center h-auto p-3 !bg-canvas"
              onClick={onOpenAdminSettings}
            >
              <div className="flex flex-col items-center w-full max-w-full">
                <Settings
                  className="shrink-0"
                  style={{ width: "40px", height: "40px" }}
                />
                <span
                  className="font-semibold text-sm mt-2 text-center block"
                  style={{
                    wordWrap: "break-word",
                    overflowWrap: "break-word",
                    width: "100%",
                    maxWidth: "100%",
                    hyphens: "auto",
                    display: "block",
                    whiteSpace: "normal",
                  }}
                >
                  {t("dashboard.adminSettings")}
                </span>
              </div>
            </Button>
          )}
          <Button
            variant="outline"
            className="border-2 !border-edge flex flex-col items-center justify-center h-auto p-3 !bg-canvas"
            onClick={onOpenUserProfile}
          >
            <div className="flex flex-col items-center w-full max-w-full">
              <User
                className="shrink-0"
                style={{ width: "40px", height: "40px" }}
              />
              <span
                className="font-semibold text-sm mt-2 text-center block"
                style={{
                  wordWrap: "break-word",
                  overflowWrap: "break-word",
                  width: "100%",
                  maxWidth: "100%",
                  hyphens: "auto",
                  display: "block",
                  whiteSpace: "normal",
                }}
              >
                {t("dashboard.userProfile")}
              </span>
            </div>
          </Button>
        </div>
      </div>
    </div>
  );
}
