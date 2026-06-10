import React, { useState } from "react";
import { Button } from "@/components/button.tsx";
import { Shield, AlertTriangle, Copy, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { copyToClipboard } from "@/lib/clipboard";

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

export function HostKeyVerificationDialog({
  isOpen,
  scenario,
  ip,
  port,
  hostname,
  fingerprint,
  oldFingerprint,
  algorithm,
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

  const formatFingerprint = (fp: string) =>
    fp.match(/.{1,2}/g)?.join(":") || fp;

  return (
    <div className="absolute inset-0 flex items-center justify-center z-500 animate-in fade-in duration-200">
      <div
        className="absolute inset-0 bg-canvas rounded-md"
        style={{ backgroundColor: backgroundColor || undefined }}
      />
      <div className="bg-card border border-border w-full max-w-lg mx-4 relative z-10 animate-in fade-in zoom-in-95 duration-200">
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2">
            {scenario === "new" ? (
              <Shield className="size-4 text-accent-brand" />
            ) : (
              <AlertTriangle className="size-4 text-destructive" />
            )}
            <h3 className="text-xs font-bold uppercase tracking-widest">
              {scenario === "new"
                ? t("hostKey.verifyNewHost")
                : t("hostKey.keyChangedWarning")}
            </h3>
          </div>
          <p className="text-[10px] font-mono font-bold tracking-tight text-muted-foreground mt-1">
            {hostname || ip}:{port}
          </p>
        </div>

        <div className="p-4 flex flex-col gap-4">
          {scenario === "new" ? (
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

              <div className="flex flex-col gap-1.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("hostKey.fingerprint")} ({algorithm.toUpperCase()})
                </p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-muted/50 border border-border p-3 font-mono text-xs break-all">
                    {formatFingerprint(fingerprint)}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => copyFingerprint(fingerprint)}
                    className="rounded-none shrink-0"
                  >
                    {copiedFingerprint ? (
                      <Check className="size-4 text-accent-brand" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </Button>
                </div>
              </div>

              <p className="text-[10px] text-muted-foreground">
                {t("hostKey.verifyInstructions")}
              </p>
            </>
          ) : (
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

              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hostKey.previousKey")}
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-muted/50 border border-border p-3 font-mono text-xs break-all">
                      {formatFingerprint(oldFingerprint || "")}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        copyFingerprint(oldFingerprint || "", true)
                      }
                      className="rounded-none shrink-0"
                    >
                      {copiedOldFingerprint ? (
                        <Check className="size-4 text-accent-brand" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hostKey.newFingerprint")}
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-muted/50 border border-border p-3 font-mono text-xs break-all">
                      {formatFingerprint(fingerprint)}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => copyFingerprint(fingerprint)}
                      className="rounded-none shrink-0"
                    >
                      {copiedFingerprint ? (
                        <Check className="size-4 text-accent-brand" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="p-4 border-t border-border flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onReject}
            className="rounded-none text-[10px] font-bold uppercase tracking-widest"
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            onClick={onAccept}
            variant="outline"
            className={
              scenario === "changed"
                ? "border-destructive/40 text-destructive hover:bg-destructive/10 rounded-none text-[10px] font-bold uppercase tracking-widest"
                : "border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 rounded-none text-[10px] font-bold uppercase tracking-widest"
            }
          >
            {scenario === "new"
              ? t("hostKey.acceptAndContinue")
              : t("hostKey.acceptNewKey")}
          </Button>
        </div>
      </div>
    </div>
  );
}
