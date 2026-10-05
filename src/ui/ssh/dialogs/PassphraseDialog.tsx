import React from "react";
import { PasswordInput } from "@/components/password-input.tsx";
import { PanePrompt } from "@/components/surface/surface-scope";
import {
  PROMPT_BUTTON,
  PROMPT_PRIMARY_BUTTON,
} from "@/components/surface/prompt-styles";
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

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem(
      "passphrase",
    ) as HTMLInputElement;
    if (input?.value) {
      onSubmit(input.value);
    }
  };

  return (
    <PanePrompt
      open
      layer="connection"
      backgroundColor={backgroundColor}
      icon={<KeyRound className="size-4" />}
      title={t("auth.passphraseRequired")}
      description={<span className="font-mono">{hostDisplay}</span>}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <PasswordInput
            id="passphrase"
            name="passphrase"
            autoFocus
            placeholder={t("placeholders.keyPassword")}
            className="rounded-none bg-muted/50 border-border text-xs"
          />
          <p className="text-[10px] text-muted-foreground">
            {t("auth.passphraseRequiredDescription")}
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={PROMPT_BUTTON}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={PROMPT_PRIMARY_BUTTON}>
            {t("common.connect")}
          </button>
        </div>
      </form>
    </PanePrompt>
  );
}
