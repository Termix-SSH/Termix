import { useEffect, useState } from "react";
import { CheckCircle2, Copy, X } from "lucide-react";
import { toast } from "sonner";
import { Button, Input, copyToClipboard } from "@termix/plugin-sdk/ui";
import { usePluginApi, useTranslation } from "@termix/plugin-sdk/frontend";
import { apiErrorMessage } from "./totp-input";

type Step = "idle" | "setup" | "verify" | "backup";

interface SetupResponse {
  secret: string;
  qr_code: string;
  additional?: boolean;
}

const accentButton =
  "text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand";
const destructiveButton =
  "text-xs border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive";
const box = "border border-border bg-muted/20 p-3 flex flex-col gap-3";
const boxTitle =
  "text-[10px] font-semibold uppercase tracking-widest text-muted-foreground";

/** Settings > Security: turn TOTP on and off, add devices, backup codes. */
export function TotpEnrollment() {
  const { t } = useTranslation();
  const api = usePluginApi();
  const [enabled, setEnabled] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDisable, setShowDisable] = useState(false);
  const [disableInput, setDisableInput] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addInput, setAddInput] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api
      .get<{ enabled: boolean }>("status")
      .then(({ data }) => setEnabled(!!data.enabled))
      .catch(() => {});
  }, [api]);

  async function startSetup() {
    setLoading(true);
    try {
      const { data } = await api.post<SetupResponse>("setup", {});
      setQrCode(data.qr_code);
      setSecret(data.secret);
      setCode("");
      setStep("setup");
    } catch {
      toast.error(t("enrollment.setupFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function addAuthenticator() {
    if (!addInput) {
      toast.error(t("enrollment.codeRequired"));
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post<SetupResponse>("setup", {
        credential: addInput,
      });
      setQrCode(data.qr_code);
      setSecret(data.secret);
      setAdding(true);
      setShowAdd(false);
      setAddInput("");
      setStep("setup");
    } catch (e) {
      toast.error(apiErrorMessage(e, t("enrollment.addFailed")));
    } finally {
      setLoading(false);
    }
  }

  async function verify() {
    if (code.length !== 6) {
      toast.error(t("enrollment.enter6Digits"));
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post<{ backup_codes?: string[] }>("enable", {
        totp_code: code,
      });
      setBackupCodes(data.backup_codes ?? []);
      setEnabled(true);
      setStep("backup");
      toast.success(t("enrollment.enabledSuccess"));
    } catch (e) {
      toast.error(apiErrorMessage(e, t("enrollment.invalidCode")));
    } finally {
      setLoading(false);
    }
  }

  async function disable() {
    if (!disableInput) {
      toast.error(t("enrollment.codeRequired"));
      return;
    }
    setLoading(true);
    try {
      await api.post("disable", { totp_code: disableInput });
      setEnabled(false);
      setShowDisable(false);
      setDisableInput("");
      toast.success(t("enrollment.disabledSuccess"));
    } catch (e) {
      toast.error(apiErrorMessage(e, t("enrollment.disableFailed")));
    } finally {
      setLoading(false);
    }
  }

  function downloadBackupCodes() {
    const blob = new Blob([backupCodes.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "termix-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium">{t("enrollment.title")}</span>
            <a
              href="https://docs.termix.site/features/authentication/totp"
              target="_blank"
              rel="noreferrer"
              className="text-[10px] text-accent-brand hover:underline"
            >
              {t("enrollment.docs")}
            </a>
          </div>
          <span className="text-[10px] text-muted-foreground">
            {enabled ? t("enrollment.on") : t("enrollment.off")}
          </span>
        </div>
        {enabled ? (
          <div className="ml-3 flex shrink-0 gap-2">
            <Button
              variant="outline"
              size="sm"
              className={`h-7 ${accentButton}`}
              onClick={() => setShowAdd((open) => !open)}
              disabled={loading || step !== "idle"}
            >
              {t("enrollment.addDevice")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className={`h-7 ${destructiveButton}`}
              onClick={() => setShowDisable((open) => !open)}
            >
              {t("enrollment.disable")}
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className={`shrink-0 ml-3 h-7 ${accentButton}`}
            onClick={startSetup}
            disabled={loading || step !== "idle"}
          >
            {t("enrollment.enable")}
          </Button>
        )}
      </div>

      {enabled && showAdd && (
        <div className={box}>
          <span className={boxTitle}>{t("enrollment.addTitle")}</span>
          <span className="text-[10px] text-muted-foreground">
            {t("enrollment.addDescription")}
          </span>
          <Input
            placeholder={t("enrollment.codePlaceholder")}
            value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addAuthenticator()}
            className="text-sm"
          />
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 text-xs"
              onClick={() => {
                setShowAdd(false);
                setAddInput("");
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className={`flex-1 ${accentButton}`}
              onClick={addAuthenticator}
              disabled={loading}
            >
              {t("common.continue")}
            </Button>
          </div>
        </div>
      )}

      {enabled && showDisable && (
        <div className={box}>
          <span className={boxTitle}>{t("enrollment.disableTitle")}</span>
          <Input
            placeholder={t("enrollment.codePlaceholder")}
            value={disableInput}
            onChange={(e) => setDisableInput(e.target.value)}
            className="text-sm"
          />
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 text-xs"
              onClick={() => {
                setShowDisable(false);
                setDisableInput("");
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className={`flex-1 ${destructiveButton}`}
              onClick={disable}
              disabled={loading}
            >
              {t("enrollment.disableTitle")}
            </Button>
          </div>
        </div>
      )}

      {step === "setup" && (
        <div className={box}>
          <div className="flex items-center justify-between">
            <span className={boxTitle}>{t("enrollment.setupTitle")}</span>
            <button
              onClick={() => {
                setStep("idle");
                setAdding(false);
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <div className="flex items-center justify-center p-3 bg-background border border-border">
            {qrCode ? (
              <img
                src={qrCode}
                alt={t("enrollment.qrCode")}
                className="size-32"
              />
            ) : (
              <div className="size-24 bg-muted flex items-center justify-center text-[10px] text-muted-foreground">
                {t("enrollment.qrCode")}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 bg-muted/30 border border-border px-2 py-1.5">
            <span className="text-[10px] font-mono flex-1 tracking-widest select-all truncate">
              {secret}
            </span>
            <button
              onClick={() => {
                copyToClipboard(secret);
                toast.info(t("enrollment.secretCopied"));
              }}
              className="text-muted-foreground hover:text-accent-brand shrink-0"
            >
              <Copy className="size-3.5" />
            </button>
          </div>
          <span className="text-[10px] text-muted-foreground text-center">
            {t(
              adding
                ? "enrollment.addScanInstructions"
                : "enrollment.instructions",
            )}
          </span>
          <Button
            variant="outline"
            size="sm"
            className={accentButton}
            onClick={() => {
              if (adding) {
                setAdding(false);
                setStep("idle");
                toast.success(t("enrollment.addSuccess"));
              } else {
                setStep("verify");
              }
            }}
          >
            {t(adding ? "enrollment.done" : "enrollment.continueVerify")}
          </Button>
        </div>
      )}

      {!enabled && step === "verify" && (
        <div className={box}>
          <div className="flex items-center justify-between">
            <span className={boxTitle}>{t("enrollment.verifyTitle")}</span>
            <button
              onClick={() => setStep("setup")}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <Input
            placeholder="000000"
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            onKeyDown={(e) => e.key === "Enter" && verify()}
            className="text-center font-mono tracking-widest text-lg h-10"
            maxLength={6}
          />
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 text-xs"
              onClick={() => setStep("setup")}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className={`flex-1 ${accentButton}`}
              onClick={verify}
              disabled={loading || code.length !== 6}
            >
              <CheckCircle2 className="size-3.5" />
              {t("enrollment.verify")}
            </Button>
          </div>
        </div>
      )}

      {step === "backup" && backupCodes.length > 0 && (
        <div className={box}>
          <span className={boxTitle}>{t("enrollment.backupTitle")}</span>
          <div className="grid grid-cols-2 gap-1">
            {backupCodes.map((backupCode) => (
              <span
                key={backupCode}
                className="text-[10px] font-mono bg-muted border border-border px-2 py-1 text-center"
              >
                {backupCode}
              </span>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className={accentButton}
            onClick={downloadBackupCodes}
          >
            {t("enrollment.downloadBackup")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() => setStep("idle")}
          >
            {t("enrollment.done")}
          </Button>
        </div>
      )}
    </div>
  );
}
