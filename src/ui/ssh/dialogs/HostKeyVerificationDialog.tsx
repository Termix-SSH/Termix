import { useState } from "react";
import { PanePrompt } from "@/components/surface/surface-scope";
import {
  PROMPT_BUTTON,
  PROMPT_DESTRUCTIVE_BUTTON,
  PROMPT_PRIMARY_BUTTON,
} from "@/components/surface/prompt-styles";
import { Shield, AlertTriangle, Copy, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { copyToClipboard } from "@/lib/clipboard";
import { hostKeyFingerprint } from "@/lib/host-key-fingerprint";

interface HostKeyVerificationDialogProps {
  isOpen: boolean;
  scenario: "new" | "changed";
  ip: string;
  port: number;
  hostname?: string;
  fingerprint: string;
  oldFingerprint?: string;
  keyType: string;
  oldKeyType?: string;
  algorithm: string;
  onAccept: () => void;
  onReject: () => void;
  backgroundColor?: string;
}

function FingerprintRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <div className="flex items-stretch gap-2">
        <div className="flex-1 bg-muted/50 border border-border p-3 font-mono text-xs break-all">
          {value}
        </div>
        <button
          type="button"
          onClick={onCopy}
          title={t("common.copy")}
          aria-label={t("common.copy")}
          className="flex w-11 shrink-0 items-center justify-center border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
        >
          {copied ? (
            <Check className="size-4 text-accent-brand" />
          ) : (
            <Copy className="size-4" />
          )}
        </button>
      </div>
    </div>
  );
}

export function HostKeyVerificationDialog({
  isOpen,
  scenario,
  ip,
  port,
  hostname,
  fingerprint,
  oldFingerprint,
  onAccept,
  onReject,
  backgroundColor,
}: HostKeyVerificationDialogProps) {
  const { t } = useTranslation();
  const [copiedFingerprint, setCopiedFingerprint] = useState(false);
  const [copiedOldFingerprint, setCopiedOldFingerprint] = useState(false);

  if (!isOpen) return null;

  const copyFingerprint = (text: string, isOld: boolean = false) => {
    copyToClipboard(text);
    if (isOld) {
      setCopiedOldFingerprint(true);
      setTimeout(() => setCopiedOldFingerprint(false), 2000);
    } else {
      setCopiedFingerprint(true);
      setTimeout(() => setCopiedFingerprint(false), 2000);
    }
  };

  const changed = scenario === "changed";
  const newPrint = hostKeyFingerprint(fingerprint);
  const oldPrint = hostKeyFingerprint(oldFingerprint || "");

  return (
    <PanePrompt
      open
      layer="connection"
      backgroundColor={backgroundColor}
      tone={changed ? "destructive" : "default"}
      icon={
        changed ? (
          <AlertTriangle className="size-4" />
        ) : (
          <Shield className="size-4" />
        )
      }
      title={
        changed ? t("hostKey.keyChangedWarning") : t("hostKey.verifyNewHost")
      }
      description={
        <span className="font-mono">
          {hostname || ip}:{port}
        </span>
      }
      className="max-w-lg"
      actions={
        <>
          <button type="button" onClick={onReject} className={PROMPT_BUTTON}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={onAccept}
            className={
              changed ? PROMPT_DESTRUCTIVE_BUTTON : PROMPT_PRIMARY_BUTTON
            }
          >
            {changed
              ? t("hostKey.acceptNewKey")
              : t("hostKey.acceptAndContinue")}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {changed ? (
          <>
            <div className="flex items-start gap-3 p-3 border border-destructive/20 bg-destructive/10">
              <AlertTriangle className="size-4 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-destructive">
                  {t("hostKey.securityWarning")}
                </p>
                <p className="text-xs text-destructive/80 mt-1">
                  {t("hostKey.keyChangedDescription")}
                </p>
              </div>
            </div>
            <FingerprintRow
              label={t("hostKey.previousKey")}
              value={oldPrint}
              copied={copiedOldFingerprint}
              onCopy={() => copyFingerprint(oldPrint, true)}
            />
            <FingerprintRow
              label={t("hostKey.newFingerprint")}
              value={newPrint}
              copied={copiedFingerprint}
              onCopy={() => copyFingerprint(newPrint)}
            />
          </>
        ) : (
          <>
            <div className="flex items-start gap-3 p-3 border border-border bg-muted/10">
              <Shield className="size-4 text-accent-brand shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest">
                  {t("hostKey.firstConnectionTitle")}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("hostKey.firstConnectionDescription")}
                </p>
              </div>
            </div>
            <FingerprintRow
              label={t("hostKey.fingerprint")}
              value={newPrint}
              copied={copiedFingerprint}
              onCopy={() => copyFingerprint(newPrint)}
            />
            <p className="text-[10px] text-muted-foreground">
              {t("hostKey.verifyInstructions")}
            </p>
          </>
        )}
      </div>
    </PanePrompt>
  );
}
