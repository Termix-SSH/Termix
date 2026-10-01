import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/input";
import type { Host } from "@/types/ui-types";
import { getCredentials } from "@/api/credentials-api";
import { mapCredentials } from "./HostManagerData";
import { resolveHostDefaults } from "@/api/host-defaults-api";
import {
  pluginSettingsFrom,
  withDefaultPluginSettings,
} from "./host-defaults/quick-connect-defaults";
import {
  createQuickConnectHost,
  quickConnectTargets,
} from "./quick-connect-host";
import { useHostProtocols } from "./host-protocols";
import { Select2 } from "@/components/select2";
import { useSshAuthProviders } from "@/hooks/useSshAuthProviders";
import { useSshAuthEditors } from "@/plugin-host/auth-registry";
import { useHostActions, type HostActionDef } from "./host-contributions";

// Core types Quick Connect draws its own fields for.
const INLINE_AUTH_TYPES = new Set(["password", "key", "credential"]);

const LABEL_CLASS =
  "text-[10px] font-semibold uppercase tracking-widest text-muted-foreground";
const SELECT_CLASS =
  "flex h-7 w-full border border-border bg-background px-2.5 py-1 text-xs outline-none focus:ring-1 focus:ring-ring";

interface QuickConnectPanelProps {
  onConnect: (host: Host, type: string) => void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label className={LABEL_CLASS}>{label}</label>
      {children}
    </div>
  );
}

