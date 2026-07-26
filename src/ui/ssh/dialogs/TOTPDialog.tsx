import React, { useEffect, useState } from "react";
import { Button } from "@/components/button.tsx";
import { Input } from "@/components/input.tsx";
import { Shield, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

export type MFAPromptMode = "totp" | "password" | "menu" | "push";

interface TOTPDialogProps {
  isOpen: boolean;
  prompt: string;
  mode?: MFAPromptMode;
  waiting?: boolean;
  onSubmit: (code: string) => void;
  onCancel: () => void;
  backgroundColor?: string;
}

export function TOTPDialog({
  isOpen,
  prompt,
  mode = "totp",
  waiting = false,
  onSubmit,
  onCancel,
  backgroundColor,
}: TOTPDialogProps) {
  const { t } = useTranslation();
  const [pushSubmitted, setPushSubmitted] = useState(false);

  useEffect(() => {
    if (isOpen && !waiting) {
      setPushSubmitted(false);
    }
  }, [isOpen, waiting]);

  if (!isOpen) return null;

  const isPush = mode === "push";
  const isMenu = mode === "menu";
  const isTotp = mode === "totp";
  const showWaiting = waiting || (isPush && pushSubmitted);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isPush) {
      setPushSubmitted(true);
      onSubmit("");
      return;
    }
    const input = e.currentTarget.elements.namedItem(
      "totpCode",
    ) as HTMLInputElement;
    if (input?.value.trim()) {
      onSubmit(input.value.trim());
    }
  };

  const title = isPush
    ? t("terminal.mfaPushRequired")
    : isMenu
      ? t("terminal.mfaPromptRequired")
      : t("terminal.totpRequired");

  const label = prompt || (isTotp ? t("terminal.totpCodeLabel") : undefined);

  return (
    <div className="absolute inset-0 flex items-center justify-center z-500 animate-in fade-in duration-200">
      <div
        className="absolute inset-0 bg-canvas rounded-md"
        style={{ backgroundColor: backgroundColor || undefined }}
      />
      <div className="bg-card border border-border w-full max-w-sm mx-4 relative z-10 animate-in fade-in zoom-in-95 duration-200">
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Shield className="size-4 text-accent-brand" />
            <h3 className="text-xs font-bold uppercase tracking-widest">
              {title}
            </h3>
          </div>
          {label && (
            <p className="text-[10px] font-bold uppercase tracking-tight text-muted-foreground mt-1">
              {label}
            </p>
          )}
        </div>
        {showWaiting ? (
          <div className="p-4 flex flex-col gap-4">
            <div className="flex items-center gap-3 py-2">
              <Loader2 className="size-4 animate-spin text-accent-brand shrink-0" />
              <p className="text-xs text-muted-foreground">
                {t("terminal.mfaWaitingApproval")}
              </p>
            </div>
            <div className="flex justify-end gap-2">
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
        ) : (
          <form onSubmit={handleSubmit} className="p-4 flex flex-col gap-4">
            {isPush ? null : isMenu ? (
              <Input
                id="totpCode"
                name="totpCode"
                type="text"
                autoFocus
                placeholder={t("terminal.mfaMenuPlaceholder")}
                className="rounded-none bg-muted/50 border-border text-center text-sm tracking-widest"
              />
            ) : (
              <Input
                id="totpCode"
                name="totpCode"
                type="text"
                autoFocus
                maxLength={6}
                pattern="[0-9]*"
                inputMode="numeric"
                placeholder="000000"
                className="rounded-none bg-muted/50 border-border text-center text-sm tracking-widest"
              />
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={onCancel}
                className="rounded-none text-[10px] font-bold uppercase tracking-widest"
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                variant="outline"
                className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 rounded-none text-[10px] font-bold uppercase tracking-widest"
              >
                {isPush
                  ? t("terminal.mfaSendRequest")
                  : t("terminal.totpVerify")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
