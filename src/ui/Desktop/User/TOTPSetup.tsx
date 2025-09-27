import React, { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { PasswordInput } from "@/components/ui/password-input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs.tsx";
import {
  Shield,
  Copy,
  Download,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import {
  setupTOTP,
  enableTOTP,
  disableTOTP,
  generateBackupCodes,
} from "@/ui/main-axios.ts";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface TOTPSetupProps {
  isEnabled: boolean;
  onStatusChange?: (enabled: boolean) => void;
}

export function TOTPSetup({
  isEnabled: initialEnabled,
  onStatusChange,
}: TOTPSetupProps) {
  const { t } = useTranslation();
  const [isEnabled, setIsEnabled] = useState(initialEnabled);
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [setupStep, setSetupStep] = useState<
    "init" | "qr" | "verify" | "backup"
  >("init");
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [disableCode, setDisableCode] = useState("");

  const handleSetupStart = async () => {
    setError(null);
    setLoading(true);
    try {
      const response = await setupTOTP();
      setQrCode(response.qr_code);
      setSecret(response.secret);
      setSetupStep("qr");
      setIsSettingUp(true);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to start TOTP setup");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (verificationCode.length !== 6) {
      setError("Please enter a 6-digit code");
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const response = await enableTOTP(verificationCode);
      setBackupCodes(response.backup_codes);
      setSetupStep("backup");
      toast.success(t("auth.twoFactorEnabledSuccess"));
    } catch (err: any) {
      setError(err?.response?.data?.error || "Invalid verification code");
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    setError(null);
    setLoading(true);
    try {
      await disableTOTP(password || undefined, disableCode || undefined);
      setIsEnabled(false);
      setIsSettingUp(false);
      setSetupStep("init");
      setPassword("");
      setDisableCode("");
      onStatusChange?.(false);
      toast.success(t("auth.twoFactorDisabled"));
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to disable TOTP");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateNewBackupCodes = async () => {
    setError(null);
    setLoading(true);
    try {
      const response = await generateBackupCodes(
        password || undefined,
        disableCode || undefined,
      );
      setBackupCodes(response.backup_codes);
      toast.success(t("auth.newBackupCodesGenerated"));
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to generate backup codes");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(t("messages.copiedToClipboard", { item: label }));
  };

  const downloadBackupCodes = () => {
    const content =
      `Termix Two-Factor Authentication Backup Codes\n` +
      `Generated: ${new Date().toISOString()}\n\n` +
      `Keep these codes in a safe place. Each code can only be used once.\n\n` +
      backupCodes.map((code, i) => `${i + 1}. ${code}`).join("\n");

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "termix-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("auth.backupCodesDownloaded"));
  };

  const handleComplete = () => {
    setIsEnabled(true);
    setIsSettingUp(false);
    setSetupStep("init");
    setVerificationCode("");
    onStatusChange?.(true);
  };

  if (isEnabled && !isSettingUp) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            {t("auth.twoFactorTitle")}
          </CardTitle>
          <CardDescription>{t("auth.twoFactorProtected")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>{t("common.enabled")}</AlertTitle>
            <AlertDescription>{t("auth.twoFactorActive")}</AlertDescription>
          </Alert>

          <Tabs defaultValue="disable" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="disable">{t("auth.disable2FA")}</TabsTrigger>
              <TabsTrigger value="backup">{t("auth.backupCodes")}</TabsTrigger>
            </TabsList>

            <TabsContent value="disable" className="space-y-4">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{t("common.warning")}</AlertTitle>
                <AlertDescription>
                  {t("auth.disableTwoFactorWarning")}
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <Label htmlFor="disable-password">
                  {t("auth.passwordOrTotpCode")}
                </Label>
                <PasswordInput
                  id="disable-password"
                  placeholder={t("placeholders.enterPassword")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <p className="text-sm text-muted-foreground">{t("auth.or")}</p>
                <Input
                  id="disable-code"
                  type="text"
                  placeholder={t("placeholders.totpCode")}
                  maxLength={6}
                  value={disableCode}
                  onChange={(e) =>
                    setDisableCode(e.target.value.replace(/\D/g, ""))
                  }
                />
              </div>

              <Button
                variant="destructive"
                onClick={handleDisable}
                disabled={loading || (!password && !disableCode)}
              >
                {t("auth.disableTwoFactor")}
              </Button>
            </TabsContent>

            <TabsContent value="backup" className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("auth.generateNewBackupCodesText")}
              </p>

              <div className="space-y-2">
                <Label htmlFor="backup-password">
                  {t("auth.passwordOrTotpCode")}
                </Label>
                <PasswordInput
                  id="backup-password"
                  placeholder={t("placeholders.enterPassword")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <p className="text-sm text-muted-foreground">{t("auth.or")}</p>
                <Input
                  id="backup-code"
                  type="text"
                  placeholder={t("placeholders.totpCode")}
                  maxLength={6}
                  value={disableCode}
                  onChange={(e) =>
                    setDisableCode(e.target.value.replace(/\D/g, ""))
                  }
                />
              </div>

              <Button
                onClick={handleGenerateNewBackupCodes}
                disabled={loading || (!password && !disableCode)}
              >
                {t("auth.generateNewBackupCodes")}
              </Button>

              {backupCodes.length > 0 && (
                <div className="space-y-2 mt-4">
                  <div className="flex justify-between items-center">
                    <Label>{t("auth.yourBackupCodes")}</Label>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={downloadBackupCodes}
                    >
                      <Download className="w-4 h-4 mr-2" />
                      {t("auth.download")}
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 p-4 bg-muted rounded-lg font-mono text-sm">
                    {backupCodes.map((code, i) => (
                      <div key={i}>{code}</div>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{t("common.error")}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    );
  }

  if (setupStep === "qr") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("auth.setupTwoFactorTitle")}</CardTitle>
          <CardDescription>{t("auth.step1ScanQR")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-center">
            <img src={qrCode} alt="TOTP QR Code" className="w-64 h-64" />
          </div>

          <div className="space-y-2">
            <Label>{t("auth.manualEntryCode")}</Label>
            <div className="flex gap-2">
              <Input value={secret} readOnly className="font-mono text-sm" />
              <Button
                size="default"
                variant="outline"
                onClick={() => copyToClipboard(secret, "Secret key")}
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("auth.cannotScanQRText")}
            </p>
          </div>

          <Button onClick={() => setSetupStep("verify")} className="w-full">
            {t("auth.nextVerifyCode")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (setupStep === "verify") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("auth.verifyAuthenticator")}</CardTitle>
          <CardDescription>{t("auth.step2EnterCode")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="verify-code">{t("auth.verificationCode")}</Label>
            <Input
              id="verify-code"
              type="text"
              placeholder="000000"
              maxLength={6}
              value={verificationCode}
              onChange={(e) =>
                setVerificationCode(e.target.value.replace(/\D/g, ""))
              }
              className="text-center text-2xl tracking-widest font-mono"
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{t("common.error")}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setSetupStep("qr")}
              disabled={loading}
            >
              {t("auth.back")}
            </Button>
            <Button
              onClick={handleVerifyCode}
              disabled={loading || verificationCode.length !== 6}
              className="flex-1"
            >
              {loading ? t("interface.verifying") : t("auth.verifyAndEnable")}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (setupStep === "backup") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("auth.saveBackupCodesTitle")}</CardTitle>
          <CardDescription>{t("auth.step3StoreCodesSecurely")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t("common.important")}</AlertTitle>
            <AlertDescription>
              {t("auth.importantBackupCodesText")}
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label>Your Backup Codes</Label>
              <Button size="sm" variant="outline" onClick={downloadBackupCodes}>
                <Download className="w-4 h-4 mr-2" />
                Download
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2 p-4 bg-muted rounded-lg font-mono text-sm">
              {backupCodes.map((code, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-muted-foreground">{i + 1}.</span>
                  <span>{code}</span>
                </div>
              ))}
            </div>
          </div>

          <Button onClick={handleComplete} className="w-full">
            {t("auth.completeSetup")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="w-5 h-5" />
          {t("auth.twoFactorTitle")}
        </CardTitle>
        <CardDescription className="space-y-2">
          <p>{t("auth.addExtraSecurityLayer")}.</p>
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 text-xs"
            onClick={() =>
              window.open("https://docs.termix.site/totp", "_blank")
            }
          >
            {t("common.documentation")}
          </Button>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t("common.notEnabled")}</AlertTitle>
          <AlertDescription>{t("auth.notEnabledText")}</AlertDescription>
        </Alert>

        <Button
          onClick={handleSetupStart}
          disabled={loading}
          className="w-full h-11 text-base"
        >
          {loading ? t("common.settingUp") : t("auth.enableTwoFactorButton")}
        </Button>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
