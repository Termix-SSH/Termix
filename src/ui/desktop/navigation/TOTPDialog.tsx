import React from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Shield } from "lucide-react";
import { useTranslation } from "react-i18next";

interface TOTPDialogProps {
  isOpen: boolean;
  prompt: string;
  onSubmit: (code: string) => void;
  onCancel: () => void;
  backgroundColor?: string;
}

export function TOTPDialog({
  isOpen,
  prompt,
  onSubmit,
  onCancel,
  backgroundColor,
}: TOTPDialogProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 flex items-center justify-center z-500 animate-in fade-in duration-200">
      <div
        className="absolute inset-0 bg-dark-bg rounded-md"
        style={{ backgroundColor: backgroundColor || undefined }}
      />
      <div className="bg-dark-bg border-2 border-dark-border rounded-lg p-6 max-w-md w-full mx-4 relative z-10 animate-in fade-in zoom-in-95 duration-200">
        <div className="mb-4 flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold">
            {t("terminal.totpRequired")}
          </h3>
        </div>
        <p className="text-muted-foreground text-sm mb-4">{prompt}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const input = e.currentTarget.elements.namedItem(
              "totpCode",
            ) as HTMLInputElement;
            if (input && input.value.trim()) {
              onSubmit(input.value.trim());
            }
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="totpCode">{t("terminal.totpCodeLabel")}</Label>
            <Input
              id="totpCode"
              name="totpCode"
              type="text"
              autoFocus
              maxLength={6}
              pattern="[0-9]*"
              inputMode="numeric"
              placeholder="000000"
              className="text-center text-lg tracking-widest mt-1.5"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" className="flex-1">
              {t("terminal.totpVerify")}
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
