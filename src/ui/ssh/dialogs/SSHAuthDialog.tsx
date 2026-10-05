import React, { useState } from "react";
import { Button } from "@/components/button.tsx";
import { PasswordInput } from "@/components/password-input.tsx";
import { Label } from "@/components/label.tsx";
import { PanePrompt } from "@/components/surface/surface-scope";
import {
  PROMPT_BUTTON,
  PROMPT_PRIMARY_BUTTON,
} from "@/components/surface/prompt-styles";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/tabs.tsx";
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
  backgroundColor,
}: SSHAuthDialogProps) {
  const { t } = useTranslation();
  const [authTab, setAuthTab] = useState<"password" | "key">("password");
  const [password, setPassword] = useState("");
  const [sshKey, setSshKey] = useState("");
  const [keyPassword, setKeyPassword] = useState("");
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const hostDisplay = hostInfo.name
    ? `${hostInfo.name} (${hostInfo.username}@${hostInfo.ip}:${hostInfo.port})`
    : `${hostInfo.username}@${hostInfo.ip}:${hostInfo.port}`;

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

  const canSubmit = () =>
    authTab === "password" ? password !== "" : sshKey.trim() !== "";

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
        if (password !== "") credentials.password = password;
      } else {
        if (sshKey.trim()) {
          credentials.sshKey = sshKey;
          if (password !== "") credentials.password = password;
          if (keyPassword.trim()) credentials.keyPassword = keyPassword;
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
        setSshKey(await file.text());
      } catch (error) {
        console.error("Failed to read SSH key file:", error);
      }
    }
  };

  return (
    <PanePrompt
      open
      layer="connection"
      backgroundColor={backgroundColor}
      icon={<Shield className="size-4" />}
      title={t("auth.sshAuthenticationRequired")}
      description={<span className="font-mono">{hostDisplay}</span>}
      className="max-w-xl"
    >
      <form onSubmit={handleSubmit}>
        <div className="flex flex-col gap-3">
          <div
            className={`flex items-start gap-3 p-3 border ${
              reason === "auth_failed"
                ? "border-destructive/20 bg-destructive/10"
                : "border-border bg-muted/10"
            }`}
          >
            <AlertCircle
              className={`size-4 shrink-0 mt-0.5 ${reason === "auth_failed" ? "text-destructive" : "text-accent-brand"}`}
            />
            <div>
              <p
                className={`text-[10px] font-bold uppercase tracking-widest ${reason === "auth_failed" ? "text-destructive" : ""}`}
              >
                {getReasonMessage()}
              </p>
              <p
                className={`text-xs mt-1 ${reason === "auth_failed" ? "text-destructive/80" : "text-muted-foreground"}`}
              >
                {getReasonDescription()}
              </p>
            </div>
          </div>

          <Tabs
            value={authTab}
            onValueChange={(v) => setAuthTab(v as "password" | "key")}
          >
            <TabsList className="w-full rounded-none">
              <TabsTrigger
                value="password"
                className="flex-1 rounded-none text-[10px] font-bold uppercase tracking-widest"
              >
                {t("credentials.password")}
              </TabsTrigger>
              <TabsTrigger
                value="key"
                className="flex-1 rounded-none text-[10px] font-bold uppercase tracking-widest"
              >
                {t("credentials.sshKey")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="password" className="mt-3 flex flex-col gap-2">
              <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("credentials.password")}
              </Label>
              <PasswordInput
                placeholder={t("placeholders.enterPassword")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                className="rounded-none bg-muted/50 border-border text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                {t("auth.sshPasswordDescription")}
              </p>
            </TabsContent>

            <TabsContent value="key" className="mt-3 flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("credentials.sshPrivateKey")}
                </Label>
                <div className="relative">
                  <input
                    id="key-upload"
                    type="file"
                    accept="*,.pem,.key,.ppk,.txt"
                    onChange={handleKeyFileUpload}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start rounded-none text-[10px] font-bold uppercase tracking-widest border-border"
                  >
                    <Upload className="size-3.5 mr-2" />
                    <span className="truncate">
                      {t("credentials.uploadPrivateKeyFile")}
                    </span>
                  </Button>
                </div>
                <CodeMirror
                  value={sshKey}
                  onChange={(value) => setSshKey(value)}
                  placeholder={t("placeholders.pastePrivateKey")}
                  theme={oneDark}
                  className="border border-border text-xs"
                  minHeight="160px"
                  maxHeight="260px"
                  basicSetup={{
                    lineNumbers: true,
                    foldGutter: false,
                    dropCursor: false,
                    allowMultipleSelections: false,
                    highlightSelectionMatches: false,
                    searchKeymap: false,
                  }}
                  extensions={[
                    EditorView.theme({
                      ".cm-scroller": {
                        overflow: "auto",
                        scrollbarWidth: "thin",
                        scrollbarColor:
                          "var(--scrollbar-thumb) var(--scrollbar-track)",
                      },
                    }),
                  ]}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("credentials.keyPassword")} ({t("common.optional")})
                </Label>
                <PasswordInput
                  placeholder={t("placeholders.keyPassword")}
                  value={keyPassword}
                  onChange={(e) => setKeyPassword(e.target.value)}
                  className="rounded-none bg-muted/50 border-border text-xs"
                />
                <p className="text-[10px] text-muted-foreground">
                  {t("auth.sshKeyPasswordDescription")}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("credentials.password")} ({t("common.optional")})
                </Label>
                <PasswordInput
                  placeholder={t("placeholders.enterPassword")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="rounded-none bg-muted/50 border-border text-xs"
                />
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <div className="flex justify-end gap-2 pt-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className={PROMPT_BUTTON}
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={!canSubmit() || loading}
            className={PROMPT_PRIMARY_BUTTON}
          >
            {loading ? t("common.connecting") : t("common.connect")}
          </button>
        </div>
      </form>
    </PanePrompt>
  );
}
