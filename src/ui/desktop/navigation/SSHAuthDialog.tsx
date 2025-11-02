import React, { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, AlertCircle, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";

interface SSHAuthDialogProps {
  isOpen: boolean;
  reason: "no_keyboard" | "auth_failed" | "timeout";
  onSubmit: (credentials: {
    password?: string;
    sshKey?: string;
    keyPassword?: string;
  }) => void;
  onCancel: () => void;
  hostInfo: {
    ip: string;
    port: number;
    username: string;
    name?: string;
  };
  backgroundColor?: string;
}

export function SSHAuthDialog({
  isOpen,
  reason,
  onSubmit,
  onCancel,
  hostInfo,
  backgroundColor = "#18181b",
}: SSHAuthDialogProps) {
  const { t } = useTranslation();
  const [authTab, setAuthTab] = useState<"password" | "key">("password");
  const [password, setPassword] = useState("");
  const [sshKey, setSshKey] = useState("");
  const [keyPassword, setKeyPassword] = useState("");
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const getReasonMessage = () => {
    switch (reason) {
      case "no_keyboard":
        return t("auth.sshNoKeyboardInteractive");
      case "auth_failed":
        return t("auth.sshAuthenticationFailed");
      case "timeout":
        return t("auth.sshAuthenticationTimeout");
      default:
        return t("auth.sshAuthenticationRequired");
    }
  };

  const getReasonDescription = () => {
    switch (reason) {
      case "no_keyboard":
        return t("auth.sshNoKeyboardInteractiveDescription");
      case "auth_failed":
        return t("auth.sshAuthFailedDescription");
      case "timeout":
        return t("auth.sshTimeoutDescription");
      default:
        return t("auth.sshProvideCredentialsDescription");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const credentials: {
        password?: string;
        sshKey?: string;
        keyPassword?: string;
      } = {};

      if (authTab === "password") {
        if (password.trim()) {
          credentials.password = password;
        }
      } else {
        if (sshKey.trim()) {
          credentials.sshKey = sshKey;
          if (keyPassword.trim()) {
            credentials.keyPassword = keyPassword;
          }
        }
      }

      onSubmit(credentials);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const fileContent = await file.text();
        setSshKey(fileContent);
      } catch (error) {
        console.error("Failed to read SSH key file:", error);
      }
    }
  };

  const canSubmit = () => {
    if (authTab === "password") {
      return password.trim() !== "";
    } else {
      return sshKey.trim() !== "";
    }
  };

  const hostDisplay = hostInfo.name
    ? `${hostInfo.name} (${hostInfo.username}@${hostInfo.ip}:${hostInfo.port})`
    : `${hostInfo.username}@${hostInfo.ip}:${hostInfo.port}`;

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-dark-bg"
      style={{ backgroundColor }}
    >
      <Card className="w-full max-w-2xl mx-4 border-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            {t("auth.sshAuthenticationRequired")}
          </CardTitle>
          <CardDescription>{hostDisplay}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant={reason === "auth_failed" ? "destructive" : "default"}>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{getReasonMessage()}</AlertTitle>
            <AlertDescription>{getReasonDescription()}</AlertDescription>
          </Alert>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Tabs
              value={authTab}
              onValueChange={(v) => setAuthTab(v as "password" | "key")}
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="password">
                  {t("credentials.password")}
                </TabsTrigger>
                <TabsTrigger value="key">{t("credentials.sshKey")}</TabsTrigger>
              </TabsList>

              <TabsContent value="password" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="ssh-password">
                    {t("credentials.password")}
                  </Label>
                  <PasswordInput
                    id="ssh-password"
                    placeholder={t("placeholders.enterPassword")}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoFocus
                  />
                  <p className="text-sm text-muted-foreground">
                    {t("auth.sshPasswordDescription")}
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="key" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="ssh-key">
                    {t("credentials.sshPrivateKey")}
                  </Label>
                  <div className="mb-2">
                    <div className="relative inline-block w-full">
                      <input
                        id="key-upload"
                        type="file"
                        accept="*,.pem,.key,.txt,.ppk"
                        onChange={handleKeyFileUpload}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full justify-start text-left"
                      >
                        <Upload className="w-4 h-4 mr-2" />
                        <span className="truncate">
                          {t("credentials.uploadPrivateKeyFile")}
                        </span>
                      </Button>
                    </div>
                  </div>
                  <CodeMirror
                    value={sshKey}
                    onChange={(value) => setSshKey(value)}
                    placeholder={t("placeholders.pastePrivateKey")}
                    theme={oneDark}
                    className="border border-input rounded-md"
                    minHeight="200px"
                    maxHeight="300px"
                    basicSetup={{
                      lineNumbers: true,
                      foldGutter: false,
                      dropCursor: false,
                      allowMultipleSelections: false,
                      highlightSelectionMatches: false,
                      searchKeymap: false,
                      scrollPastEnd: false,
                    }}
                    extensions={[
                      EditorView.theme({
                        ".cm-scroller": {
                          overflow: "auto",
                        },
                      }),
                    ]}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ssh-key-password">
                    {t("credentials.keyPassword")} ({t("common.optional")})
                  </Label>
                  <PasswordInput
                    id="ssh-key-password"
                    placeholder={t("placeholders.keyPassword")}
                    value={keyPassword}
                    onChange={(e) => setKeyPassword(e.target.value)}
                  />
                  <p className="text-sm text-muted-foreground">
                    {t("auth.sshKeyPasswordDescription")}
                  </p>
                </div>
              </TabsContent>
            </Tabs>

            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={loading}
                className="flex-1"
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={!canSubmit() || loading}
                className="flex-1"
              >
                {loading ? t("common.connecting") : t("common.connect")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
