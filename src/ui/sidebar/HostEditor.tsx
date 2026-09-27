import { Select2 } from "@/components/select2";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { PasswordInput } from "@/components/password-input";
import { Globe, Pencil, Plus, Shield, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { listSnippets } from "@/lib/snippet-provider";
import { SectionCard, SettingRow, FakeSwitch } from "@/components/section-card";
import {
  createSSHHost,
  updateSSHHost,
  getUserInfo,
  getHostPassword,
  adminCreateUserHost,
  adminUpdateUserHost,
  adminGetHostPassword,
  createCredential,
  adminCreateUserCredential,
} from "@/main-axios";
import { getHostDefaults } from "@/api/settings-api";
import type { Host } from "@/types/ui-types";
import type { SSHHost } from "@/types";
import { useTabsSafe } from "@/shell/TabContext";
import { updatePluginHostSettings } from "@/api/plugins-api";
import {
  applyHostDraft,
  buildHostEditorPayload,
  createHostEditorForm,
  mapSnippetResponse,
  omitOwnerSshAuthFromSharedEdit,
  terminalAppearanceKeys,
  type HostAuthType,
  type HostProtocols,
} from "./HostEditorData";
import { useConnectionDefaults } from "@/contexts/ConnectionDefaultsContext";
import { HostEditorGeneralTab } from "./HostEditorGeneralTab";
import { withProtocolSettings } from "./host-protocols";
import {
  usePluginHostSections,
  withNewHostDefaults,
} from "@/settings/HostPluginSections";
import { canEditHost } from "./host-permissions";
import {
  getHostEditorSection,
  isSshGroupTab,
  makeHostTabs,
} from "./HostManagerTabs";
import { useSshAuthEditors } from "@/plugin-host/auth-registry";
import { useSshAuthProviders } from "@/hooks/useSshAuthProviders";
import { SshAuthProviderFields } from "./SshAuthProviderFields";
import type { PluginSettingsField } from "@termix/plugin-sdk/manifest";
import type { HostDraft } from "@termix/plugin-sdk/frontend";
import { PluginComponent } from "@/plugin-host/component-registry";
import {
  toCredentialOption,
  type CredentialOption,
} from "./quick-created-credential";

export function HostEditor({
  host,
  draft,
  activeTab,
  onBack,
  onSave,
  protocols,
  onProtocolChange,
  onDirtyChange,
  onTabChange,
  hosts,
  credentials,
  adminTargetUserId,
  simpleMode = false,
  onEditCredential,
}: {
  host: Host | null;
  /** Fields a plugin filled in for a new host. */
  draft?: HostDraft;
  activeTab: string;
  /** Collapses the General tab to the fields needed to reach a host. */
  simpleMode?: boolean;
  onBack: () => void;
  onSave: (saved: SSHHost) => void;
  protocols: HostProtocols;
  onProtocolChange: (p: Partial<typeof protocols>) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onTabChange: (tab: string) => void;
  hosts: Host[];
  credentials: { id: string; name: string; username: string }[];
  // When set, the editor works on another user's host through the admin
  // impersonation endpoints instead of the signed-in user's own data.
  adminTargetUserId?: string;
  // Opens the currently-selected credential for editing (from within the
  // host editor), so the user can tweak/rotate it without leaving the flow.
  onEditCredential?: (credentialId: string) => void;
}) {
  const { t } = useTranslation();
  const hostSettingPlugins = usePluginHostSections();
  const { setPreviewTerminalTheme } = useTabsSafe();
  const connectionDefaults = useConnectionDefaults();
  const [form, setForm] = useState(() =>
    applyHostDraft(
      createHostEditorForm(host, undefined, connectionDefaults),
      host ? undefined : draft,
    ),
  );
  const setField = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    onDirtyChange?.(true);
    setForm((p) => ({
      ...p,
      [k]: v,
      ...(terminalAppearanceKeys.includes(
        k as (typeof terminalAppearanceKeys)[number],
      )
        ? { inheritTerminalAppearance: false }
        : {}),
    }));
  };

  /** Sets several fields at once, from the latest form. For plugin sections. */
  const updateForm = (
    patch: (current: Record<string, unknown>) => Record<string, unknown>,
  ) => {
    onDirtyChange?.(true);
    setForm((current) => ({
      ...current,
      ...patch(current as unknown as Record<string, unknown>),
    }));
  };

  const [saving, setSaving] = useState(false);
  const [snippets, setSnippets] = useState<{ id: number; name: string }[]>([]);
  const [isOidcUser, setIsOidcUser] = useState(false);
  const [showSecretSources, setShowSecretSources] = useState(false);
  const [quickCredentialName, setQuickCredentialName] = useState("");
  const [creatingQuickCredential, setCreatingQuickCredential] = useState(false);
  const [showQuickCredentialDialog, setShowQuickCredentialDialog] =
    useState(false);
  const [quickCreatedCredential, setQuickCreatedCredential] =
    useState<CredentialOption | null>(null);
  useEffect(() => {
    getUserInfo()
      .then((info) => setIsOidcUser(info.is_oidc))
      .catch(() => {});
  }, []);

  useEffect(() => {
    listSnippets(
      adminTargetUserId ? { targetUserId: adminTargetUserId } : undefined,
    )
      .then((res) => setSnippets(mapSnippetResponse(res)))
      .catch(() => {});
  }, [adminTargetUserId]);

  useEffect(() => {
    if (!connectionDefaults.ready) return;
    if (host) {
      setForm(createHostEditorForm(host, undefined, connectionDefaults));
      return;
    }
    getHostDefaults()
      .then((d) => setForm(createHostEditorForm(null, d, connectionDefaults)))
      .catch(() => {});
  }, [host, connectionDefaults]);

  useEffect(() => {
    if (!host?.id || form.vncAuthType !== "direct" || form.vncPassword) return;

    let cancelled = false;
    const loadVncPassword = adminTargetUserId
      ? adminGetHostPassword(adminTargetUserId, Number(host.id), "vncPassword")
      : getHostPassword(Number(host.id), "vncPassword");
    loadVncPassword.then((password) => {
      if (cancelled || !password) return;
      setForm((prev) =>
        prev.vncPassword ? prev : { ...prev, vncPassword: password },
      );
    });

    return () => {
      cancelled = true;
    };
  }, [form.vncAuthType, form.vncPassword, host?.id, adminTargetUserId]);

  /**
   * Writes each plugin's host-scope values through its own route.
   *
   * One request per plugin rather than one per field, and a plugin that
   * rejects a value is reported without failing the host save that already
   * succeeded.
   */
  const savePluginHostSettings = async (
    hostId: number,
    values: Record<string, Record<string, unknown>> | undefined,
  ) => {
    if (!values || !Number.isInteger(hostId)) return;

    for (const [pluginId, fields] of Object.entries(values)) {
      if (!fields || Object.keys(fields).length === 0) continue;
      try {
        await updatePluginHostSettings(pluginId, hostId, fields);
      } catch {
        toast.error(t("settings.pluginSettingsSaveFailed"));
      }
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const fullData = buildHostEditorPayload(form, protocols);
      const data = lockAuthReferences
        ? omitOwnerSshAuthFromSharedEdit(fullData)
        : fullData;
      let saved: SSHHost;
      if (adminTargetUserId) {
        saved = host
          ? await adminUpdateUserHost(adminTargetUserId, Number(host.id), data)
          : await adminCreateUserHost(adminTargetUserId, data);
      } else {
        saved = host
          ? await updateSSHHost(Number(host.id), data)
          : await createSSHHost(data);
      }
      // After the host: a new one has no id to scope settings to until it
      // exists. A failure here must not claim the host itself failed to save.
      const pluginValues = withProtocolSettings(form.pluginSettings, protocols);
      await savePluginHostSettings(
        Number(saved.id),
        host
          ? pluginValues
          : withNewHostDefaults(pluginValues ?? {}, hostSettingPlugins),
      );

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
  // Auth types a plugin adds (Tailscale) bring their own editor and label.
  const sshAuthEditors = useSshAuthEditors();
  const activeAuthEditor = sshAuthEditors.find(
    (editor) => editor.id === authMethod,
  );
  const ActiveAuthEditor = activeAuthEditor?.component;
  const sshAuthProviders = useSshAuthProviders();
  const authEditorLabel = (method: string) => {
    const option = sshAuthProviders.find(method);
    if (option?.editorTitleKey) return t(option.editorTitleKey);
    if (option?.labelKey) return t(option.labelKey, { defaultValue: method });
    return method;
  };
  const selectableAuthMethods = sshAuthProviders.providers
    .filter((option) => option.available)
    .map((option) => option.type);
  const currentAuthOption = sshAuthProviders.find(authMethod);
  // The host uses a type nothing here provides (its plugin is off).
  const missingAuthNotice =
    sshAuthProviders.loaded && authMethod && !currentAuthOption?.available
      ? currentAuthOption?.missingPlugin
        ? t("hosts.authTypeNeedsPlugin", {
            type: authMethod,
            plugin: currentAuthOption.missingPlugin.name,
          })
        : t("hosts.authTypeUnknown", { type: authMethod })
      : null;
  const availableCredentials =
    quickCreatedCredential &&
    !credentials.some(
      (credential) => credential.id === quickCreatedCredential.id,
    )
      ? [...credentials, quickCreatedCredential]
      : credentials;
  const selectedCredential = availableCredentials.find(
    (c) => String(c.id) === String(form.credentialId),
  );

  const canQuickCreateCredential =
    (authMethod === "password" || authMethod === "key") &&
    (authMethod === "password"
      ? !!form.password || !!host?.hasPassword
      : (!!form.key && form.key !== "existing_key") || !!host?.hasKey);

  const openQuickCredentialDialog = () => {
    setQuickCredentialName(form.name || form.username || "");
    setShowQuickCredentialDialog(true);
  };

  const handleQuickCreateCredential = async () => {
    if (!quickCredentialName.trim()) {
      toast.error(t("hosts.credentialNameRequired"));
      return;
    }
    setCreatingQuickCredential(true);
    try {
      const fetchField = (field: "password" | "key" | "keyPassword") =>
        adminTargetUserId
          ? adminGetHostPassword(adminTargetUserId, Number(host?.id), field)
          : getHostPassword(Number(host?.id), field);

      const data: Record<string, unknown> = {
        name: quickCredentialName,
        username: form.username || null,
        folder: form.folder || null,
      };

      if (authMethod === "password") {
        data.authType = "password";
        data.password =
          form.password && form.password !== "existing_password"
            ? form.password
            : host?.hasPassword
              ? await fetchField("password")
              : null;
      } else {
        const key =
          form.key && form.key !== "existing_key"
            ? form.key
            : host?.hasKey
              ? await fetchField("key")
              : null;
        const keyPassword =
          form.keyPassword && form.keyPassword !== "existing_key_password"
            ? form.keyPassword
            : host?.hasKeyPassword
              ? await fetchField("keyPassword")
              : null;
        data.authType = "key";
        data.key = key;
        data.keyPassword = keyPassword;
        data.password =
          form.password && form.password !== "existing_password"
            ? form.password
            : null;
      }

      const created = adminTargetUserId
        ? await adminCreateUserCredential(adminTargetUserId, data)
        : await createCredential(data);
      const credential = toCredentialOption(created);
      if (!credential) throw new Error(t("hosts.failedToSaveCredential"));

      setQuickCreatedCredential(credential);
      setForm((current) => ({
        ...current,
        authType: "credential",
        credentialId: credential.id,
      }));
      toast.success(t("hosts.credentialCreated"));
      if (!adminTargetUserId) {
        window.dispatchEvent(new CustomEvent("termix:credentials-changed"));
      }
      setShowQuickCredentialDialog(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : null;
      toast.error(msg || t("hosts.failedToSaveCredential"));
    } finally {
      setCreatingQuickCredential(false);
    }
  };

  // Shared hosts: view-level recipients see a read-only editor; edit-level
  // recipients may change the host but never its credential references
  // or auth type (owner-only, enforced server-side too).
  const isSharedHost = !!host?.isShared;
  const readOnly = isSharedHost && host !== null && !canEditHost(host);
  const lockAuthReferences = isSharedHost && !readOnly;

  const handleProtocolToggle = (
    proto: keyof typeof protocols,
    value: boolean,
  ) => {
    onDirtyChange?.(true);
    onProtocolChange({ [proto]: value });
    // Tabs are shown per protocol: SSH owns its group, plugins decide their
    // own visibility. Jump to a tab the change reveals, and away from one it
    // hides.
    const before = protocols as unknown as Record<string, boolean>;
    const after = { ...before, [proto]: value };
    const visibleBefore = new Set(
      makeHostTabs((k) => k, before).map((tab) => tab.id),
    );
    const visibleAfter = makeHostTabs((k) => k, after).map((tab) => tab.id);
    if (!value) {
      if (proto === "enableSsh" && isSshGroupTab(activeTab)) {
        onTabChange("general");
      } else if (!visibleAfter.includes(activeTab)) {
        onTabChange("general");
      }
      return;
    }
    if (proto === "enableSsh") {
      onTabChange("ssh");
      return;
    }
    const revealed = visibleAfter.find(
      (id) => id !== "ssh" && !visibleBefore.has(id),
    );
    if (revealed) onTabChange(revealed);
  };

  return (
    <div className="flex flex-col gap-3">
      {isSharedHost && (
        <div className="flex items-start gap-2.5 p-3 border border-accent-brand/30 bg-accent-brand/5 text-xs text-muted-foreground">
          <Shield className="size-3.5 shrink-0 mt-0.5 text-accent-brand" />
          <div>
            {readOnly
              ? t("hosts.sharing.viewOnlyBanner", {
                  owner: host?.ownerUsername || "?",
                })
              : t("hosts.sharing.sharedEditBanner", {
                  owner: host?.ownerUsername || "?",
                })}
          </div>
        </div>
      )}
      <fieldset
        disabled={readOnly}
        className={`flex flex-col gap-3 min-w-0 ${readOnly ? "opacity-80" : ""}`}
      >
        <div className="flex flex-col gap-3">
          {activeTab === "general" && (
            <HostEditorGeneralTab
              form={form}
              setField={setField}
              protocols={protocols}
              handleProtocolToggle={handleProtocolToggle}
              hosts={hosts}
              host={host}
              simpleMode={simpleMode}
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
              <SectionCard
                title={t("hosts.authenticationLabel")}
                icon={<Shield className="size-3.5" />}
                action={
                  !isSharedHost &&
                  canQuickCreateCredential && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-6 text-[10px] px-2 border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10"
                      onClick={openQuickCredentialDialog}
                    >
                      <Plus className="size-3 mr-1" />
                      {t("hosts.createCredentialFromHostBtn")}
                    </Button>
                  )
                }
              >
                {isSharedHost && (
                  <div className="py-3 text-xs text-muted-foreground">
                    {t(
                      host?.shareSshAuth
                        ? "hosts.sharing.ownerAuthShared"
                        : "hosts.sharing.ownerAuthPrivate",
                    )}
                  </div>
                )}
                <div
                  className={`flex flex-col gap-4 py-3 ${isSharedHost ? "hidden" : ""}`}
                >
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.authenticationMethod")}
                    </label>
                    <p className="text-[10px] text-muted-foreground">
                      {t("hosts.authenticationMethodDesc")}
                    </p>
                    <div
                      className="flex flex-wrap gap-2"
                      role="radiogroup"
                      aria-label={t("hosts.authenticationMethod")}
                    >
                      {selectableAuthMethods.map((m) => (
                        <button
                          key={m}
                          type="button"
                          role="radio"
                          aria-checked={authMethod === m}
                          disabled={lockAuthReferences}
                          title={
                            lockAuthReferences
                              ? t("hosts.sharing.ownerOnlyControl")
                              : undefined
                          }
                          onClick={() => {
                            setField("authType", m as HostAuthType);
                          }}
                          className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${authMethod === m ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand" : "border-border text-muted-foreground hover:text-foreground"}`}
                        >
                          {authEditorLabel(m)}
                        </button>
                      ))}
                    </div>
                    {lockAuthReferences && (
                      <p className="text-[10px] text-muted-foreground/60">
                        {t("hosts.sharing.ownerOnlyControl")}
                      </p>
                    )}
                    {missingAuthNotice && (
                      <p className="text-[10px] text-destructive">
                        {missingAuthNotice}
                      </p>
                    )}
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
                          if (form.username === "root")
                            setField("username", "");
                        }}
                        onBlur={() => {
                          if (form.username === "")
                            setField("username", "root");
                        }}
                        onChange={(e) => setField("username", e.target.value)}
                      />
                      {isOidcUser && (
                        <p className="text-[10px] text-muted-foreground/60">
                          {t("hosts.oidcUsernameHint")}
                        </p>
                      )}
                      {activeAuthEditor?.hintKey && (
                        <p className="text-[10px] text-muted-foreground/60">
                          {t(activeAuthEditor.hintKey)}
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
                          placeholder={
                            form.password === "existing_password"
                              ? t("hosts.passwordSaved")
                              : "••••••••"
                          }
                          value={
                            form.password === "existing_password"
                              ? ""
                              : form.password
                          }
                          onFocus={() => {
                            if (form.password === "existing_password")
                              setField("password", "");
                          }}
                          onChange={(e) => setField("password", e.target.value)}
                        />
                        <PluginComponent
                          id="credentials.secretHint"
                          onManage={() => setShowSecretSources((v) => !v)}
                        />
                      </div>
                    )}
                    {(authMethod === "password" || authMethod === "key") &&
                      showSecretSources && (
                        <PluginComponent
                          id="credentials.secretManager"
                          onClose={() => setShowSecretSources(false)}
                        />
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
                                onChange={(e) =>
                                  setField("key", e.target.value)
                                }
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
                                  accept=".pem,.key,.ppk,.txt"
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
                            {t("hosts.password")} ({t("common.optional")})
                          </label>
                          <PasswordInput
                            className="h-8 text-xs pr-8"
                            placeholder={
                              form.password === "existing_password"
                                ? t("hosts.passwordSaved")
                                : "••••••••"
                            }
                            value={
                              form.password === "existing_password"
                                ? ""
                                : form.password
                            }
                            onFocus={() => {
                              if (form.password === "existing_password")
                                setField("password", "");
                            }}
                            onChange={(e) =>
                              setField("password", e.target.value)
                            }
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            {t("hosts.keyTypeLabel")}
                          </label>
                          <Select2
                            value={form.keyType}
                            onChange={(e) =>
                              setField("keyType", e.target.value)
                            }
                            className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                          >
                            <option value="auto">
                              {t("hosts.keyTypeAuto")}
                            </option>
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
                            <option value="ssh-rsa-sha2-256">
                              RSA SHA2-256
                            </option>
                            <option value="ssh-rsa-sha2-512">
                              RSA SHA2-512
                            </option>
                          </Select2>
                        </div>
                      </>
                    )}
                    {authMethod === "credential" && (
                      <>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            {t("hosts.storedCredential")}
                          </label>
                          <div className="flex items-center gap-2">
                            <Select2
                              value={form.credentialId}
                              disabled={lockAuthReferences}
                              title={
                                lockAuthReferences
                                  ? t("hosts.sharing.ownerOnlyControl")
                                  : undefined
                              }
                              onChange={(e) => {
                                const newId = e.target.value;
                                setField("credentialId", newId);
                                if (!form.overrideCredentialUsername) {
                                  const cred = availableCredentials.find(
                                    (c) => c.id === newId,
                                  );
                                  if (cred?.username)
                                    setField("username", cred.username);
                                }
                              }}
                              className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <option value="">
                                {t("hosts.selectACredential")}
                              </option>
                              {availableCredentials.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.username
                                    ? `${c.name} (${c.username})`
                                    : c.name}
                                </option>
                              ))}
                            </Select2>
                            {onEditCredential && form.credentialId && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-9 px-2.5 shrink-0"
                                title={t("hosts.editCredentialAction")}
                                onClick={() =>
                                  onEditCredential(form.credentialId)
                                }
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                            )}
                          </div>
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
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            {t("hosts.password")} ({t("common.optional")})
                          </label>
                          <PasswordInput
                            className="h-8 text-xs pr-8"
                            placeholder={
                              form.password === "existing_password"
                                ? t("hosts.passwordSaved")
                                : "••••••••"
                            }
                            value={
                              form.password === "existing_password"
                                ? ""
                                : form.password
                            }
                            onFocus={() => {
                              if (form.password === "existing_password")
                                setField("password", "");
                            }}
                            onChange={(e) =>
                              setField("password", e.target.value)
                            }
                          />
                        </div>
                      </>
                    )}
                  </div>
                  {!ActiveAuthEditor &&
                    currentAuthOption?.available &&
                    currentAuthOption.pluginId !== "core" &&
                    currentAuthOption.fields.length > 0 && (
                      <SshAuthProviderFields
                        pluginId={currentAuthOption.pluginId}
                        hostId={host?.id ? Number(host.id) : undefined}
                        fields={
                          currentAuthOption.fields as unknown as PluginSettingsField[]
                        }
                      />
                    )}
                  {ActiveAuthEditor && (
                    <ActiveAuthEditor
                      form={form}
                      setField={
                        setField as unknown as (
                          key: string,
                          value: unknown,
                        ) => void
                      }
                    />
                  )}
                  {authMethod === "agent" && (
                    <div className="flex flex-col gap-2 border-t border-border pt-3">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {t("hosts.agentLabel")}
                      </span>
                      <p className="text-[10px] text-muted-foreground">
                        {t("hosts.agentAuthenticationDesc")}
                      </p>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          {t("hosts.agentSocketPathLabel")}
                        </label>
                        <Input
                          placeholder={t("hosts.agentSocketPathPlaceholder")}
                          value={form.agentSocketPath}
                          onChange={(e) =>
                            setField("agentSocketPath", e.target.value)
                          }
                        />
                        <p className="text-[10px] text-muted-foreground">
                          {t("hosts.agentSocketPathHint")}
                        </p>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          {t("hosts.agentIdentityLabel")}
                        </label>
                        <Input
                          placeholder={t("hosts.agentIdentityPlaceholder")}
                          value={form.agentIdentity}
                          onChange={(e) =>
                            setField("agentIdentity", e.target.value)
                          }
                        />
                        <p className="text-[10px] text-muted-foreground">
                          {t("hosts.agentIdentityHint")}
                        </p>
                      </div>
                    </div>
                  )}
                  <SettingRow
                    label={t("hosts.shareSshAuthLabel")}
                    description={t("hosts.shareSshAuthDesc")}
                  >
                    <FakeSwitch
                      checked={form.shareSshAuth}
                      onChange={(v) => setField("shareSshAuth", v)}
                    />
                  </SettingRow>
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
                      form.allowLegacyAlgorithms
                        ? t("hosts.insecure")
                        : undefined
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
                        placeholder={
                          form.sudoPassword === "existing_sudo_password"
                            ? t("hosts.sudoPasswordSaved")
                            : "••••••••"
                        }
                        value={
                          form.sudoPassword === "existing_sudo_password"
                            ? ""
                            : form.sudoPassword
                        }
                        onFocus={() => {
                          if (form.sudoPassword === "existing_sudo_password")
                            setField("sudoPassword", "");
                        }}
                        onChange={(e) =>
                          setField("sudoPassword", e.target.value)
                        }
                      />
                    </div>
                  )}
                </div>
              </SectionCard>
            </>
          )}

          {(() => {
            const section = getHostEditorSection(activeTab);
            if (!section) return null;
            const Section = section.component;
            return (
              <Section
                form={form}
                setField={
                  setField as unknown as (key: string, value: unknown) => void
                }
                updateForm={updateForm}
                host={host}
                credentials={availableCredentials}
                snippets={snippets}
                protocols={protocols as unknown as Record<string, boolean>}
              />
            );
          })()}
        </div>
      </fieldset>

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
        {!readOnly && (
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
        )}
      </div>

      {showQuickCredentialDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="bg-popover border border-border shadow-xl w-full max-w-sm flex flex-col gap-4 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold">
                {t("hosts.createCredentialFromHostTitle")}
              </span>
              <button
                onClick={() => setShowQuickCredentialDialog(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="text-xs text-muted-foreground">
              {t("hosts.createCredentialFromHostDesc")}
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.friendlyNameLabel")}
              </label>
              <Input
                placeholder="e.g. Production SSH Key"
                value={quickCredentialName}
                onChange={(e) => setQuickCredentialName(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowQuickCredentialDialog(false)}
                disabled={creatingQuickCredential}
              >
                {t("hosts.cancelBtn")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                onClick={handleQuickCreateCredential}
                disabled={creatingQuickCredential}
              >
                {creatingQuickCredential
                  ? t("hosts.savingBtn")
                  : t("hosts.addCredentialBtn")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
