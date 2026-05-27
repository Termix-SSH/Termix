import React, { useState } from "react";
import { Button } from "@/components/button.tsx";
import { Input } from "@/components/input.tsx";
import { Shield, Copy, ExternalLink, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

interface WarpgateDialogProps {
  isOpen: boolean;
  url: string;
  securityKey: string;
  onContinue: () => void;
  onCancel: () => void;
  onOpenUrl: () => void;
  backgroundColor?: string;
}

export function WarpgateDialog({
  isOpen,
  url,
  securityKey,
  onContinue,
  onCancel,
  onOpenUrl,
  backgroundColor,
}: WarpgateDialogProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(t("common.copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("common.copyFailed"));
    }
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center z-500 animate-in fade-in duration-200 overflow-y-auto">
      <div
        className="absolute inset-0 bg-canvas rounded-md"
        style={{ backgroundColor: backgroundColor || undefined }}
      />
      <div className="bg-card border border-border w-full max-w-md mx-4 my-4 relative z-10 animate-in fade-in zoom-in-95 duration-200">
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Shield className="size-4 text-accent-brand" />
            <h3 className="text-xs font-bold uppercase tracking-widest">
              {t("terminal.warpgateAuthRequired")}
            </h3>
          </div>
        </div>
        <div className="p-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("terminal.warpgateSecurityKey")}
            </p>
            <div className="border border-border bg-muted/10 p-4 text-center">
              <div className="text-2xl font-mono font-bold tracking-wider text-accent-brand">
                {securityKey}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("terminal.warpgateAuthUrl")}
            </p>
            <div className="flex gap-2">
              <Input
                type="text"
                value={url}
                readOnly
                className="rounded-none bg-muted/50 border-border text-xs font-mono flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleCopyUrl}
                className="rounded-none border-border shrink-0"
                title={t("common.copy")}
              >
                {copied ? (
                  <Check className="size-4 text-accent-brand" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              className="rounded-none text-[10px] font-bold uppercase tracking-widest sm:mr-auto"
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onContinue}
              className="rounded-none text-[10px] font-bold uppercase tracking-widest"
            >
              {t("terminal.warpgateContinue")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onOpenUrl}
              className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 rounded-none text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5"
            >
              <ExternalLink className="size-3.5" />
              {t("terminal.warpgateOpenBrowser")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
