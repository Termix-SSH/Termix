import React, { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import { Shield, AlertTriangle, Copy, Check } from "lucide-react";
import { useTranslation } from "react-i18next";

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
  keyType,
  oldKeyType,
  algorithm,
  onAccept,
  onReject,
  backgroundColor,
}: HostKeyVerificationDialogProps) {
  const { t } = useTranslation();
  const [copiedFingerprint, setCopiedFingerprint] = useState(false);
  const [copiedOldFingerprint, setCopiedOldFingerprint] = useState(false);

  if (!isOpen) return null;

  const copyToClipboard = (text: string, isOld: boolean = false) => {
    navigator.clipboard.writeText(text);
    if (isOld) {
      setCopiedOldFingerprint(true);
      setTimeout(() => setCopiedOldFingerprint(false), 2000);
    } else {
      setCopiedFingerprint(true);
      setTimeout(() => setCopiedFingerprint(false), 2000);
    }
  };

  const formatFingerprint = (fp: string) => {
    return fp.match(/.{1,2}/g)?.join(":") || fp;
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center z-500 animate-in fade-in duration-200">
      <div
        className="absolute inset-0 bg-canvas rounded-md"
        style={{ backgroundColor: backgroundColor || undefined }}
      />
      <Card className="w-full max-w-2xl mx-4 border-2 relative z-10 animate-in fade-in zoom-in-95 duration-200">
        <CardHeader>
          <div className="flex items-center gap-2">
            {scenario === "new" ? (
              <Shield className="w-5 h-5" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-destructive" />
            )}
            <CardTitle>
              {scenario === "new"
                ? t("hostKey.verifyNewHost")
                : t("hostKey.keyChangedWarning")}
            </CardTitle>
          </div>
          <CardDescription>
            {hostname || ip}:{port}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {scenario === "new" ? (
            <>
              <Alert>
                <Shield className="h-4 w-4" />
                <AlertTitle>{t("hostKey.firstConnectionTitle")}</AlertTitle>
                <AlertDescription>
                  {t("hostKey.firstConnectionDescription")}
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <div className="text-sm font-medium">
                  {t("hostKey.fingerprint")} ({algorithm.toUpperCase()})
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 rounded-md bg-muted p-3 font-mono text-xs break-all">
                    {formatFingerprint(fingerprint)}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(fingerprint)}
                    className="shrink-0"
                  >
                    {copiedFingerprint ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <Alert>
                <AlertDescription>
                  {t("hostKey.verifyInstructions")}
                </AlertDescription>
              </Alert>
            </>
          ) : (
            <>
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{t("hostKey.securityWarning")}</AlertTitle>
                <AlertDescription>
                  {t("hostKey.keyChangedDescription")}
                </AlertDescription>
              </Alert>

              <div className="space-y-3">
                <div className="space-y-2">
                  <div className="text-sm font-medium">
                    {t("hostKey.previousKey")}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 rounded-md bg-muted p-3 font-mono text-xs break-all">
                      {formatFingerprint(oldFingerprint || "")}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        copyToClipboard(oldFingerprint || "", true)
                      }
                      className="shrink-0"
                    >
                      {copiedOldFingerprint ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">
                    {t("hostKey.newFingerprint")}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 rounded-md bg-muted p-3 font-mono text-xs break-all">
                      {formatFingerprint(fingerprint)}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(fingerprint)}
                      className="shrink-0"
                    >
                      {copiedFingerprint ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onReject}
              className="flex-1"
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={onAccept}
              variant={scenario === "changed" ? "destructive" : "default"}
              className="flex-1"
            >
              {scenario === "new"
                ? t("hostKey.acceptAndContinue")
                : t("hostKey.acceptNewKey")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
