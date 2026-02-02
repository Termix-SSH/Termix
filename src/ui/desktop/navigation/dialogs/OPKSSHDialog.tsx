import React, { useEffect } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Shield, Copy, ExternalLink, Loader2, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

interface OPKSSHDialogProps {
  isOpen: boolean;
  authUrl: string;
  requestId: string;
  stage: "chooser" | "waiting" | "authenticating" | "completed" | "error";
  error?: string;
  onCancel: () => void;
  onOpenUrl: () => void;
  backgroundColor?: string;
}

export function OPKSSHDialog({
  isOpen,
  authUrl,
  requestId,
  stage,
  error,
  onCancel,
  onOpenUrl,
  backgroundColor,
}: OPKSSHDialogProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (isOpen && authUrl && stage === "chooser") {
      onOpenUrl();
    }
  }, [isOpen, authUrl, stage]);

  if (!isOpen) return null;

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(authUrl);
      toast.success(t("common.copied"));
    } catch (error) {
      toast.error(t("common.copyFailed"));
    }
  };

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
          {stage === "chooser" && authUrl && (
            <>
              <p className="text-muted-foreground">
                {t("terminal.opksshAuthDescription")}
              </p>
              <div>
                <Label htmlFor="opksshUrl" className="text-base font-semibold">
                  {t("terminal.opksshAuthUrl")}
                </Label>
                <div className="flex gap-2 mt-2">
                  <Input
                    id="opksshUrl"
                    type="text"
                    value={authUrl}
                    readOnly
                    className="flex-1 font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={handleCopyUrl}
                    title={t("common.copy")}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
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
                  <p className="text-sm text-destructive/90 mt-1">{error}</p>
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
