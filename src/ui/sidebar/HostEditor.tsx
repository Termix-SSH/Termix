import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  TERMINAL_THEMES,
  TERMINAL_FONTS,
  BELL_STYLES,
  FAST_SCROLL_MODIFIERS,
  CURSOR_STYLES,
} from "@/lib/terminal-themes";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { PasswordInput } from "@/components/password-input";
import { Slider } from "@/components/slider";
import {
  Globe,
  Layers, // --- tmux-monitor ---
  Network,
  Palette,
  Plus,
  Shield,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { SectionCard, SettingRow, FakeSwitch } from "@/components/section-card";
import { TerminalPreview } from "@/features/terminal/TerminalPreview";
import {
  createSSHHost,
  updateSSHHost,
  getSnippets,
  subscribeTunnelStatuses,
  connectTunnel,
  disconnectTunnel,
  getUserInfo,
} from "@/main-axios";
import { getTailscaleDevices, getHostDefaults } from "@/api/settings-api";
import type { Host } from "@/types/ui-types";
import type { SSHHost, TunnelStatus } from "@/types";
import { useTabsSafe } from "@/shell/TabContext";
import {
  buildHostEditorPayload,
  createHostEditorForm,
  mapSnippetResponse,
  type HostAuthType,
  type HostBellStyle,
  type HostBackspaceMode,
  type HostCursorStyle,
  type HostFastScrollModifier,
  type HostProtocols,
} from "./HostEditorData";
import {
  HostDockerTab,
  HostProxmoxTab,
  HostFilesTab,
} from "./HostEditorFeatureTabs";
import { HostEditorGeneralTab } from "./HostEditorGeneralTab";
import {
  HostEditorRdpTab,
  HostEditorTelnetTab,
  HostEditorVncTab,
} from "./HostEditorGuacamoleTabs";
import { HostStatsTab } from "./HostEditorStatsTab";

export function HostEditor({
  host,
  activeTab,
  onBack,
  onSave,
  protocols,
  onProtocolChange,
  onTabChange,
  hosts,
  credentials,
}: {
  host: Host | null;
  activeTab: string;
  onBack: () => void;
  onSave: (saved: SSHHost) => void;
  protocols: HostProtocols;
  onProtocolChange: (p: Partial<typeof protocols>) => void;
  onTabChange: (tab: string) => void;
  hosts: Host[];
  credentials: { id: string; name: string; username: string }[];
}) {
  const { t } = useTranslation();
  const { setPreviewTerminalTheme } = useTabsSafe();
  const [form, setForm] = useState(() => createHostEditorForm(host));

  const setField = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const setGuacField = (key: string, value: unknown) =>
    setField("guacamoleConfig", { ...form.guacamoleConfig, [key]: value });

  const [saving, setSaving] = useState(false);
  const [snippets, setSnippets] = useState<{ id: number; name: string }[]>([]);
  const [tunnelStatuses, setTunnelStatuses] = useState<
    Record<string, TunnelStatus>
  >({});
  const [tailscaleDevices, setTailscaleDevices] = useState<
    Array<{
      id: string;
      name: string;
      hostname: string;
      addresses: string[];
      os: string;
      lastSeen: string;
    }>
  >([]);
  const [tailscaleHasApiKey, setTailscaleHasApiKey] = useState(false);
  const [tailscaleLoading, setTailscaleLoading] = useState(false);
  const [connectingTunnel, setConnectingTunnel] = useState<number | null>(null);
  const [isOidcUser, setIsOidcUser] = useState(false);

  useEffect(() => {
    getUserInfo()
      .then((info) => setIsOidcUser(info.is_oidc))
      .catch(() => {});
  }, []);

  useEffect(() => {
    getSnippets()
      .then((res) => setSnippets(mapSnippetResponse(res)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (host) return;
    getHostDefaults()
      .then((d) => setForm(createHostEditorForm(null, d)))
      .catch(() => {});
  }, [host]);

  useEffect(() => {
    if (activeTab !== "tunnels") return;
    const unsub = subscribeTunnelStatuses((s) => setTunnelStatuses(s));
    return unsub;
  }, [activeTab]);

  useEffect(() => {
    if (form.authType !== "tailscale") return;
    setTailscaleLoading(true);
    getTailscaleDevices()
      .then((res) => {
        setTailscaleDevices(res?.devices ?? []);
        setTailscaleHasApiKey(res?.hasApiKey ?? false);
      })
      .catch(() => {})
      .finally(() => setTailscaleLoading(false));
  }, [form.authType]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = buildHostEditorPayload(form, protocols);
      const saved = host
        ? await updateSSHHost(Number(host.id), data)
        : await createSSHHost(data);
      toast.success(host ? t("hosts.hostUpdated") : t("hosts.hostCreated"));
      setPreviewTerminalTheme(null);
      onSave(saved);
    } catch {
      toast.error(t("hosts.failedToSave"));
    } finally {
      setSaving(false);
    }
  };

  const authMethod = form.authType;
  const selectedCredential = credentials.find(
    (c) => c.id === form.credentialId,
  );

  const handleProtocolToggle = (
    proto: keyof typeof protocols,
    value: boolean,
  ) => {
    onProtocolChange({ [proto]: value });
    const tabForProto: Record<string, string> = {
      enableSsh: "ssh",
      enableRdp: "rdp",
      enableVnc: "vnc",
      enableTelnet: "telnet",
    };
    const sshGroupTabs = [
      "ssh",
      "terminal",
      "tunnels",
      "docker",
      "files",
      "host-metrics",
    ];
    if (!value) {
      if (proto === "enableSsh" && sshGroupTabs.includes(activeTab)) {
        onTabChange("general");
      } else if (activeTab === tabForProto[proto]) {
        onTabChange("general");
      }
    }
    if (value && tabForProto[proto]) onTabChange(tabForProto[proto]);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3">
        {activeTab === "general" && (
          <HostEditorGeneralTab
            form={form}
            setField={setField}
            protocols={protocols}
            handleProtocolToggle={handleProtocolToggle}
            hosts={hosts}
            host={host}
          />
        )}

        {activeTab === "ssh" && (
          <>
            <SectionCard
              title={t("hosts.connectionLabel")}
              icon={<Globe className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.sshPort")}
                  </label>
                  <Input
                    type="number"
                    placeholder="22"
                    value={form.sshPort}
                    onChange={(e) =>
                      setField("sshPort", Number(e.target.value))
                    }
                    className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
              </div>
            </SectionCard>
            <SectionCard
              title={t("hosts.authenticationLabel")}
              icon={<Shield className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.authMethod")}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      "password",
                      "key",
                      "credential",
                      "none",
                      "opkssh",
                      "tailscale",
                    ].map((m) => (
                      <button
                        key={m}
                        onClick={() => {
                          setField("authType", m as HostAuthType);
                        }}
                        className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border transition-colors ${authMethod === m ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand" : "border-border text-muted-foreground hover:text-foreground"}`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-border pt-4 mt-1">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.username")}
                    </label>
                    <Input
                      placeholder="root"
                      value={form.username}
                      disabled={
                        authMethod === "credential" &&
                        !!selectedCredential?.username &&
                        !form.overrideCredentialUsername
                      }
                      onFocus={() => {
                        if (form.username === "root") setField("username", "");
                      }}
                      onBlur={() => {
                        if (form.username === "") setField("username", "root");
                      }}
                      onChange={(e) => setField("username", e.target.value)}
                    />
                    {isOidcUser && (
                      <p className="text-[10px] text-muted-foreground/60">
                        {t("hosts.oidcUsernameHint")}
                      </p>
                    )}
                  </div>
                  {authMethod === "password" && (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {t("hosts.password")}
                      </label>
                      <PasswordInput
                        className="h-8 text-xs pr-8"
                        placeholder="••••••••"
                        value={form.password}
                        onChange={(e) => setField("password", e.target.value)}
                      />
                    </div>
                  )}
                  {authMethod === "key" && (
                    <>
                      <div className="flex flex-col gap-1.5 col-span-2">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            {t("hosts.sshPrivateKey")}
                          </label>
                          <div className="flex gap-1">
                            {(["paste", "upload"] as const).map((tab) => (
                              <button
                                key={tab}
                                type="button"
                                onClick={() => setField("keySubTab", tab)}
                                className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest border transition-colors ${form.keySubTab === tab ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand" : "border-border text-muted-foreground hover:text-foreground"}`}
                              >
                                {tab === "paste"
                                  ? t("hosts.keyPasteTab")
                                  : t("hosts.keyUploadTab")}
                              </button>
                            ))}
                          </div>
                        </div>
                        {form.keySubTab === "paste" ? (
                          <div className="flex flex-col gap-1.5">
                            {form.key === "existing_key" && (
                              <div className="px-3 py-2 text-[10px] border border-accent-brand/30 bg-accent-brand/5 text-accent-brand">
                                {t("hosts.keySaved")} —{" "}
                                {t("hosts.keyReplaceNotice")}
                              </div>
                            )}
                            <textarea
                              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                              rows={5}
                              value={
                                form.key === "existing_key" ? "" : form.key
                              }
                              onChange={(e) => setField("key", e.target.value)}
                              className="w-full px-3 py-2 text-[10px] bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring font-mono"
                            />
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2">
                            <label
                              className={`flex items-center justify-center gap-2 h-16 border-2 border-dashed cursor-pointer transition-colors ${form.key ? "border-accent-brand/40 bg-accent-brand/5 text-accent-brand" : "border-border text-muted-foreground hover:border-accent-brand/30 hover:text-foreground"}`}
                            >
                              <Upload className="size-4" />
                              <span className="text-xs">
                                {form.key === "existing_key"
                                  ? t("hosts.keySaved")
                                  : form.key
                                    ? t("hosts.keyFileLoaded")
                                    : t("hosts.keyUploadClick")}
                              </span>
                              <input
                                type="file"
                                accept=".pem,.key,.txt"
                                className="hidden"
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  const text = await file.text();
                                  setField("key", text);
                                  e.target.value = "";
                                }}
                              />
                            </label>
                            {form.key && (
                              <button
                                type="button"
                                onClick={() => setField("key", "")}
                                className="text-[10px] text-destructive self-start"
                              >
                                {form.key === "existing_key"
                                  ? t("hosts.replaceKey")
                                  : t("hosts.clearKey")}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          {t("hosts.keyPassphrase")}
                        </label>
                        <PasswordInput
                          className="h-8 text-xs pr-8"
                          placeholder={
                            form.keyPassword === "existing_key_password"
                              ? t("hosts.keyPassphraseSaved")
                              : t("hosts.optional")
                          }
                          value={
                            form.keyPassword === "existing_key_password"
                              ? ""
                              : form.keyPassword
                          }
                          onFocus={() => {
                            if (form.keyPassword === "existing_key_password")
                              setField("keyPassword", "");
                          }}
                          onChange={(e) =>
                            setField("keyPassword", e.target.value)
                          }
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          {t("hosts.keyTypeLabel")}
                        </label>
                        <select
                          value={form.keyType}
                          onChange={(e) => setField("keyType", e.target.value)}
                          className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                        >
                          <option value="auto">{t("hosts.keyTypeAuto")}</option>
                          <option value="ssh-rsa">RSA</option>
                          <option value="ssh-ed25519">Ed25519</option>
                          <option value="ecdsa-sha2-nistp256">
                            ECDSA P-256
                          </option>
                          <option value="ecdsa-sha2-nistp384">
                            ECDSA P-384
                          </option>
                          <option value="ecdsa-sha2-nistp521">
                            ECDSA P-521
                          </option>
                          <option value="ssh-dss">DSA</option>
                          <option value="ssh-rsa-sha2-256">RSA SHA2-256</option>
                          <option value="ssh-rsa-sha2-512">RSA SHA2-512</option>
                        </select>
                      </div>
                    </>
                  )}
                  {authMethod === "credential" && (
                    <>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          {t("hosts.storedCredential")}
                        </label>
                        <select
                          value={form.credentialId}
                          onChange={(e) => {
                            const newId = e.target.value;
                            setField("credentialId", newId);
                            if (!form.overrideCredentialUsername) {
                              const cred = credentials.find(
                                (c) => c.id === newId,
                              );
                              if (cred?.username)
                                setField("username", cred.username);
                            }
                          }}
                          className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                        >
                          <option value="">
                            {t("hosts.selectACredential")}
                          </option>
                          {credentials.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.username
                                ? `${c.name} (${c.username})`
                                : c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      {selectedCredential?.username && (
                        <div className="flex items-center justify-between col-span-2 pt-1">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs font-medium">
                              {t("hosts.overrideCredentialUsername")}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {t("hosts.overrideCredentialUsernameDesc")}
                            </span>
                          </div>
                          <FakeSwitch
                            checked={form.overrideCredentialUsername}
                            onChange={(v) => {
                              setField("overrideCredentialUsername", v);
                              if (!v && selectedCredential?.username) {
                                setField(
                                  "username",
                                  selectedCredential.username,
                                );
                              }
                            }}
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
                {authMethod === "opkssh" && (
                  <div className="flex flex-col gap-2 border-t border-border pt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {t("hosts.opksshLabel")}
                      </span>
                      <a
                        href="https://docs.termix.site/features/authentication/opkssh"
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-accent-brand hover:underline"
                      >
                        {t("hosts.docsLink")}
                      </a>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {t("hosts.opksshDesc")}
                    </p>
                  </div>
                )}
                {authMethod === "tailscale" && (
                  <div className="flex flex-col gap-2 border-t border-border pt-3">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {t("hosts.tailscaleDeviceSelect")}
                      </label>
                      <a
                        href="https://docs.termix.site/features/networking/tailscale"
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-accent-brand hover:underline"
                      >
                        {t("hosts.tailscaleDocsLink")}
                      </a>
                    </div>
                    {!tailscaleHasApiKey && !tailscaleLoading ? (
                      <p className="text-[10px] text-muted-foreground">
                        {t("hosts.tailscaleNoApiKey")}
                      </p>
                    ) : tailscaleLoading ? (
                      <p className="text-[10px] text-muted-foreground">
                        {t("hosts.tailscaleLoadingDevices")}
                      </p>
                    ) : tailscaleDevices.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground">
                        {t("hosts.tailscaleNoDevices")}
                      </p>
                    ) : (
                      <>
                        <select
                          className="w-full border border-border bg-background text-foreground text-xs px-2 py-1.5 focus:outline-none focus:border-accent-brand/50"
                          value={
                            tailscaleDevices.find((d) =>
                              d.addresses.includes(form.ip),
                            )?.id ?? ""
                          }
                          onChange={(e) => {
                            const device = tailscaleDevices.find(
                              (d) => d.id === e.target.value,
                            );
                            if (device) {
                              const tailscaleIp =
                                device.addresses.find((a) =>
                                  a.startsWith("100."),
                                ) ??
                                device.addresses[0] ??
                                "";
                              setField("ip", tailscaleIp);
                            }
                          }}
                        >
                          <option value="" disabled>
                            {t("hosts.tailscaleDeviceSelectPlaceholder")}
                          </option>
                          {tailscaleDevices.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.hostname} (
                              {d.addresses.find((a) => a.startsWith("100.")) ??
                                d.addresses[0] ??
                                ""}
                              )
                            </option>
                          ))}
                        </select>
                        <p className="text-[10px] text-muted-foreground">
                          {t("hosts.tailscaleDeviceAutoFill")}
                        </p>
                      </>
                    )}
                  </div>
                )}
                {authMethod === "warpgate" && (
                  <div className="flex flex-col gap-2 border-t border-border pt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {t("hosts.warpgateLabel")}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {t("hosts.warpgateDesc")}
                    </p>
                  </div>
                )}
                <SettingRow
                  label={t("hosts.forceKeyboardInteractiveLabel")}
                  description={t("hosts.forceKeyboardInteractiveShortDesc")}
                >
                  <FakeSwitch
                    checked={form.forceKeyboardInteractive}
                    onChange={(v) => setField("forceKeyboardInteractive", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.allowLegacyAlgorithmsLabel")}
                  badge={
                    form.allowLegacyAlgorithms ? t("hosts.insecure") : undefined
                  }
                  description={t("hosts.allowLegacyAlgorithmsDesc")}
                >
                  <FakeSwitch
                    checked={form.allowLegacyAlgorithms}
                    onChange={(v) => setField("allowLegacyAlgorithms", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.sudoPasswordAutoFillLabel")}
                  description={t("hosts.sudoPasswordAutoFillDesc")}
                >
                  <FakeSwitch
                    checked={form.sudoPasswordAutoFill}
                    onChange={(v) => setField("sudoPasswordAutoFill", v)}
                  />
                </SettingRow>
                {form.sudoPasswordAutoFill && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.sudoPasswordLabel")}
                    </label>
                    <PasswordInput
                      className="h-8 text-xs pr-8"
                      placeholder="••••••••"
                      value={form.sudoPassword}
                      onChange={(e) => setField("sudoPassword", e.target.value)}
                    />
                  </div>
                )}
              </div>
            </SectionCard>
          </>
        )}

        {activeTab === "terminal" && (
          <>
            <SectionCard
              title={t("hosts.terminalAppearance")}
              icon={<Palette className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.themePreview")}
                  </label>
                  <TerminalPreview
                    theme={form.theme}
                    fontSize={form.fontSize}
                    fontFamily={form.fontFamily}
                    cursorStyle={form.cursorStyle}
                    cursorBlink={form.cursorBlink}
                    letterSpacing={form.letterSpacing}
                    lineHeight={form.lineHeight}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.colorTheme")}
                    </label>
                    <select
                      value={form.theme}
                      onChange={(e) => {
                        setField("theme", e.target.value);
                        setPreviewTerminalTheme(e.target.value);
                      }}
                      className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    >
                      {Object.entries(TERMINAL_THEMES)
                        .filter(
                          ([key]) =>
                            key !== "termixDark" && key !== "termixLight",
                        )
                        .map(([key, theme]) => (
                          <option key={key} value={key}>
                            {theme.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.fontFamilyLabel")}
                    </label>
                    <select
                      value={form.fontFamily}
                      onChange={(e) => setField("fontFamily", e.target.value)}
                      className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring font-mono"
                    >
                      {TERMINAL_FONTS.map((f) => (
                        <option key={f.value} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {t("hosts.fontSizeLabel")}
                      </label>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {form.fontSize}px
                      </span>
                    </div>
                    <Slider
                      min={8}
                      max={24}
                      step={1}
                      value={[form.fontSize]}
                      onValueChange={([v]) => setField("fontSize", v)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.cursorStyleLabel")}
                    </label>
                    <select
                      value={form.cursorStyle}
                      onChange={(e) =>
                        setField(
                          "cursorStyle",
                          e.target.value as HostCursorStyle,
                        )
                      }
                      className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    >
                      {CURSOR_STYLES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {t("hosts.letterSpacingPx")}
                      </label>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {form.letterSpacing}px
                      </span>
                    </div>
                    <Slider
                      min={-2}
                      max={10}
                      step={0.5}
                      value={[form.letterSpacing]}
                      onValueChange={([v]) => setField("letterSpacing", v)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {t("hosts.lineHeightLabel")}
                      </label>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {form.lineHeight.toFixed(1)}
                      </span>
                    </div>
                    <Slider
                      min={1.0}
                      max={2.0}
                      step={0.1}
                      value={[form.lineHeight]}
                      onValueChange={([v]) => setField("lineHeight", v)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.bellStyleLabel")}
                    </label>
                    <select
                      value={form.bellStyle}
                      onChange={(e) =>
                        setField("bellStyle", e.target.value as HostBellStyle)
                      }
                      className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    >
                      {BELL_STYLES.map((b) => (
                        <option key={b.value} value={b.value}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.backspaceModeLabel")}
                    </label>
                    <select
                      value={form.backspaceMode}
                      onChange={(e) =>
                        setField(
                          "backspaceMode",
                          e.target.value as HostBackspaceMode,
                        )
                      }
                      className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="normal">Normal (DEL)</option>
                      <option value="control-h">Control-H (BS)</option>
                    </select>
                  </div>
                </div>
                <SettingRow
                  label={t("hosts.cursorBlinking")}
                  description={t("hosts.cursorBlinkingDesc")}
                >
                  <FakeSwitch
                    checked={form.cursorBlink}
                    onChange={(v) => setField("cursorBlink", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.rightClickSelectsWordLabel")}
                  description={t("hosts.rightClickSelectsWordShortDesc")}
                >
                  <FakeSwitch
                    checked={form.rightClickSelectsWord}
                    onChange={(v) => setField("rightClickSelectsWord", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.syntaxHighlightingLabel")}
                  description={t("hosts.syntaxHighlightingDesc")}
                >
                  <FakeSwitch
                    checked={form.syntaxHighlighting}
                    onChange={(v) => setField("syntaxHighlighting", v)}
                  />
                </SettingRow>
                {form.syntaxHighlighting && (
                  <div className="flex flex-col ml-4">
                    {(
                      [
                        [
                          "logLevels",
                          "syntaxCategoryLogLevels",
                          "syntaxCategoryLogLevelsDesc",
                        ],
                        [
                          "paths",
                          "syntaxCategoryPaths",
                          "syntaxCategoryPathsDesc",
                        ],
                        [
                          "timestamps",
                          "syntaxCategoryTimestamps",
                          "syntaxCategoryTimestampsDesc",
                        ],
                        [
                          "ipAddresses",
                          "syntaxCategoryIpAddresses",
                          "syntaxCategoryIpAddressesDesc",
                        ],
                        [
                          "urls",
                          "syntaxCategoryUrls",
                          "syntaxCategoryUrlsDesc",
                        ],
                        [
                          "numbers",
                          "syntaxCategoryNumbers",
                          "syntaxCategoryNumbersDesc",
                        ],
                      ] as const
                    ).map(([key, labelKey, descKey]) => (
                      <SettingRow
                        key={key}
                        label={t(`hosts.${labelKey}`)}
                        description={t(`hosts.${descKey}`)}
                      >
                        <FakeSwitch
                          checked={
                            form.syntaxHighlightingOptions?.[key] ?? true
                          }
                          onChange={(v) =>
                            setField("syntaxHighlightingOptions", {
                              ...form.syntaxHighlightingOptions,
                              [key]: v,
                            })
                          }
                        />
                      </SettingRow>
                    ))}
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.backgroundImageLabel")}
                  </label>
                  <p className="text-[10px] text-muted-foreground">
                    {t("hosts.backgroundImageDesc")}
                  </p>
                  <input
                    type="url"
                    value={form.backgroundImage}
                    onChange={(e) =>
                      setField("backgroundImage", e.target.value)
                    }
                    placeholder="https://example.com/image.jpg"
                    className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring font-mono"
                  />
                </div>
                {form.backgroundImage && (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {t("hosts.backgroundImageOpacityLabel")}
                      </label>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {Math.round(form.backgroundImageOpacity * 100)}%
                      </span>
                    </div>
                    <Slider
                      min={0.05}
                      max={1}
                      step={0.05}
                      value={[form.backgroundImageOpacity]}
                      onValueChange={([v]) =>
                        setField("backgroundImageOpacity", v)
                      }
                    />
                  </div>
                )}
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.behaviorAndAdvanced")}
              icon={<Zap className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.scrollbackBufferLabel")}
                    </label>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {form.scrollback.toLocaleString()}{" "}
                      {t("hosts.scrollbackMaxLines")}
                    </span>
                  </div>
                  <Slider
                    min={1000}
                    max={100000}
                    step={1000}
                    value={[form.scrollback]}
                    onValueChange={([v]) => setField("scrollback", v)}
                  />
                </div>
                <SettingRow
                  label={t("hosts.sshAgentForwardingLabel")}
                  description={t("hosts.sshAgentForwardingShortDesc")}
                >
                  <FakeSwitch
                    checked={form.agentForwarding}
                    onChange={(v) => setField("agentForwarding", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.useSSHTitleLabel")}
                  description={t("hosts.useSSHTitleDesc")}
                >
                  <FakeSwitch
                    checked={form.useSSHTitle}
                    onChange={(v) => setField("useSSHTitle", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.enableAutoMosh")}
                  description={t("hosts.enableAutoMoshDesc")}
                >
                  <FakeSwitch
                    checked={form.autoMosh}
                    onChange={(v) => setField("autoMosh", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.enableAutoTmux")}
                  description={
                    <>
                      {t("hosts.enableAutoTmuxDesc")}{" "}
                      <a
                        href="https://docs.termix.site/features/terminal/tmux"
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent-brand hover:underline"
                      >
                        {t("hosts.docsLink")}
                      </a>
                    </>
                  }
                >
                  <FakeSwitch
                    checked={form.autoTmux}
                    onChange={(v) => setField("autoTmux", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.enableSessionLogging")}
                  description={
                    <>
                      {t("hosts.enableSessionLoggingDesc")}{" "}
                      <a
                        href="https://docs.termix.site/features/terminal/session-recording"
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent-brand hover:underline"
                      >
                        {t("hosts.docsLink")}
                      </a>
                    </>
                  }
                >
                  <FakeSwitch
                    checked={form.enableSessionLogging}
                    onChange={(v) => setField("enableSessionLogging", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.enableCommandHistory")}
                  description={
                    <>
                      {t("hosts.enableCommandHistoryDesc")}{" "}
                      <a
                        href="https://docs.termix.site/features/terminal/command-history"
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent-brand hover:underline"
                      >
                        {t("hosts.docsLink")}
                      </a>
                    </>
                  }
                >
                  <FakeSwitch
                    checked={form.enableCommandHistory}
                    onChange={(v) => setField("enableCommandHistory", v)}
                  />
                </SettingRow>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.linkClickBehaviorLabel")}
                  </label>
                  <select
                    value={form.linkClickBehavior}
                    onChange={(e) =>
                      setField(
                        "linkClickBehavior",
                        e.target.value as "default" | "confirm" | "direct",
                      )
                    }
                    className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="default">
                      {t("hosts.linkClickBehaviorDefault")}
                    </option>
                    <option value="confirm">
                      {t("hosts.linkClickBehaviorConfirm")}
                    </option>
                    <option value="direct">
                      {t("hosts.linkClickBehaviorDirect")}
                    </option>
                  </select>
                  <p className="text-[10px] text-muted-foreground">
                    {t("hosts.linkClickBehaviorDesc")}
                  </p>
                </div>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.environmentVariablesLabel")}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-[10px] px-2 border-accent-brand/40 text-accent-brand"
                      onClick={() =>
                        setField("environmentVariables", [
                          ...form.environmentVariables,
                          { key: "", value: "" },
                        ])
                      }
                    >
                      <Plus className="size-3 mr-1" />{" "}
                      {t("hosts.addVariableBtn")}
                    </Button>
                  </div>
                  {form.environmentVariables.length === 0 && (
                    <p className="text-[10px] text-muted-foreground/50">
                      {t("hosts.noEnvVars")}
                    </p>
                  )}
                  <div className="flex flex-col gap-2">
                    {form.environmentVariables.map((ev, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input
                          className="h-7 text-xs flex-1"
                          placeholder="KEY"
                          value={ev.key}
                          onChange={(e) => {
                            const updated = [...form.environmentVariables];
                            updated[i] = { ...updated[i], key: e.target.value };
                            setField("environmentVariables", updated);
                          }}
                        />
                        <Input
                          className="h-7 text-xs flex-1"
                          placeholder="VALUE"
                          value={ev.value}
                          onChange={(e) => {
                            const updated = [...form.environmentVariables];
                            updated[i] = {
                              ...updated[i],
                              value: e.target.value,
                            };
                            setField("environmentVariables", updated);
                          }}
                        />
                        <button
                          className="text-destructive"
                          onClick={() =>
                            setField(
                              "environmentVariables",
                              form.environmentVariables.filter(
                                (_, idx) => idx !== i,
                              ),
                            )
                          }
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-border pt-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.fastScrollModifierLabel")}
                    </label>
                    <select
                      value={form.fastScrollModifier}
                      onChange={(e) =>
                        setField(
                          "fastScrollModifier",
                          e.target.value as HostFastScrollModifier,
                        )
                      }
                      className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    >
                      {FAST_SCROLL_MODIFIERS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {t("hosts.fastScrollSensitivityLabel")}
                      </label>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {form.fastScrollSensitivity}
                      </span>
                    </div>
                    <Slider
                      min={1}
                      max={10}
                      step={1}
                      value={[form.fastScrollSensitivity]}
                      onValueChange={([v]) =>
                        setField("fastScrollSensitivity", v)
                      }
                    />
                  </div>
                </div>
                {form.autoMosh && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.moshCommandLabel")}
                    </label>
                    <Input
                      placeholder="mosh"
                      value={form.moshCommand}
                      onChange={(e) => setField("moshCommand", e.target.value)}
                    />
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-border pt-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.startupSnippetLabel")}
                    </label>
                    <select
                      value={form.startupSnippetId ?? ""}
                      onChange={(e) =>
                        setField(
                          "startupSnippetId",
                          e.target.value ? Number(e.target.value) : null,
                        )
                      }
                      className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="">{t("hosts.none")}</option>
                      {snippets.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-border pt-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.keepaliveIntervalLabel")}
                    </label>
                    <Input
                      type="number"
                      value={form.keepaliveInterval}
                      onChange={(e) =>
                        setField("keepaliveInterval", Number(e.target.value))
                      }
                      className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.maxKeepaliveMisses")}
                    </label>
                    <Input
                      type="number"
                      value={form.keepaliveCountMax}
                      onChange={(e) =>
                        setField("keepaliveCountMax", Number(e.target.value))
                      }
                      className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                </div>
              </div>
            </SectionCard>
            {/* --- tmux-monitor --- */}
            <SectionCard
              title={t("tmuxMonitor.title")}
              icon={<Layers className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <SettingRow
                  label={t("hosts.enableTmuxMonitor")}
                  description={
                    <>
                      {t("hosts.enableTmuxMonitorDesc")}{" "}
                      <a
                        href="https://docs.termix.site/features/terminal/tmux"
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent-brand hover:underline"
                      >
                        {t("hosts.docsLink")}
                      </a>
                    </>
                  }
                >
                  <FakeSwitch
                    checked={form.enableTmuxMonitor}
                    onChange={(v) => setField("enableTmuxMonitor", v)}
                  />
                </SettingRow>
              </div>
            </SectionCard>
          </>
        )}

        {activeTab === "tunnels" && (
          <>
            <SectionCard
              title={t("hosts.tunnelSettings")}
              icon={<Network className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <SettingRow
                  label={t("hosts.enableTunneling")}
                  description={
                    <>
                      {t("hosts.enableTunnelingDesc")}{" "}
                      <a
                        href="https://docs.termix.site/features/networking/tunnels"
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent-brand hover:underline"
                      >
                        {t("hosts.docsLink")}
                      </a>
                    </>
                  }
                >
                  <FakeSwitch
                    checked={form.enableTunnel}
                    onChange={(v) => setField("enableTunnel", v)}
                  />
                </SettingRow>
                <div className="text-xs text-muted-foreground p-3 bg-muted/30 border border-border space-y-1">
                  <p>{t("hosts.tunnelRequirementsText")}</p>
                </div>
              </div>
            </SectionCard>
            <SectionCard
              title={t("hosts.serverTunnelsSection")}
              icon={<Network className="size-3.5" />}
              action={
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] px-2 border-accent-brand/40 text-accent-brand"
                  onClick={() =>
                    setField("serverTunnels", [
                      ...form.serverTunnels,
                      {
                        mode: "local" as const,
                        sourcePort: 8080,
                        endpointHost: "",
                        endpointPort: 80,
                        bindHost: "127.0.0.1",
                        maxRetries: 3,
                        retryInterval: 10,
                        autoStart: false,
                      },
                    ])
                  }
                >
                  <Plus className="size-3 mr-1" /> {t("hosts.addTunnelBtn")}
                </Button>
              }
            >
              <div className="flex flex-col gap-3 py-3">
                {form.serverTunnels.length === 0 && (
                  <p className="text-[10px] text-muted-foreground/50 px-1">
                    {t("hosts.noTunnelsConfigured")}
                  </p>
                )}
                {form.serverTunnels.map((tun, i) => {
                  const tunnelName = `${host?.id ?? "new"}-${i}-${tun.sourcePort}`;
                  const tunnelStatus = tunnelStatuses[tunnelName]?.status as
                    | string
                    | undefined;
                  const isConnected = tunnelStatus === "connected";
                  return (
                    <div
                      key={i}
                      className="flex flex-col gap-3 p-3 border border-border bg-muted/20 relative group"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-muted-foreground">
                            {t("hosts.tunnelLabel", { number: i + 1 })}
                          </span>
                          <div
                            className={`size-1.5 rounded-full shrink-0 ${
                              isConnected
                                ? "bg-accent-brand shadow-[0_0_4px_rgba(251,146,60,0.4)]"
                                : tunnelStatus === "error"
                                  ? "bg-red-400"
                                  : "bg-muted-foreground/25"
                            }`}
                            title={tunnelStatus ?? "not connected"}
                          />
                          {host && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={connectingTunnel === i}
                              className={`h-6 text-[10px] px-2 ${isConnected ? "border-destructive/40 text-destructive hover:bg-destructive/10" : "border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10"}`}
                              onClick={async () => {
                                setConnectingTunnel(i);
                                try {
                                  if (isConnected) {
                                    await disconnectTunnel(tunnelName);
                                    toast.success(
                                      t("hosts.tunnelDisconnected"),
                                    );
                                  } else {
                                    await connectTunnel({
                                      name: tunnelName,
                                      mode: tun.mode,
                                      sourceHostId: Number(host.id),
                                      tunnelIndex: i,
                                      hostName: host.name,
                                      sourceIP: host.ip,
                                      sourceSSHPort: host.sshPort ?? host.port,
                                      sourceUsername: form.username,
                                      sourcePassword:
                                        form.password || undefined,
                                      sourceAuthMethod: form.authType,
                                      sourceSSHKey: form.key || undefined,
                                      sourceKeyPassword:
                                        form.keyPassword || undefined,
                                      sourceCredentialId: form.credentialId
                                        ? Number(form.credentialId)
                                        : undefined,
                                      endpointIP: host.ip,
                                      endpointSSHPort:
                                        host.sshPort ?? host.port,
                                      endpointHost: tun.endpointHost ?? "",
                                      endpointUsername: form.username,
                                      endpointAuthMethod: form.authType,
                                      sourcePort: tun.sourcePort,
                                      endpointPort: tun.endpointPort ?? 0,
                                      bindHost: tun.bindHost ?? "127.0.0.1",
                                      maxRetries: tun.maxRetries ?? 3,
                                      retryInterval: tun.retryInterval ?? 10,
                                      autoStart: tun.autoStart ?? false,
                                      isPinned: false,
                                    });
                                    toast.success(t("hosts.tunnelConnecting"));
                                  }
                                } catch {
                                  toast.error(
                                    isConnected
                                      ? t("hosts.failedToDisconnectTunnel")
                                      : t("hosts.failedToConnectTunnel"),
                                  );
                                } finally {
                                  setConnectingTunnel(null);
                                }
                              }}
                            >
                              {connectingTunnel === i
                                ? "..."
                                : isConnected
                                  ? t("hosts.disconnectBtn")
                                  : t("hosts.connectBtn")}
                            </Button>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] px-2 text-destructive"
                          onClick={() =>
                            setField(
                              "serverTunnels",
                              form.serverTunnels.filter((_, idx) => idx !== i),
                            )
                          }
                        >
                          {t("common.delete")}
                        </Button>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold text-muted-foreground">
                          {t("hosts.tunnelType")}
                        </label>
                        <div className="flex gap-2">
                          {(["remote", "local", "dynamic"] as const).map(
                            (m) => (
                              <button
                                key={m}
                                onClick={() => {
                                  const updated = [...form.serverTunnels];
                                  updated[i] = { ...updated[i], mode: m };
                                  setField("serverTunnels", updated);
                                }}
                                className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border transition-colors ${tun.mode === m ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand" : "border-border text-muted-foreground hover:text-foreground"}`}
                              >
                                {m}
                              </button>
                            ),
                          )}
                        </div>
                        <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                          {tun.mode === "local"
                            ? t("hosts.tunnelModeLocalDesc")
                            : tun.mode === "remote"
                              ? t("hosts.tunnelModeRemoteDesc")
                              : t("hosts.tunnelModeDynamicDesc")}
                        </p>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {tun.mode !== "dynamic" && (
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold text-muted-foreground">
                              {t("hosts.endpointHost")}
                            </label>
                            <select
                              className="h-7 text-xs border border-border bg-background px-2 outline-none focus:ring-1 focus:ring-ring"
                              value={tun.endpointHost ?? ""}
                              onChange={(e) => {
                                const updated = [...form.serverTunnels];
                                updated[i] = {
                                  ...updated[i],
                                  endpointHost: e.target.value,
                                };
                                setField("serverTunnels", updated);
                              }}
                            >
                              <option value="">{t("hosts.sameHost")}</option>
                              {hosts
                                .filter((h) => h.enableSsh)
                                .map((h) => (
                                  <option key={h.id} value={h.ip}>
                                    {h.name || h.ip} ({h.ip})
                                  </option>
                                ))}
                            </select>
                          </div>
                        )}
                        {tun.mode !== "dynamic" && (
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold text-muted-foreground">
                              {t("hosts.endpointPort")}
                            </label>
                            <Input
                              className="h-7 text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              type="number"
                              value={tun.endpointPort}
                              onChange={(e) => {
                                const updated = [...form.serverTunnels];
                                updated[i] = {
                                  ...updated[i],
                                  endpointPort: Number(e.target.value),
                                };
                                setField("serverTunnels", updated);
                              }}
                            />
                          </div>
                        )}
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] font-bold text-muted-foreground">
                            {t("hosts.bindHost")}
                          </label>
                          <Input
                            className="h-7 text-xs"
                            placeholder="127.0.0.1"
                            value={tun.bindHost ?? ""}
                            onChange={(e) => {
                              const updated = [...form.serverTunnels];
                              updated[i] = {
                                ...updated[i],
                                bindHost: e.target.value,
                              };
                              setField("serverTunnels", updated);
                            }}
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] font-bold text-muted-foreground">
                            {t("hosts.sourcePort")}
                          </label>
                          <Input
                            className="h-7 text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            type="number"
                            value={tun.sourcePort}
                            onChange={(e) => {
                              const updated = [...form.serverTunnels];
                              updated[i] = {
                                ...updated[i],
                                sourcePort: Number(e.target.value),
                              };
                              setField("serverTunnels", updated);
                            }}
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] font-bold text-muted-foreground">
                            {t("hosts.maxRetries")}
                          </label>
                          <Input
                            className="h-7 text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            type="number"
                            value={tun.maxRetries}
                            onChange={(e) => {
                              const updated = [...form.serverTunnels];
                              updated[i] = {
                                ...updated[i],
                                maxRetries: Number(e.target.value),
                              };
                              setField("serverTunnels", updated);
                            }}
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] font-bold text-muted-foreground">
                            {t("hosts.retryIntervalS")}
                          </label>
                          <Input
                            className="h-7 text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            type="number"
                            value={tun.retryInterval}
                            onChange={(e) => {
                              const updated = [...form.serverTunnels];
                              updated[i] = {
                                ...updated[i],
                                retryInterval: Number(e.target.value),
                              };
                              setField("serverTunnels", updated);
                            }}
                          />
                        </div>
                      </div>
                      <SettingRow
                        label={t("hosts.autoStartLabel")}
                        description={t("hosts.autoStartDesc")}
                      >
                        <FakeSwitch
                          checked={tun.autoStart}
                          onChange={(v) => {
                            const updated = [...form.serverTunnels];
                            updated[i] = { ...updated[i], autoStart: v };
                            setField("serverTunnels", updated);
                          }}
                        />
                      </SettingRow>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          </>
        )}

        {activeTab === "docker" && (
          <HostDockerTab form={form} setField={setField} />
        )}

        {activeTab === "proxmox" && (
          <HostProxmoxTab form={form} setField={setField} />
        )}

        {activeTab === "files" && (
          <HostFilesTab form={form} setField={setField} />
        )}

        {activeTab === "host-metrics" && (
          <HostStatsTab form={form} setField={setField} snippets={snippets} />
        )}

        {activeTab === "rdp" && (
          <HostEditorRdpTab
            form={form}
            setField={setField}
            setGuacField={setGuacField}
            host={host}
            credentials={credentials}
          />
        )}

        {activeTab === "vnc" && (
          <HostEditorVncTab
            form={form}
            setField={setField}
            setGuacField={setGuacField}
            host={host}
            credentials={credentials}
          />
        )}

        {activeTab === "telnet" && (
          <HostEditorTelnetTab
            form={form}
            setField={setField}
            setGuacField={setGuacField}
            host={host}
            credentials={credentials}
          />
        )}
      </div>

      <div className="flex justify-end gap-3 mt-3 mb-6">
        <Button
          variant="ghost"
          onClick={() => {
            setPreviewTerminalTheme(null);
            onBack();
          }}
          disabled={saving}
        >
          {t("hosts.guac.cancelBtn")}
        </Button>
        <Button
          variant="outline"
          className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand px-8"
          onClick={handleSave}
          disabled={saving}
        >
          {saving
            ? t("hosts.guac.savingBtn")
            : host
              ? t("hosts.guac.updateHostBtn")
              : t("hosts.guac.addHostBtn")}
        </Button>
      </div>
    </div>
  );
}
