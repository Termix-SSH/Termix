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
  Activity,
  Copy,
  Globe,
  Monitor,
  Network,
  Palette,
  Plus,
  Server,
  Settings,
  Shield,
  Terminal,
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
} from "@/main-axios";
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
import { HostDockerTab, HostFilesTab } from "./HostEditorFeatureTabs";
import { HostEditorGeneralTab } from "./HostEditorGeneralTab";
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
  const [connectingTunnel, setConnectingTunnel] = useState<number | null>(null);

  useEffect(() => {
    getSnippets()
      .then((res) => setSnippets(mapSnippetResponse(res)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (activeTab !== "tunnels") return;
    const unsub = subscribeTunnelStatuses((s) => setTunnelStatuses(s));
    return unsub;
  }, [activeTab]);

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
    if (!value && activeTab === tabForProto[proto]) onTabChange("general");
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
                    {["password", "key", "credential", "none", "opkssh"].map(
                      (m) => (
                        <button
                          key={m}
                          onClick={() => {
                            setField("authType", m as HostAuthType);
                          }}
                          className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border transition-colors ${authMethod === m ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand" : "border-border text-muted-foreground hover:text-foreground"}`}
                        >
                          {m}
                        </button>
                      ),
                    )}
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
                      onChange={(e) => setField("username", e.target.value)}
                    />
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
                                accept=".pem,.key,.txt,.ppk"
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
                <SettingRow
                  label={t("hosts.forceKeyboardInteractiveLabel")}
                  description={t("hosts.forceKeyboardInteractiveShortDesc")}
                >
                  <FakeSwitch
                    checked={form.forceKeyboardInteractive}
                    onChange={(v) => setField("forceKeyboardInteractive", v)}
                  />
                </SettingRow>
              </div>
            </SectionCard>

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
                  description={t("hosts.enableAutoTmuxDesc")}
                >
                  <FakeSwitch
                    checked={form.autoTmux}
                    onChange={(v) => setField("autoTmux", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.sudoPasswordAutoFillLabel")}
                  description={t("hosts.sudoPasswordAutoFillShortDesc")}
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
                  description={t("hosts.enableTunnelingDesc")}
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
                              <option value="">
                                {t("hosts.selectAServer")}
                              </option>
                              <option value="127.0.0.1">
                                127.0.0.1 (localhost)
                              </option>
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

        {activeTab === "files" && (
          <HostFilesTab form={form} setField={setField} />
        )}

        {activeTab === "stats" && (
          <HostStatsTab form={form} setField={setField} snippets={snippets} />
        )}

        {activeTab === "rdp" && (
          <>
            <SectionCard
              title={t("hosts.guac.connection")}
              icon={<Globe className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.rdpPort")}
                  </label>
                  <Input
                    type="number"
                    placeholder="3389"
                    value={form.rdpPort}
                    onChange={(e) =>
                      setField("rdpPort", Number(e.target.value))
                    }
                    className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
              </div>
            </SectionCard>
            <SectionCard
              title={t("hosts.guac.authentication")}
              icon={<Shield className="size-3.5" />}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.username")}
                  </label>
                  <Input
                    placeholder="Administrator"
                    value={form.rdpUser}
                    onChange={(e) => setField("rdpUser", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.password")}
                  </label>
                  <PasswordInput
                    className="h-8 text-xs pr-8"
                    placeholder="••••••••"
                    value={form.rdpPassword}
                    onChange={(e) => setField("rdpPassword", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.domain")}
                  </label>
                  <Input
                    placeholder="WORKGROUP"
                    value={form.domain}
                    onChange={(e) => setField("domain", e.target.value)}
                  />
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.connectionSettings")}
              icon={<Shield className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.securityMode")}
                  </label>
                  <select
                    className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    value={form.security ?? "any"}
                    onChange={(e) => setField("security", e.target.value)}
                  >
                    <option value="any">Any</option>
                    <option value="nla">NLA</option>
                    <option value="nla-ext">NLA Extended</option>
                    <option value="tls">TLS</option>
                    <option value="vmconnect">VMConnect</option>
                    <option value="rdp">RDP</option>
                  </select>
                </div>
                <SettingRow
                  label={t("hosts.guac.ignoreCertificate")}
                  description={t("hosts.guac.ignoreCertificateDesc")}
                >
                  <FakeSwitch
                    checked={form.ignoreCert}
                    onChange={(v) => setField("ignoreCert", v)}
                  />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.displaySettings")}
              icon={<Monitor className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.colorDepth")}
                  </label>
                  <select
                    className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    value={form.guacamoleConfig["color-depth"] ?? "auto"}
                    onChange={(e) =>
                      setGuacField("color-depth", e.target.value)
                    }
                  >
                    <option value="auto">Auto</option>
                    <option value="8">8-bit</option>
                    <option value="16">16-bit</option>
                    <option value="24">24-bit</option>
                    <option value="32">32-bit</option>
                  </select>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.width")}
                    </label>
                    <Input
                      type="number"
                      placeholder="Auto"
                      value={form.guacamoleConfig["width"] ?? ""}
                      onChange={(e) => setGuacField("width", e.target.value)}
                      className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.height")}
                    </label>
                    <Input
                      type="number"
                      placeholder="Auto"
                      value={form.guacamoleConfig["height"] ?? ""}
                      onChange={(e) => setGuacField("height", e.target.value)}
                      className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.dpi")}
                  </label>
                  <Input
                    type="number"
                    placeholder="96"
                    value={form.guacamoleConfig["dpi"] ?? ""}
                    onChange={(e) => setGuacField("dpi", e.target.value)}
                    className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.resizeMethod")}
                  </label>
                  <select
                    className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    value={form.guacamoleConfig["resize-method"] ?? "auto"}
                    onChange={(e) =>
                      setGuacField("resize-method", e.target.value)
                    }
                  >
                    <option value="auto">Auto</option>
                    <option value="display-update">Display Update</option>
                    <option value="reconnect">Reconnect</option>
                  </select>
                </div>
                <SettingRow
                  label={t("hosts.guac.forceLossless")}
                  description={t("hosts.guac.forceLosslessDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["force-lossless"]}
                    onChange={(v) => setGuacField("force-lossless", v)}
                  />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.audioSettings")}
              icon={<Activity className="size-3.5" />}
            >
              <div className="flex flex-col gap-0 py-1">
                <SettingRow
                  label={t("hosts.guac.disableAudio")}
                  description={t("hosts.guac.disableAudioDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["disable-audio"]}
                    onChange={(v) => setGuacField("disable-audio", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.enableAudioInput")}
                  description={t("hosts.guac.enableAudioInputDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["enable-audio-input"]}
                    onChange={(v) => setGuacField("enable-audio-input", v)}
                  />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.rdpPerformance")}
              icon={<Zap className="size-3.5" />}
            >
              <div className="flex flex-col gap-0 py-1">
                <SettingRow
                  label={t("hosts.guac.wallpaper")}
                  description={t("hosts.guac.wallpaperDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["enable-wallpaper"]}
                    onChange={(v) => setGuacField("enable-wallpaper", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.theming")}
                  description={t("hosts.guac.themingDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["enable-theming"]}
                    onChange={(v) => setGuacField("enable-theming", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.fontSmoothing")}
                  description={t("hosts.guac.fontSmoothingDesc")}
                >
                  <FakeSwitch
                    checked={
                      form.guacamoleConfig["enable-font-smoothing"] !== false
                    }
                    onChange={(v) => setGuacField("enable-font-smoothing", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.fullWindowDrag")}
                  description={t("hosts.guac.fullWindowDragDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["enable-full-window-drag"]}
                    onChange={(v) => setGuacField("enable-full-window-drag", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.desktopComposition")}
                  description={t("hosts.guac.desktopCompositionDesc")}
                >
                  <FakeSwitch
                    checked={
                      !!form.guacamoleConfig["enable-desktop-composition"]
                    }
                    onChange={(v) =>
                      setGuacField("enable-desktop-composition", v)
                    }
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.menuAnimations")}
                  description={t("hosts.guac.menuAnimationsDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["enable-menu-animations"]}
                    onChange={(v) => setGuacField("enable-menu-animations", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.disableBitmapCaching")}
                  description={t("hosts.guac.disableBitmapCachingDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["disable-bitmap-caching"]}
                    onChange={(v) => setGuacField("disable-bitmap-caching", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.disableOffscreenCaching")}
                  description={t("hosts.guac.disableOffscreenCachingDesc")}
                >
                  <FakeSwitch
                    checked={
                      !!form.guacamoleConfig["disable-offscreen-caching"]
                    }
                    onChange={(v) =>
                      setGuacField("disable-offscreen-caching", v)
                    }
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.disableGlyphCaching")}
                  description={t("hosts.guac.disableGlyphCachingDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["disable-glyph-caching"]}
                    onChange={(v) => setGuacField("disable-glyph-caching", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.enableGfx")}
                  description={t("hosts.guac.enableGfxDesc")}
                >
                  <FakeSwitch
                    checked={form.guacamoleConfig["enable-gfx"] !== false}
                    onChange={(v) => setGuacField("enable-gfx", v)}
                  />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.deviceRedirection")}
              icon={<Settings className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <SettingRow
                  label={t("hosts.guac.enablePrinting")}
                  description={t("hosts.guac.enablePrintingDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["enable-printing"]}
                    onChange={(v) => setGuacField("enable-printing", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.enableDriveRedirection")}
                  description={t("hosts.guac.enableDriveRedirectionDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["enable-drive"]}
                    onChange={(v) => setGuacField("enable-drive", v)}
                  />
                </SettingRow>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-t border-border pt-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.driveName")}
                    </label>
                    <Input
                      placeholder="Termix Drive"
                      value={form.guacamoleConfig["drive-name"] ?? ""}
                      onChange={(e) =>
                        setGuacField("drive-name", e.target.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.drivePath")}
                    </label>
                    <Input
                      placeholder="/home/user/shared"
                      value={form.guacamoleConfig["drive-path"] ?? ""}
                      onChange={(e) =>
                        setGuacField("drive-path", e.target.value)
                      }
                    />
                  </div>
                </div>
                <SettingRow
                  label={t("hosts.guac.createDrivePath")}
                  description={t("hosts.guac.createDrivePathDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["create-drive-path"]}
                    onChange={(v) => setGuacField("create-drive-path", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.disableDownload")}
                  description={t("hosts.guac.disableDownloadDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["disable-download"]}
                    onChange={(v) => setGuacField("disable-download", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.disableUpload")}
                  description={t("hosts.guac.disableUploadDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["disable-upload"]}
                    onChange={(v) => setGuacField("disable-upload", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.enableTouch")}
                  description={t("hosts.guac.enableTouchDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["enable-touch"]}
                    onChange={(v) => setGuacField("enable-touch", v)}
                  />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.session")}
              icon={<Server className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.clientName")}
                  </label>
                  <Input
                    placeholder="Termix"
                    value={form.guacamoleConfig["client-name"] ?? ""}
                    onChange={(e) =>
                      setGuacField("client-name", e.target.value)
                    }
                  />
                </div>
                <SettingRow
                  label={t("hosts.guac.consoleSession")}
                  description={t("hosts.guac.consoleSessionDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["console"]}
                    onChange={(v) => setGuacField("console", v)}
                  />
                </SettingRow>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.initialProgram")}
                  </label>
                  <Input
                    placeholder="e.g. cmd.exe"
                    value={form.guacamoleConfig["initial-program"] ?? ""}
                    onChange={(e) =>
                      setGuacField("initial-program", e.target.value)
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.serverLayout")}
                  </label>
                  <select
                    className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    value={form.guacamoleConfig["server-layout"] ?? "auto"}
                    onChange={(e) =>
                      setGuacField("server-layout", e.target.value)
                    }
                  >
                    <option value="auto">Auto</option>
                    <option>en-us-qwerty</option>
                    <option>en-gb-qwerty</option>
                    <option>de-de-qwertz</option>
                    <option>fr-fr-azerty</option>
                    <option>it-it-qwerty</option>
                    <option>sv-se-qwerty</option>
                    <option>ja-jp-qwerty</option>
                    <option>pt-br-qwerty</option>
                    <option>es-es-qwerty</option>
                    <option>failsafe</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.timezone")}
                  </label>
                  <Input
                    placeholder="e.g. America/New_York"
                    value={form.guacamoleConfig["timezone"] ?? ""}
                    onChange={(e) => setGuacField("timezone", e.target.value)}
                  />
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.gateway")}
              icon={<Network className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.gatewayHostname")}
                    </label>
                    <Input
                      placeholder="gateway.example.com"
                      value={form.guacamoleConfig["gateway-hostname"] ?? ""}
                      onChange={(e) =>
                        setGuacField("gateway-hostname", e.target.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.gatewayPort")}
                    </label>
                    <Input
                      type="number"
                      placeholder="443"
                      value={form.guacamoleConfig["gateway-port"] ?? ""}
                      onChange={(e) =>
                        setGuacField("gateway-port", e.target.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.gatewayUsername")}
                    </label>
                    <Input
                      placeholder="user"
                      value={form.guacamoleConfig["gateway-username"] ?? ""}
                      onChange={(e) =>
                        setGuacField("gateway-username", e.target.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.gatewayPassword")}
                    </label>
                    <PasswordInput
                      className="h-8 text-xs pr-8"
                      placeholder="••••••••"
                      value={form.guacamoleConfig["gateway-password"] ?? ""}
                      onChange={(e) =>
                        setGuacField("gateway-password", e.target.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 col-span-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.gatewayDomain")}
                    </label>
                    <Input
                      placeholder="DOMAIN"
                      value={form.guacamoleConfig["gateway-domain"] ?? ""}
                      onChange={(e) =>
                        setGuacField("gateway-domain", e.target.value)
                      }
                    />
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.remoteApp")}
              icon={<Monitor className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.remoteAppProgram")}
                  </label>
                  <Input
                    placeholder="||MyApp"
                    value={form.guacamoleConfig["remote-app"] ?? ""}
                    onChange={(e) => setGuacField("remote-app", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.workingDirectory")}
                  </label>
                  <Input
                    placeholder="C:\Apps\MyApp"
                    value={form.guacamoleConfig["remote-app-dir"] ?? ""}
                    onChange={(e) =>
                      setGuacField("remote-app-dir", e.target.value)
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.arguments")}
                  </label>
                  <Input
                    placeholder="--flag value"
                    value={form.guacamoleConfig["remote-app-args"] ?? ""}
                    onChange={(e) =>
                      setGuacField("remote-app-args", e.target.value)
                    }
                  />
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.clipboard")}
              icon={<Copy className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.normalizeLineEndings")}
                  </label>
                  <select
                    className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    value={
                      form.guacamoleConfig["normalize-clipboard"] ?? "auto"
                    }
                    onChange={(e) =>
                      setGuacField("normalize-clipboard", e.target.value)
                    }
                  >
                    <option value="auto">Auto</option>
                    <option value="preserve">Preserve</option>
                    <option value="unix">Unix (LF)</option>
                    <option value="windows">Windows (CRLF)</option>
                  </select>
                </div>
                <SettingRow
                  label={t("hosts.guac.disableCopy")}
                  description={t("hosts.guac.disableCopyDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["disable-copy"]}
                    onChange={(v) => setGuacField("disable-copy", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.disablePaste")}
                  description={t("hosts.guac.disablePasteDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["disable-paste"]}
                    onChange={(v) => setGuacField("disable-paste", v)}
                  />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.sessionRecording")}
              icon={<Activity className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.recordingPath")}
                  </label>
                  <Input
                    placeholder="/var/lib/termix/recordings"
                    value={form.guacamoleConfig["recording-path"] ?? ""}
                    onChange={(e) =>
                      setGuacField("recording-path", e.target.value)
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.recordingName")}
                  </label>
                  <Input
                    placeholder="${GUAC_USERNAME}-${GUAC_DATE}-${GUAC_TIME}"
                    value={form.guacamoleConfig["recording-name"] ?? ""}
                    onChange={(e) =>
                      setGuacField("recording-name", e.target.value)
                    }
                  />
                </div>
                <SettingRow
                  label={t("hosts.guac.createPathIfMissing")}
                  description={t("hosts.guac.createPathIfMissingDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["create-recording-path"]}
                    onChange={(v) => setGuacField("create-recording-path", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.excludeOutput")}
                  description={t("hosts.guac.excludeOutputDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["recording-exclude-output"]}
                    onChange={(v) =>
                      setGuacField("recording-exclude-output", v)
                    }
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.excludeMouse")}
                  description={t("hosts.guac.excludeMouseDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["recording-exclude-mouse"]}
                    onChange={(v) => setGuacField("recording-exclude-mouse", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.includeKeystrokes")}
                  description={t("hosts.guac.includeKeystrokesDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["recording-include-keys"]}
                    onChange={(v) => setGuacField("recording-include-keys", v)}
                  />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.wakeOnLan")}
              icon={<Zap className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <SettingRow
                  label={t("hosts.guac.sendWolPacket")}
                  description={t("hosts.guac.sendWolPacketDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["wol-send-packet"]}
                    onChange={(v) => setGuacField("wol-send-packet", v)}
                  />
                </SettingRow>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.macAddress")}
                    </label>
                    <Input
                      placeholder="AA:BB:CC:DD:EE:FF"
                      value={
                        form.guacamoleConfig["wol-mac-addr"] ??
                        host?.macAddress ??
                        ""
                      }
                      onChange={(e) =>
                        setGuacField("wol-mac-addr", e.target.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.broadcastAddress")}
                    </label>
                    <Input
                      placeholder="255.255.255.255"
                      value={form.guacamoleConfig["wol-broadcast-addr"] ?? ""}
                      onChange={(e) =>
                        setGuacField("wol-broadcast-addr", e.target.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.udpPort")}
                    </label>
                    <Input
                      type="number"
                      placeholder="9"
                      value={form.guacamoleConfig["wol-udp-port"] ?? ""}
                      onChange={(e) =>
                        setGuacField("wol-udp-port", e.target.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.waitTimeS")}
                    </label>
                    <Input
                      type="number"
                      placeholder="0"
                      value={form.guacamoleConfig["wol-wait-time"] ?? ""}
                      onChange={(e) =>
                        setGuacField("wol-wait-time", e.target.value)
                      }
                    />
                  </div>
                </div>
              </div>
            </SectionCard>
          </>
        )}

        {activeTab === "vnc" && (
          <>
            <SectionCard
              title={t("hosts.guac.connection")}
              icon={<Globe className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.vncPort")}
                  </label>
                  <Input
                    type="number"
                    placeholder="5900"
                    value={form.vncPort}
                    onChange={(e) =>
                      setField("vncPort", Number(e.target.value))
                    }
                    className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
              </div>
            </SectionCard>
            <SectionCard
              title={t("hosts.guac.authentication")}
              icon={<Shield className="size-3.5" />}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.vncPassword")}
                  </label>
                  <PasswordInput
                    className="h-8 text-xs pr-8"
                    placeholder="••••••••"
                    value={form.vncPassword}
                    onChange={(e) => setField("vncPassword", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.vncUsernameOptional")}
                  </label>
                  <Input
                    placeholder={t("hosts.guac.vncLeaveBlank")}
                    value={form.vncUser}
                    onChange={(e) => setField("vncUser", e.target.value)}
                  />
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.displaySettings")}
              icon={<Monitor className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.colorDepth")}
                  </label>
                  <select
                    className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    value={form.guacamoleConfig["color-depth"] ?? "auto"}
                    onChange={(e) =>
                      setGuacField("color-depth", e.target.value)
                    }
                  >
                    <option value="auto">Auto</option>
                    <option value="8">8-bit</option>
                    <option value="16">16-bit</option>
                    <option value="24">24-bit</option>
                    <option value="32">32-bit</option>
                  </select>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.width")}
                    </label>
                    <Input
                      type="number"
                      placeholder="Auto"
                      value={form.guacamoleConfig["width"] ?? ""}
                      onChange={(e) => setGuacField("width", e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.height")}
                    </label>
                    <Input
                      type="number"
                      placeholder="Auto"
                      value={form.guacamoleConfig["height"] ?? ""}
                      onChange={(e) => setGuacField("height", e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.resizeMethod")}
                  </label>
                  <select
                    className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    value={form.guacamoleConfig["resize-method"] ?? "auto"}
                    onChange={(e) =>
                      setGuacField("resize-method", e.target.value)
                    }
                  >
                    <option value="auto">Auto</option>
                    <option value="display-update">Display Update</option>
                    <option value="reconnect">Reconnect</option>
                  </select>
                </div>
                <SettingRow
                  label={t("hosts.guac.forceLossless")}
                  description={t("hosts.guac.forceLosslessDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["force-lossless"]}
                    onChange={(v) => setGuacField("force-lossless", v)}
                  />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.audioSettings")}
              icon={<Activity className="size-3.5" />}
            >
              <div className="flex flex-col gap-0 py-1">
                <SettingRow
                  label={t("hosts.guac.disableAudio")}
                  description={t("hosts.guac.disableAudioDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["disable-audio"]}
                    onChange={(v) => setGuacField("disable-audio", v)}
                  />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.vncSettings")}
              icon={<Settings className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.cursorMode")}
                  </label>
                  <select
                    className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    value={form.guacamoleConfig["cursor"] ?? "auto"}
                    onChange={(e) => setGuacField("cursor", e.target.value)}
                  >
                    <option value="auto">Auto</option>
                    <option value="local">Local</option>
                    <option value="remote">Remote</option>
                  </select>
                </div>
                <SettingRow
                  label={t("hosts.guac.swapRedBlue")}
                  description={t("hosts.guac.swapRedBlueDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["swap-red-blue"]}
                    onChange={(v) => setGuacField("swap-red-blue", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.readOnly")}
                  description={t("hosts.guac.readOnlyDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["read-only"]}
                    onChange={(v) => setGuacField("read-only", v)}
                  />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.clipboard")}
              icon={<Copy className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.normalizeLineEndings")}
                  </label>
                  <select
                    className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    value={
                      form.guacamoleConfig["normalize-clipboard"] ?? "auto"
                    }
                    onChange={(e) =>
                      setGuacField("normalize-clipboard", e.target.value)
                    }
                  >
                    <option value="auto">Auto</option>
                    <option value="preserve">Preserve</option>
                    <option value="unix">Unix (LF)</option>
                    <option value="windows">Windows (CRLF)</option>
                  </select>
                </div>
                <SettingRow
                  label={t("hosts.guac.disableCopy")}
                  description={t("hosts.guac.disableCopyDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["disable-copy"]}
                    onChange={(v) => setGuacField("disable-copy", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.disablePaste")}
                  description={t("hosts.guac.disablePasteDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["disable-paste"]}
                    onChange={(v) => setGuacField("disable-paste", v)}
                  />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.sessionRecording")}
              icon={<Activity className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.recordingPath")}
                  </label>
                  <Input
                    placeholder="/var/lib/termix/recordings"
                    value={form.guacamoleConfig["recording-path"] ?? ""}
                    onChange={(e) =>
                      setGuacField("recording-path", e.target.value)
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.recordingName")}
                  </label>
                  <Input
                    placeholder="${GUAC_USERNAME}-${GUAC_DATE}-${GUAC_TIME}"
                    value={form.guacamoleConfig["recording-name"] ?? ""}
                    onChange={(e) =>
                      setGuacField("recording-name", e.target.value)
                    }
                  />
                </div>
                <SettingRow
                  label={t("hosts.guac.createPathIfMissing")}
                  description={t("hosts.guac.createPathIfMissingDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["create-recording-path"]}
                    onChange={(v) => setGuacField("create-recording-path", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.excludeOutput")}
                  description={t("hosts.guac.excludeOutputDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["recording-exclude-output"]}
                    onChange={(v) =>
                      setGuacField("recording-exclude-output", v)
                    }
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.excludeMouse")}
                  description={t("hosts.guac.excludeMouseDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["recording-exclude-mouse"]}
                    onChange={(v) => setGuacField("recording-exclude-mouse", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.includeKeystrokes")}
                  description={t("hosts.guac.includeKeystrokesDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["recording-include-keys"]}
                    onChange={(v) => setGuacField("recording-include-keys", v)}
                  />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.wakeOnLan")}
              icon={<Zap className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <SettingRow
                  label={t("hosts.guac.sendWolPacket")}
                  description={t("hosts.guac.sendWolPacketDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["wol-send-packet"]}
                    onChange={(v) => setGuacField("wol-send-packet", v)}
                  />
                </SettingRow>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.macAddress")}
                    </label>
                    <Input
                      placeholder="AA:BB:CC:DD:EE:FF"
                      value={
                        form.guacamoleConfig["wol-mac-addr"] ??
                        host?.macAddress ??
                        ""
                      }
                      onChange={(e) =>
                        setGuacField("wol-mac-addr", e.target.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.broadcastAddress")}
                    </label>
                    <Input
                      placeholder="255.255.255.255"
                      value={form.guacamoleConfig["wol-broadcast-addr"] ?? ""}
                      onChange={(e) =>
                        setGuacField("wol-broadcast-addr", e.target.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.udpPort")}
                    </label>
                    <Input
                      type="number"
                      placeholder="9"
                      value={form.guacamoleConfig["wol-udp-port"] ?? ""}
                      onChange={(e) =>
                        setGuacField("wol-udp-port", e.target.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.waitTimeS")}
                    </label>
                    <Input
                      type="number"
                      placeholder="0"
                      value={form.guacamoleConfig["wol-wait-time"] ?? ""}
                      onChange={(e) =>
                        setGuacField("wol-wait-time", e.target.value)
                      }
                    />
                  </div>
                </div>
              </div>
            </SectionCard>
          </>
        )}

        {activeTab === "telnet" && (
          <>
            <SectionCard
              title={t("hosts.guac.connection")}
              icon={<Globe className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.telnetPort")}
                  </label>
                  <Input
                    type="number"
                    placeholder="23"
                    value={form.telnetPort}
                    onChange={(e) =>
                      setField("telnetPort", Number(e.target.value))
                    }
                    className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
              </div>
            </SectionCard>
            <SectionCard
              title={t("hosts.guac.authentication")}
              icon={<Shield className="size-3.5" />}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.username")}
                  </label>
                  <Input
                    placeholder="admin"
                    value={form.telnetUser}
                    onChange={(e) => setField("telnetUser", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.password")}
                  </label>
                  <PasswordInput
                    className="h-8 text-xs pr-8"
                    placeholder="••••••••"
                    value={form.telnetPassword}
                    onChange={(e) => setField("telnetPassword", e.target.value)}
                  />
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.displaySettings")}
              icon={<Monitor className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.width")}
                    </label>
                    <Input
                      type="number"
                      placeholder="Auto"
                      value={form.guacamoleConfig["width"] ?? ""}
                      onChange={(e) => setGuacField("width", e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.height")}
                    </label>
                    <Input
                      type="number"
                      placeholder="Auto"
                      value={form.guacamoleConfig["height"] ?? ""}
                      onChange={(e) => setGuacField("height", e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.terminalSettings")}
              icon={<Terminal className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.terminalType")}
                  </label>
                  <select
                    className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    value={form.guacamoleConfig["terminal-type"] ?? "auto"}
                    onChange={(e) =>
                      setGuacField("terminal-type", e.target.value)
                    }
                  >
                    <option value="auto">Auto</option>
                    <option value="xterm">xterm</option>
                    <option value="xterm-256color">xterm-256color</option>
                    <option value="vt100">VT100</option>
                    <option value="vt220">VT220</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.fontName")}
                  </label>
                  <Input
                    placeholder="monospace"
                    value={form.guacamoleConfig["font-name"] ?? ""}
                    onChange={(e) => setGuacField("font-name", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.fontSize")}
                  </label>
                  <Input
                    type="number"
                    value={form.guacamoleConfig["font-size"] ?? 12}
                    onChange={(e) =>
                      setGuacField("font-size", Number(e.target.value))
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.colorScheme")}
                  </label>
                  <select
                    className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    value={form.guacamoleConfig["color-scheme"] ?? "auto"}
                    onChange={(e) =>
                      setGuacField("color-scheme", e.target.value)
                    }
                  >
                    <option value="auto">Auto</option>
                    <option value="black-white">Black on White</option>
                    <option value="white-black">White on Black</option>
                    <option value="gray-black">Gray on Black</option>
                    <option value="green-black">Green on Black</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.backspaceKey")}
                  </label>
                  <select
                    className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    value={form.guacamoleConfig["backspace"] ?? "auto"}
                    onChange={(e) => setGuacField("backspace", e.target.value)}
                  >
                    <option value="auto">Auto</option>
                    <option value="127">DEL (127)</option>
                    <option value="8">BS (8)</option>
                  </select>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.sessionRecording")}
              icon={<Activity className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.recordingPath")}
                  </label>
                  <Input
                    placeholder="/var/lib/termix/recordings"
                    value={form.guacamoleConfig["recording-path"] ?? ""}
                    onChange={(e) =>
                      setGuacField("recording-path", e.target.value)
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.recordingName")}
                  </label>
                  <Input
                    placeholder="${GUAC_USERNAME}-${GUAC_DATE}-${GUAC_TIME}"
                    value={form.guacamoleConfig["recording-name"] ?? ""}
                    onChange={(e) =>
                      setGuacField("recording-name", e.target.value)
                    }
                  />
                </div>
                <SettingRow
                  label={t("hosts.guac.createPathIfMissing")}
                  description={t("hosts.guac.createPathIfMissingDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["create-recording-path"]}
                    onChange={(v) => setGuacField("create-recording-path", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.excludeOutput")}
                  description={t("hosts.guac.excludeOutputDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["recording-exclude-output"]}
                    onChange={(v) =>
                      setGuacField("recording-exclude-output", v)
                    }
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.includeKeystrokes")}
                  description={t("hosts.guac.includeKeystrokesDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["recording-include-keys"]}
                    onChange={(v) => setGuacField("recording-include-keys", v)}
                  />
                </SettingRow>
              </div>
            </SectionCard>
          </>
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