export function QuickConnectPanel({ onConnect }: QuickConnectPanelProps) {
  const { t } = useTranslation();
  const [host, setHost] = useState("");
  // "ssh", or the id of a plugin protocol offered in Quick Connect.
  const [protocol, setProtocol] = useState("ssh");
  const [port, setPort] = useState("22");
  const [domain, setDomain] = useState("");
  const [username, setUsername] = useState("root");
  const [authType, setAuthType] = useState("password");
  const [authFields, setAuthFields] = useState<Record<string, unknown>>({});
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [credentialId, setCredentialId] = useState("");
  const [credentials, setCredentials] = useState<
    { id: string; name: string; username: string }[]
  >([]);

  useEffect(() => {
    getCredentials()
      .then((res) => setCredentials(mapCredentials(res)))
      .catch(() => {});
  }, []);

  // Every registered SSH auth type that works for a host that is never saved.
  const { providers } = useSshAuthProviders();
  const authOptions = providers.filter(
    (option) => option.available && option.quickConnect,
  );
  const authEditor = useSshAuthEditors().find(
    (editor) => editor.id === authType,
  );
  const AuthEditor = INLINE_AUTH_TYPES.has(authType)
    ? undefined
    : authEditor?.component;
  const allActions = useHostActions();

  const pluginProtocols = useHostProtocols().filter(
    (entry) => entry.quickConnect,
  );
  const selected = pluginProtocols.find((entry) => entry.id === protocol);
  const isDesktop = !!selected;
  const defaultPort = (id: string) =>
    String(pluginProtocols.find((entry) => entry.id === id)?.defaultPort ?? 22);

  const switchProtocol = (next: string) => {
    // Keep a port the user typed; only swap the protocol default.
    if (port === defaultPort(protocol)) setPort(defaultPort(next));
    setProtocol(next);
  };

  // A host that is never saved still follows the user's host defaults.
  const [defaultPluginSettings, setDefaultPluginSettings] = useState<
    Record<string, Record<string, unknown>>
  >({});
  useEffect(() => {
    resolveHostDefaults({ folder: null })
      .then((values) => setDefaultPluginSettings(pluginSettingsFrom(values)))
      .catch(() => {});
  }, []);

  const buildHost = () =>
    withDefaultPluginSettings(
      createQuickConnectHost({
        ip: host.trim(),
        port: parseInt(port) || parseInt(defaultPort(protocol)),
        username,
        authType: isDesktop ? "password" : authType,
        password,
        key: privateKey,
        credentialId,
        protocol: selected,
        domain: domain || undefined,
        authFields: INLINE_AUTH_TYPES.has(authType) ? undefined : authFields,
      }),
      defaultPluginSettings,
    );

  const targets = quickConnectTargets(allActions, buildHost());

  const connect = (action?: HostActionDef) => {
    if (!host.trim()) return;
    if (!isDesktop && !username) return;
    const hostConfig = buildHost();
    const target = action ?? quickConnectTargets(allActions, hostConfig)[0];
    if (!target?.tabType) {
      toast.error(t("newUi.sidebar.quickConnect.noTarget"));
      return;
    }
    onConnect(hostConfig, target.tabType);
  };

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") connect();
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <div className="flex flex-col gap-3 p-3">
        <div className="grid grid-cols-[1fr_5rem] gap-2">
          <Field label={t("newUi.sidebar.quickConnect.protocolLabel")}>
            <Select2
              value={protocol}
              onChange={(e) => switchProtocol(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="ssh">
                {t("newUi.sidebar.quickConnect.sshProtocol")}
              </option>
              {pluginProtocols.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {t(entry.titleKey)}
                </option>
              ))}
            </Select2>
          </Field>
          <Field label={t("newUi.sidebar.quickConnect.portLabel")}>
            <Input
              placeholder={defaultPort(protocol)}
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={onEnter}
              className="h-7 text-xs"
            />
          </Field>
        </div>
        <Field label={t("newUi.sidebar.quickConnect.hostLabel")}>
          <Input
            placeholder={t("newUi.sidebar.quickConnect.hostPlaceholder")}
            value={host}
            onChange={(e) => setHost(e.target.value)}
            onKeyDown={onEnter}
            className="h-7 text-xs"
          />
        </Field>
        <Field label={t("newUi.sidebar.quickConnect.usernameLabel")}>
          <Input
            placeholder={t("newUi.sidebar.quickConnect.usernamePlaceholder")}
            value={username}
            onFocus={() => {
              if (username === "root") setUsername("");
            }}
            onBlur={() => {
              if (username === "") setUsername("root");
            }}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={onEnter}
            className="h-7 text-xs"
          />
        </Field>
        {!isDesktop && authOptions.length > 0 && (
          <Field label={t("newUi.sidebar.quickConnect.authLabel")}>
            <Select2
              value={authType}
              onChange={(e) => {
                setAuthType(e.target.value);
                setAuthFields({});
              }}
              className={SELECT_CLASS}
            >
              {authOptions.map((option) => (
                <option key={option.type} value={option.type}>
                  {t(option.editorTitleKey ?? option.labelKey)}
                </option>
              ))}
            </Select2>
          </Field>
        )}
        {(isDesktop || authType === "password") && (
          <Field label={t("newUi.sidebar.quickConnect.passwordLabel")}>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder={t(
                  "newUi.sidebar.quickConnect.passwordPlaceholder",
                )}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={onEnter}
                className="h-7 text-xs pr-8"
              />
              <button
                type="button"
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
          </Field>
        )}
        {selected?.quickConnect?.showDomain && (
          <Field label={t("newUi.sidebar.quickConnect.domainLabel")}>
            <Input
              placeholder={t("newUi.sidebar.quickConnect.domainPlaceholder")}
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onKeyDown={onEnter}
              className="h-7 text-xs"
            />
          </Field>
        )}
        {!isDesktop && authType === "key" && (
          <Field label={t("newUi.sidebar.quickConnect.privateKeyLabel")}>
            <textarea
              placeholder={t(
                "newUi.sidebar.quickConnect.privateKeyPlaceholder",
              )}
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              className="w-full h-24 px-2.5 py-2 text-xs bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring font-mono"
            />
          </Field>
        )}
        {!isDesktop && authType === "credential" && (
          <Field label={t("newUi.sidebar.quickConnect.credentialLabel")}>
            <Select2
              value={credentialId}
              onChange={(e) => {
                const newId = e.target.value;
                setCredentialId(newId);
                const cred = credentials.find((c) => c.id === newId);
                if (cred?.username) setUsername(cred.username);
              }}
              className={SELECT_CLASS}
            >
              <option value="">
                {t("newUi.sidebar.quickConnect.credentialPlaceholder")}
              </option>
              {credentials.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.username ? `${c.name} (${c.username})` : c.name}
                </option>
              ))}
            </Select2>
          </Field>
        )}
        {!isDesktop && AuthEditor && (
          <AuthEditor
            form={{ ...authFields, ip: host, port, username }}
            setField={(key, value) => {
              if (key === "ip") setHost(String(value ?? ""));
              else if (key === "port") setPort(String(value ?? ""));
              else if (key === "username") setUsername(String(value ?? ""));
              else setAuthFields((current) => ({ ...current, [key]: value }));
            }}
          />
        )}
        <div className="flex flex-col gap-1.5 pt-1">
          {targets.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("newUi.sidebar.quickConnect.noTarget")}
            </p>
          ) : (
            targets.map((action, index) => (
              <button
                key={action.id}
                type="button"
                disabled={!host.trim()}
                onClick={() => connect(action)}
                className={`flex items-center justify-center gap-1.5 h-7 w-full border text-xs font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none ${
                  index === 0
                    ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand hover:bg-accent-brand/20"
                    : "border-border text-foreground hover:bg-muted"
                }`}
              >
                <action.icon className="size-3.5" />
                {t("newUi.sidebar.quickConnect.connectToAction", {
                  name: t(action.titleKey),
                })}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
