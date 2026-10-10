import React, { useEffect, useState } from "react";
import { Input } from "@/components/input.tsx";
import { PanePrompt } from "@/components/surface/surface-scope";
import {
  PROMPT_BUTTON,
  PROMPT_PRIMARY_BUTTON,
} from "@/components/surface/prompt-styles";
import { Shield, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MFAPromptMode } from "@termix-ssh/plugin-sdk/frontend";

export type { MFAPromptMode };

interface TOTPDialogProps {
  isOpen: boolean;
  prompt: string;
  mode?: MFAPromptMode;
  waiting?: boolean;
  onSubmit: (code: string) => void;
  onCancel: () => void;
  backgroundColor?: string;
}

const CODE_INPUT =
  "rounded-none bg-muted/50 border-border text-center text-sm tracking-widest";

export function TOTPDialog({
  isOpen,
  prompt,
  mode,
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

  const isPassword = mode === "password";
  const isPush = mode === "push";
  const isMenu = mode === "menu";
  const isTotp = !isPush && !isMenu && mode !== "password";
  const showWaiting = waiting || (isPush && pushSubmitted);
  // FortiToken-style prompts ask for a numeric code or the literal word
  // "push", so the field can't be restricted to digits only.
  const allowsPushKeyword = isTotp && /push/i.test(prompt);

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
    const value = isPassword ? input?.value : input?.value.trim();
    if (value) onSubmit(value);
  };

  const title = isPush
    ? t("sshAuth.mfaPushRequired")
    : isPassword
      ? t("common.password")
      : isMenu
        ? t("sshAuth.mfaPromptRequired")
        : t("sshAuth.totpRequired");

  const label = prompt || (isTotp ? t("sshAuth.totpCodeLabel") : undefined);

  const cancel = (
    <button type="button" onClick={onCancel} className={PROMPT_BUTTON}>
      {t("common.cancel")}
    </button>
  );

  return (
    <PanePrompt
      open
      layer="connection"
      backgroundColor={backgroundColor}
      icon={<Shield className="size-4" />}
      title={title}
      description={label}
    >
      {showWaiting ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 py-1">
            <Loader2 className="size-4 animate-spin text-accent-brand shrink-0" />
            <p className="text-xs text-muted-foreground">
              {t("sshAuth.mfaWaitingApproval")}
            </p>
          </div>
          <div className="flex justify-end gap-2">{cancel}</div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {isPush ? null : isPassword ? (
            <Input
              id="totpCode"
              name="totpCode"
              type="password"
              autoComplete="current-password"
              autoFocus
              placeholder={t("placeholders.enterPassword")}
              className="rounded-none bg-muted/50 border-border text-sm"
            />
          ) : isMenu ? (
            <Input
              id="totpCode"
              name="totpCode"
              type="text"
              autoFocus
              placeholder={t("sshAuth.mfaMenuPlaceholder")}
              className={CODE_INPUT}
            />
          ) : allowsPushKeyword ? (
            <Input
              id="totpCode"
              name="totpCode"
              type="text"
              autoFocus
              placeholder={t("sshAuth.mfaCodeOrPushPlaceholder")}
              className={CODE_INPUT}
            />
          ) : (
            <Input
              id="totpCode"
              name="totpCode"
              type="text"
              autoFocus
              // Some Secure Auth codes can be longer than 6 digits, so allow up to 8 digits here.
              maxLength={8}
              pattern="[0-9]*"
              inputMode="numeric"
              placeholder="000000"
              className={CODE_INPUT}
            />
          )}
          <div className="flex justify-end gap-2">
            {cancel}
            <button type="submit" className={PROMPT_PRIMARY_BUTTON}>
              {isPush
                ? t("sshAuth.mfaSendRequest")
                : isPassword
                  ? t("common.connect")
                  : t("sshAuth.totpVerify")}
            </button>
          </div>
        </form>
      )}
    </PanePrompt>
  );
}
