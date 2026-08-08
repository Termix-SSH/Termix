import React from "react";
import { Button } from "@/components/button.tsx";
import { Shield, ExternalLink, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

interface TailscaleCheckDialogProps {
  isOpen: boolean;
  authUrl: string;
  message?: string;
  stage: "prompt" | "waiting";
  onCancel: () => void;
  onOpenUrl: () => void;
  backgroundColor?: string;
}

export function TailscaleCheckDialog({
  isOpen,
  authUrl,
  message,
  stage,
  onCancel,
  onOpenUrl,
  backgroundColor,
}: TailscaleCheckDialogProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 flex items-center justify-center z-500 animate-in fade-in duration-200">
      <div
        className="absolute inset-0 bg-canvas rounded-md"
        style={{ backgroundColor: backgroundColor || undefined }}
      />
      <div className="bg-card border border-border w-full max-w-md mx-4 relative z-10 animate-in fade-in zoom-in-95 duration-200">
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Shield className="size-4 text-accent-brand" />
            <h3 className="text-xs font-bold uppercase tracking-widest">
              {t("terminal.tailscaleCheckRequired")}
            </h3>
          </div>
          <p className="text-[10px] font-bold uppercase tracking-tight text-muted-foreground mt-1">
            {t("terminal.tailscaleCheckDescription")}
          </p>
        </div>
        <div className="p-4 flex flex-col gap-4">
          {message && (
            <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words">
              {message}
            </p>
          )}

          {stage === "prompt" && authUrl && (
            <Button
              type="button"
              variant="outline"
              onClick={onOpenUrl}
              className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 rounded-none text-[10px] font-bold uppercase tracking-widest w-full flex items-center gap-2"
            >
              <ExternalLink className="size-3.5" />
              {t("terminal.tailscaleCheckOpenBrowser")}
            </Button>
          )}

          {stage === "waiting" && (
            <div className="flex items-center gap-3 py-2">
              <Loader2 className="size-4 animate-spin text-accent-brand shrink-0" />
              <p className="text-xs text-muted-foreground">
                {t("terminal.tailscaleCheckWaiting")}
              </p>
            </div>
          )}

          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              className="rounded-none text-[10px] font-bold uppercase tracking-widest"
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
