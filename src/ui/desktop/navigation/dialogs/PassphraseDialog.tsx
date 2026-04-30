import React from "react";
import { Button } from "@/components/ui/button.tsx";
import { PasswordInput } from "@/components/ui/password-input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";

interface PassphraseDialogProps {
  isOpen: boolean;
  onSubmit: (passphrase: string) => void;
  onCancel: () => void;
  hostInfo: { ip: string; port: number; username: string; name?: string };
  backgroundColor?: string;
}

export function PassphraseDialog({
  isOpen,
  onSubmit,
  onCancel,
  hostInfo,
  backgroundColor,
}: PassphraseDialogProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  const hostDisplay = hostInfo.name
    ? `${hostInfo.name} (${hostInfo.username}@${hostInfo.ip}:${hostInfo.port})`
    : `${hostInfo.username}@${hostInfo.ip}:${hostInfo.port}`;

  return (
    <div className="absolute inset-0 flex items-center justify-center z-500 animate-in fade-in duration-200">
      <div
        className="absolute inset-0 bg-canvas rounded-md"
        style={{ backgroundColor: backgroundColor || undefined }}
      />
      <div className="bg-elevated border-2 border-edge rounded-lg p-6 max-w-md w-full mx-4 relative z-10 animate-in fade-in zoom-in-95 duration-200">
        <div className="mb-4">
          <div className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-semibold">
              {t("auth.passphraseRequired")}
            </h3>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{hostDisplay}</p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const input = e.currentTarget.elements.namedItem(
              "passphrase",
            ) as HTMLInputElement;
            if (input && input.value) {
              onSubmit(input.value);
            }
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="passphrase">
              {t("auth.passphraseRequiredDescription")}
            </Label>
            <PasswordInput
              id="passphrase"
              name="passphrase"
              autoFocus
              placeholder={t("placeholders.keyPassword")}
              className="mt-1.5"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" className="flex-1">
              {t("common.connect")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              className="flex-1"
            >
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
