import React, { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Shield, Copy, ExternalLink } from "lucide-react";
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
            {t("terminal.warpgateAuthRequired")}
          </h3>
        </div>

        <div className="space-y-4">
          <div>
            <Label className="text-base font-semibold mb-2 block">
              {t("terminal.warpgateSecurityKey")}
            </Label>
            <div className="bg-base border-2 border-accent rounded-md p-4 text-center">
              <div className="text-3xl font-mono font-bold tracking-wider text-primary">
                {securityKey}
              </div>
            </div>
          </div>

          <div>
            <Label htmlFor="warpgateUrl" className="text-base font-semibold">
              {t("terminal.warpgateAuthUrl")}
            </Label>
            <div className="flex gap-2 mt-2">
              <Input
                id="warpgateUrl"
                type="text"
                value={url}
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
                <Copy className={`w-4 h-4 ${copied ? "text-success" : ""}`} />
              </Button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <Button
              type="button"
              onClick={onOpenUrl}
              className="flex-1 flex items-center justify-center gap-2"
            >
              <ExternalLink className="w-4 h-4" />
              {t("terminal.warpgateOpenBrowser")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={onContinue}
              className="flex-1"
            >
              {t("terminal.warpgateContinue")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              className="sm:w-auto"
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
