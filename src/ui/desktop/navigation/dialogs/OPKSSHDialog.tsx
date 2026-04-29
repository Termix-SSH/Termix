import React from "react";
import { Button } from "@/components/ui/button.tsx";
import { Shield, ExternalLink, Loader2, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

interface OPKSSHDialogProps {
  isOpen: boolean;
  authUrl: string;
  requestId: string;
  stage: "chooser" | "waiting" | "authenticating" | "completed" | "error";
  error?: string;
  providers?: Array<{ alias: string; issuer: string }>;
  onCancel: () => void;
  onOpenUrl: () => void;
  onSelectProvider?: (alias: string) => void;
  backgroundColor?: string;
}

export function OPKSSHDialog({
  isOpen,
  authUrl,
  stage,
  error,
  providers,
  onCancel,
  onOpenUrl,
  onSelectProvider,
  backgroundColor,
}: OPKSSHDialogProps) {
  const { t } = useTranslation();
  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 flex items-center justify-center z-500 animate-in fade-in duration-200">
      <div
        className="absolute inset-0 bg-canvas rounded-md"
        style={{ backgroundColor: backgroundColor || undefined }}
      />
      <div className="bg-elevated border-2 border-edge rounded-lg p-6 max-w-xl w-full mx-4 relative z-10 animate-in fade-in zoom-in-95 duration-200">
        <div className="mb-4 flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold">
            {t("terminal.opksshAuthRequired")}
          </h3>
        </div>

        <div className="space-y-4">
          {stage === "chooser" && (
            <>
              <p className="text-muted-foreground">
                {t("terminal.opksshAuthDescription")}
              </p>
              {providers && providers.length > 0 && onSelectProvider ? (
                <div className="space-y-2">
                  {providers.map((provider) => (
                    <Button
                      key={provider.alias}
                      type="button"
                      onClick={() => onSelectProvider(provider.alias)}
                      className="w-full flex items-center justify-center gap-2"
                    >
                      <ExternalLink className="w-4 h-4" />
                      {t("terminal.opksshSignInWith", {
                        provider:
                          provider.alias.charAt(0).toUpperCase() +
                          provider.alias.slice(1),
                      })}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={onCancel}
                  >
                    {t("common.cancel")}
                  </Button>
                </div>
              ) : authUrl ? (
                <div>
                  <div className="flex gap-2 pt-2">
                    <Button
                      type="button"
                      onClick={onOpenUrl}
                      className="flex-1 flex items-center justify-center gap-2"
                    >
                      <ExternalLink className="w-4 h-4" />
                      {t("terminal.opksshOpenBrowser")}
                    </Button>
                    <Button type="button" variant="outline" onClick={onCancel}>
                      {t("common.cancel")}
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}

          {(stage === "waiting" || stage === "authenticating") && (
            <div className="flex items-center gap-3 py-4">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
              <p className="text-muted-foreground">
                {stage === "waiting"
                  ? t("terminal.opksshWaitingForAuth")
                  : t("terminal.opksshAuthenticating")}
              </p>
            </div>
          )}

          {stage === "error" && error && (
            <>
              <div className="flex items-start gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-md">
                <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-destructive">
                    {t("common.error")}
                  </p>
                  <p className="text-sm text-destructive/90 mt-1 whitespace-pre-wrap break-words">
                    {error}
                  </p>
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <Button type="button" variant="outline" onClick={onCancel}>
                  {t("common.close")}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
