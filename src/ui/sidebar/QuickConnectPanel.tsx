import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, FolderSearch, Terminal } from "lucide-react";
import { Input } from "@/components/input";
import type { Host } from "@/types/ui-types";

interface QuickConnectPanelProps {
  onConnect: (host: Host, type: "terminal" | "files") => void;
}

export function QuickConnectPanel({ onConnect }: QuickConnectPanelProps) {
  const { t } = useTranslation();
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [authType, setAuthType] = useState<"password" | "key" | "credential">(
    "password",
  );
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const connect = (type: "terminal" | "files") => {
    if (!host || !username) return;
    const hostConfig: Host = {
      id: `quick-connect-${Date.now()}`,
      name: `${username}@${host}`,
      ip: host,
      port: parseInt(port) || 22,
      username,
      authType,
      password: authType === "password" ? password : undefined,
      key: authType === "key" ? privateKey : undefined,
      folder: "",
      online: false,
      cpu: null,
      ram: null,
      lastAccess: new Date().toISOString(),
      pin: false,
      defaultPath: "",
      serverTunnels: [],
      quickActions: [],
      enableTerminal: true,
      enableFileManager: true,
      enableTunnel: true,
      enableDocker: true,
      enableSsh: true,
      enableRdp: false,
      enableVnc: false,
      enableTelnet: false,
      sshPort: parseInt(port) || 22,
      rdpPort: 3389,
      vncPort: 5900,
      telnetPort: 23,
    };
    onConnect(hostConfig, type);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <div className="flex flex-col gap-3 p-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t("newUi.sidebar.quickConnect.hostLabel")}
          </label>
          <Input
            placeholder={t("newUi.sidebar.quickConnect.hostPlaceholder")}
            value={host}
            onChange={(e) => setHost(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") connect("terminal");
            }}
            className="h-7 text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t("newUi.sidebar.quickConnect.portLabel")}
          </label>
          <Input
            placeholder={t("newUi.sidebar.quickConnect.portPlaceholder")}
            value={port}
            onChange={(e) => setPort(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") connect("terminal");
            }}
            className="h-7 text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t("newUi.sidebar.quickConnect.usernameLabel")}
          </label>
          <Input
            placeholder={t("newUi.sidebar.quickConnect.usernamePlaceholder")}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") connect("terminal");
            }}
            className="h-7 text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t("newUi.sidebar.quickConnect.authLabel")}
          </label>
          <div className="flex gap-1">
            {(["password", "key", "credential"] as const).map((type) => (
              <button
                key={type}
                onClick={() => setAuthType(type)}
                className={`flex-1 py-1 text-[10px] font-semibold border transition-colors capitalize ${
                  authType === type
                    ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>
        {authType === "password" && (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("newUi.sidebar.quickConnect.passwordLabel")}
            </label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder={t(
                  "newUi.sidebar.quickConnect.passwordPlaceholder",
                )}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") connect("terminal");
                }}
                className="h-7 text-xs pr-8"
              />
              <button
                onClick={() => setShowPassword((o) => !o)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? (
                  <EyeOff className="size-3.5" />
                ) : (
                  <Eye className="size-3.5" />
                )}
              </button>
            </div>
          </div>
        )}
        {authType === "key" && (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("newUi.sidebar.quickConnect.privateKeyLabel")}
            </label>
            <textarea
              placeholder={t(
                "newUi.sidebar.quickConnect.privateKeyPlaceholder",
              )}
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              className="w-full h-24 px-2.5 py-2 text-xs bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring font-mono"
            />
          </div>
        )}
        {authType === "credential" && (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("newUi.sidebar.quickConnect.credentialLabel")}
            </label>
            <Input
              placeholder={t(
                "newUi.sidebar.quickConnect.credentialPlaceholder",
              )}
              className="h-7 text-xs"
            />
          </div>
        )}
        <div className="flex flex-col gap-1.5 pt-1">
          <button
            onClick={() => connect("terminal")}
            className="flex items-center justify-center gap-1.5 h-7 w-full border border-accent-brand/40 bg-accent-brand/10 text-accent-brand text-xs font-semibold hover:bg-accent-brand/20 transition-colors"
          >
            <Terminal className="size-3.5" />
            {t("newUi.sidebar.quickConnect.connectToTerminal")}
          </button>
          <button
            onClick={() => connect("files")}
            className="flex items-center justify-center gap-1.5 h-7 w-full border border-accent-brand/40 bg-accent-brand/10 text-accent-brand text-xs font-semibold hover:bg-accent-brand/20 transition-colors"
          >
            <FolderSearch className="size-3.5" />
            {t("newUi.sidebar.quickConnect.connectToFiles")}
          </button>
        </div>
      </div>
    </div>
  );
}
