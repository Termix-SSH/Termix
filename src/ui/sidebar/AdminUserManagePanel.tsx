import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowLeft,
  Download,
  KeyRound,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  ShieldOff,
  SquareTerminal,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { PasswordInput } from "@/components/password-input";
import {
  adminGetUserHosts,
  adminDeleteUserHost,
  adminGetUserCredentials,
  adminDeleteUserCredential,
  adminGetUserSnippets,
  adminCreateUserSnippet,
  adminUpdateUserSnippet,
  adminDeleteUserSnippet,
  adminResetUserPassword,
  adminDisableUserTotp,
  adminExportUserData,
  getSessions,
  revokeSession,
  revokeAllUserSessions,
  getApiKeys,
  createApiKey,
  deleteApiKey,
  deleteUser,
  getUserRoles,
  assignRoleToUser,
  removeRoleFromUser,
} from "@/main-axios";
import type { ApiKey, CreatedApiKey, Role, UserRole } from "@/main-axios";
import type { Host, Credential } from "@/types/ui-types";
import type { SSHHostWithStatus } from "@/main-axios";
import { CredentialEditorView } from "./CredentialEditorView";
import { HostEditor } from "./HostEditor";
import { mapCredentials, sshHostToHost } from "./HostManagerData";
import type { AdminSession, AdminUser } from "./AdminManagementSections";
import { makeCredentialTabs, makeHostTabs, TabStrip } from "./HostManagerTabs";

type ApiErrorLike = {
  response?: {
    data?: {
      error?: string;
      code?: string;
    };
  };
};

type ManageTabId =
  | "account"
  | "hosts"
  | "credentials"
  | "snippets"
  | "sessions"
  | "danger";

type ManagedSnippet = {
  id: number;
  name: string;
  content: string;
  description?: string | null;
  folder?: string | null;
};

type EditorState =
  | { kind: "host"; host: Host | null }
  | { kind: "credential"; credential: Credential | null }
  | null;

function apiErrorCode(error: unknown): string | undefined {
  return (error as ApiErrorLike).response?.data?.code;
}

function apiErrorMessage(error: unknown, fallback: string) {
  return (error as ApiErrorLike).response?.data?.error || fallback;
}

function mapSnippets(res: unknown): ManagedSnippet[] {
  const list = Array.isArray(res)
    ? res
    : ((res as { snippets?: unknown[] })?.snippets ?? []);
  return (list as Record<string, unknown>[]).map((s) => ({
    id: Number(s.id),
    name: String(s.name ?? ""),
    content: String(s.content ?? ""),
    description: (s.description as string | null) ?? null,
    folder: (s.folder as string | null) ?? null,
  }));
}

export function AdminUserManagePanel({
  user,
  roles,
  onBack,
  onOpenHostTab,
  onUserDeleted,
  onTotpDisabled,
}: {
  user: AdminUser;
  roles: Role[];
  onBack: () => void;
  onOpenHostTab?: (host: Host) => void;
  onUserDeleted: () => void;
  onTotpDisabled: () => void;
}) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ManageTabId>("account");
  const [editor, setEditor] = useState<EditorState>(null);
  const [editorTab, setEditorTab] = useState("general");
  const [editorProtocols, setEditorProtocols] = useState({
    enableSsh: true,
    enableRdp: false,
    enableVnc: false,
    enableTelnet: false,
  });
  const [confirmDialog, setConfirmDialog] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const [hosts, setHosts] = useState<Host[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [snippets, setSnippets] = useState<ManagedSnippet[]>([]);
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [userRoles, setUserRoles] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(true);

  // Snippet inline editor
  const [editingSnippet, setEditingSnippet] = useState<
    ManagedSnippet | "new" | null
  >(null);
  const [snippetForm, setSnippetForm] = useState({
    name: "",
    content: "",
    folder: "",
  });
  const [snippetSaving, setSnippetSaving] = useState(false);

  // Account tab state
  const [resetPassword, setResetPassword] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [totpEnabled, setTotpEnabled] = useState(!!user.totpEnabled);
  const [exportLoading, setExportLoading] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyLoading, setNewKeyLoading] = useState(false);
  const [createdKeyToken, setCreatedKeyToken] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const dataUnlocked = user.dataUnlocked !== false;

  const reloadHosts = () => {
    if (!dataUnlocked) return;
    adminGetUserHosts(user.id)
      .then((raw) =>
        setHosts(raw.map((h) => sshHostToHost(h as SSHHostWithStatus))),
      )
      .catch(() => {});
  };

  const reloadCredentials = () => {
    if (!dataUnlocked) return;
    adminGetUserCredentials(user.id)
      .then((res) => setCredentials(mapCredentials(res)))
      .catch(() => {});
  };

  const reloadSnippets = () => {
    if (!dataUnlocked) return;
    adminGetUserSnippets(user.id)
      .then((res) => setSnippets(mapSnippets(res)))
      .catch(() => {});
  };

  const reloadSessions = () => {
    getSessions()
      .then(({ sessions: s }) =>
        setSessions(s.filter((session) => session.userId === user.id)),
      )
      .catch(() => {});
  };

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([
      dataUnlocked ? adminGetUserHosts(user.id) : Promise.resolve([]),
      dataUnlocked ? adminGetUserCredentials(user.id) : Promise.resolve([]),
      dataUnlocked ? adminGetUserSnippets(user.id) : Promise.resolve([]),
      getSessions(),
      getApiKeys(),
      getUserRoles(user.id),
    ])
      .then(([h, c, s, sess, keys, ur]) => {
        if (h.status === "fulfilled" && dataUnlocked) {
          setHosts(
            (h.value as SSHHostWithStatus[]).map((raw) => sshHostToHost(raw)),
          );
        }
        if (c.status === "fulfilled" && dataUnlocked) {
          setCredentials(mapCredentials(c.value));
        }
        if (s.status === "fulfilled" && dataUnlocked) {
          setSnippets(mapSnippets(s.value));
        }
        if (sess.status === "fulfilled") {
          setSessions(
            sess.value.sessions.filter((session) => session.userId === user.id),
          );
        }
        if (keys.status === "fulfilled") {
          setApiKeys(keys.value.apiKeys.filter((k) => k.userId === user.id));
        }
        if (ur.status === "fulfilled") {
          setUserRoles(ur.value.roles);
        }
      })
      .finally(() => setLoading(false));
  }, [user.id, dataUnlocked]);

  const manageTabs: { id: ManageTabId; label: string }[] = [
    { id: "account", label: t("admin.manageTabAccount") },
    { id: "hosts", label: t("admin.manageTabHosts") },
    { id: "credentials", label: t("admin.manageTabCredentials") },
    { id: "snippets", label: t("admin.manageTabSnippets") },
    { id: "sessions", label: t("admin.manageTabSessions") },
    { id: "danger", label: t("admin.manageTabDanger") },
  ];

  async function handleResetPassword(confirmDataWipe = false) {
    if (resetPassword.length < 6) {
      toast.error(t("admin.createUserPasswordTooShort"));
      return;
    }
    setResetLoading(true);
    try {
      const result = await adminResetUserPassword(
        user.id,
        resetPassword,
        confirmDataWipe,
      );
      setResetPassword("");
      toast.success(
        result.dataWiped
          ? t("admin.resetPasswordSuccessWiped")
          : t("admin.resetPasswordSuccess"),
      );
    } catch (e) {
      if (apiErrorCode(e) === "DATA_WIPE_REQUIRED") {
        setConfirmDialog({
          message: t("admin.resetPasswordConfirmWipe", {
            username: user.username,
          }),
          onConfirm: () => handleResetPassword(true),
        });
      } else {
        toast.error(apiErrorMessage(e, t("admin.resetPasswordFailed")));
      }
    } finally {
      setResetLoading(false);
    }
  }

  async function handleDisableTotp() {
    try {
      await adminDisableUserTotp(user.id);
      setTotpEnabled(false);
      onTotpDisabled();
      toast.success(t("admin.totpDisabledSuccess"));
    } catch (e) {
      toast.error(apiErrorMessage(e, t("admin.totpDisableFailed")));
    }
  }

  async function handleExport() {
    setExportLoading(true);
    try {
      const data = await adminExportUserData(user.id);
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `termix-user-${user.username}-export.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success(t("admin.exportUserDataSuccess"));
    } catch (e) {
      toast.error(apiErrorMessage(e, t("admin.exportUserDataFailed")));
    } finally {
      setExportLoading(false);
    }
  }

  async function handleCreateApiKey() {
    if (!newKeyName.trim()) {
      toast.error(t("admin.apiKeyNameRequired"));
      return;
    }
    setNewKeyLoading(true);
    try {
      const created: CreatedApiKey = await createApiKey(
        newKeyName.trim(),
        user.id,
      );
      setApiKeys((prev) => [{ ...created, isActive: true }, ...prev]);
      setCreatedKeyToken(created.token);
      setNewKeyName("");
      toast.success(t("admin.apiKeyCreatedSuccess", { name: created.name }));
    } catch (e) {
      toast.error(apiErrorMessage(e, t("admin.apiKeyCreateFailed")));
    } finally {
      setNewKeyLoading(false);
    }
  }

  async function handleDeleteUser() {
    setDeleteLoading(true);
    try {
      await deleteUser(user.username);
      toast.success(t("admin.deleteUserSuccess", { username: user.username }));
      onUserDeleted();
    } catch (e) {
      toast.error(apiErrorMessage(e, t("admin.deleteUserFailed")));
    } finally {
      setDeleteLoading(false);
    }
  }

  async function handleSaveSnippet() {
    if (!snippetForm.name.trim() || !snippetForm.content.trim()) {
      toast.error(t("admin.snippetRequiredFields"));
      return;
    }
    setSnippetSaving(true);
    try {
      const payload = {
        name: snippetForm.name.trim(),
        content: snippetForm.content,
        folder: snippetForm.folder.trim() || null,
      };
      if (editingSnippet !== "new" && editingSnippet) {
        await adminUpdateUserSnippet(user.id, editingSnippet.id, payload);
      } else {
        await adminCreateUserSnippet(user.id, payload);
      }
      setEditingSnippet(null);
      reloadSnippets();
      toast.success(t("admin.snippetSaved"));
    } catch (e) {
      toast.error(apiErrorMessage(e, t("admin.snippetSaveFailed")));
    } finally {
      setSnippetSaving(false);
    }
  }

  const lockedNotice = (
    <div className="flex items-start gap-2.5 p-3 mt-2 border border-border bg-muted/20 text-xs text-muted-foreground">
      <Lock className="size-3.5 shrink-0 mt-0.5" />
      <span>{t("admin.dataLockedNotice", { username: user.username })}</span>
    </div>
  );

  const sectionHeading = (label: string) => (
    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
      {label}
    </span>
  );

  // Full-panel host/credential editor view (mirrors HostManager's editor view)
  if (editor) {
    const isHost = editor.kind === "host";
    const tabs = isHost
      ? makeHostTabs(t).filter((tab) => {
          if (tab.id === "general") return true;
          if (tab.id === "ssh") return editorProtocols.enableSsh;
          if (tab.id === "rdp") return editorProtocols.enableRdp;
          if (tab.id === "vnc") return editorProtocols.enableVnc;
          if (tab.id === "telnet") return editorProtocols.enableTelnet;
          return false;
        })
      : makeCredentialTabs(t);

    return (
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex flex-col shrink-0 border-b border-border">
          <button
            onClick={() => {
              setEditor(null);
              setEditorTab("general");
            }}
            className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors border-b border-border/50"
          >
            <ArrowLeft className="size-3.5 shrink-0" />
            <span>
              {t("admin.manageEditorBack", { username: user.username })}
            </span>
          </button>
          <TabStrip
            tabs={tabs}
            activeTab={editorTab}
            onTabChange={setEditorTab}
          />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-3">
          {isHost ? (
            <HostEditor
              key={editor.host ? editor.host.id : "new-host"}
              host={editor.host}
              activeTab={editorTab}
              onBack={() => {
                setEditor(null);
                setEditorTab("general");
              }}
              onSave={() => {
                setEditor(null);
                setEditorTab("general");
                reloadHosts();
              }}
              protocols={editorProtocols}
              onProtocolChange={(p) =>
                setEditorProtocols((prev) => ({ ...prev, ...p }))
              }
              onTabChange={setEditorTab}
              hosts={hosts}
              credentials={credentials}
              adminTargetUserId={user.id}
            />
          ) : (
            <CredentialEditorView
              key={editor.credential ? editor.credential.id : "new-cred"}
              credential={editor.credential}
              activeTab={editorTab}
              onBack={() => {
                setEditor(null);
                setEditorTab("general");
              }}
              onSave={() => {
                setEditor(null);
                setEditorTab("general");
                reloadCredentials();
              }}
              adminTargetUserId={user.id}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Back bar */}
      <div className="flex flex-col shrink-0 border-b border-border">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors border-b border-border/50"
        >
          <ArrowLeft className="size-3.5 shrink-0" />
          <span>{t("admin.backToUsers")}</span>
          <span className="ml-auto flex items-center gap-1.5 min-w-0">
            <span
              className="font-semibold text-foreground truncate max-w-[160px]"
              title={user.username}
            >
              {user.username}
            </span>
            {user.isAdmin && (
              <span className="text-[9px] font-semibold px-1 py-px border border-accent-brand/40 bg-accent-brand/10 text-accent-brand">
                {t("admin.adminBadge")}
              </span>
            )}
            {!dataUnlocked && (
              <span className="flex items-center gap-0.5 text-[9px] font-semibold px-1 py-px border border-border text-muted-foreground">
                <Lock className="size-2.5" />
                {t("admin.dataLockedBadge")}
              </span>
            )}
          </span>
        </button>
        <TabStrip
          tabs={manageTabs.map((tab) => ({ ...tab, icon: null }))}
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as ManageTabId)}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-4">
        {activeTab === "account" && (
          <>
            {/* Password reset */}
            <div className="flex flex-col gap-2">
              {sectionHeading(t("admin.resetPasswordTitle"))}
              {user.isOidc && !user.passwordHash ? (
                <span className="text-xs text-muted-foreground">
                  {t("admin.resetPasswordOidcOnly")}
                </span>
              ) : (
                <div className="flex items-center gap-2">
                  <PasswordInput
                    className="h-8 text-xs pr-8 flex-1"
                    placeholder={t("admin.resetPasswordPlaceholder")}
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand shrink-0"
                    disabled={resetLoading || !resetPassword}
                    onClick={() => handleResetPassword()}
                  >
                    {resetLoading
                      ? t("admin.resetPasswordWorking")
                      : t("admin.resetPasswordBtn")}
                  </Button>
                </div>
              )}
            </div>

            {/* TOTP */}
            <div className="flex flex-col gap-2">
              {sectionHeading(t("admin.totpSectionTitle"))}
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {totpEnabled
                    ? t("admin.totpStatusEnabled")
                    : t("admin.totpStatusDisabled")}
                </span>
                {totpEnabled && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[10px] border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() =>
                      setConfirmDialog({
                        message: t("admin.disableTotpConfirm", {
                          username: user.username,
                        }),
                        onConfirm: handleDisableTotp,
                      })
                    }
                  >
                    <ShieldOff className="size-3" />
                    {t("admin.disableTotp")}
                  </Button>
                )}
              </div>
            </div>

            {/* Roles */}
            <div className="flex flex-col gap-2">
              {sectionHeading(t("admin.userRoles"))}
              {userRoles.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {userRoles.map((ur) => {
                    const roleInfo = roles.find((r) => r.id === ur.roleId);
                    const isSystem = roleInfo?.isSystem ?? false;
                    return (
                      <span
                        key={ur.roleId}
                        className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 border border-accent-brand/40 bg-accent-brand/10 text-accent-brand"
                      >
                        {ur.roleDisplayName}
                        {!isSystem && (
                          <button
                            onClick={async () => {
                              try {
                                await removeRoleFromUser(user.id, ur.roleId);
                                setUserRoles((prev) =>
                                  prev.filter((r) => r.roleId !== ur.roleId),
                                );
                              } catch {
                                toast.error(t("admin.removeRoleFailed"));
                              }
                            }}
                            className="hover:text-destructive ml-0.5"
                          >
                            ×
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {roles
                  .filter(
                    (r) =>
                      !r.isSystem &&
                      !userRoles.some((ur) => ur.roleId === r.id),
                  )
                  .map((r) => (
                    <button
                      key={r.id}
                      onClick={async () => {
                        try {
                          await assignRoleToUser(user.id, r.id);
                          setUserRoles((prev) => [
                            ...prev,
                            {
                              userId: user.id,
                              roleId: r.id,
                              roleName: r.name,
                              roleDisplayName: r.displayName,
                              grantedBy: "",
                              grantedByUsername: "",
                              grantedAt: new Date().toISOString(),
                            },
                          ]);
                        } catch {
                          toast.error(t("admin.assignRoleFailed"));
                        }
                      }}
                      className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 border border-border text-muted-foreground hover:border-accent-brand/40 hover:text-accent-brand transition-colors"
                    >
                      + {r.displayName}
                    </button>
                  ))}
              </div>
            </div>

            {/* API keys */}
            <div className="flex flex-col gap-2">
              {sectionHeading(t("admin.manageApiKeys"))}
              <div className="flex items-center gap-2">
                <Input
                  className="h-8 text-xs flex-1"
                  placeholder={t("admin.apiKeyNamePlaceholder")}
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand shrink-0"
                  disabled={newKeyLoading || !newKeyName.trim()}
                  onClick={handleCreateApiKey}
                >
                  <Plus className="size-3" />
                  {t("admin.createKey")}
                </Button>
              </div>
              {createdKeyToken && (
                <div className="flex flex-col gap-1 p-2 border border-accent-brand/30 bg-accent-brand/5">
                  <span className="text-[10px] text-muted-foreground">
                    {t("admin.apiKeyCopyNotice")}
                  </span>
                  <code className="text-[10px] font-mono break-all text-accent-brand">
                    {createdKeyToken}
                  </code>
                </div>
              )}
              {apiKeys.length === 0 ? (
                <span className="text-xs text-muted-foreground">
                  {t("admin.noApiKeysForUser")}
                </span>
              ) : (
                apiKeys.map((key) => (
                  <div
                    key={key.id}
                    className="flex items-center justify-between py-1.5 border-b border-border last:border-0"
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-xs font-semibold truncate">
                        {key.name}
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {key.tokenPrefix}…
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={async () => {
                        try {
                          await deleteApiKey(key.id);
                          setApiKeys((prev) =>
                            prev.filter((k) => k.id !== key.id),
                          );
                        } catch {
                          toast.error(t("admin.apiKeyDeleteFailed"));
                        }
                      }}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                ))
              )}
            </div>

            {/* Data export */}
            <div className="flex flex-col gap-2">
              {sectionHeading(t("admin.exportUserData"))}
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {t("admin.exportUserDataDesc")}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[10px] shrink-0 ml-3"
                  disabled={exportLoading || !dataUnlocked}
                  onClick={handleExport}
                >
                  <Download className="size-3" />
                  {exportLoading ? t("admin.exporting") : t("admin.export")}
                </Button>
              </div>
              {!dataUnlocked && lockedNotice}
            </div>
          </>
        )}

        {activeTab === "hosts" &&
          (!dataUnlocked ? (
            lockedNotice
          ) : (
            <div className="flex flex-col">
              <div className="flex items-center justify-between py-2 border-b border-border">
                <span className="text-[10px] text-muted-foreground">
                  {t("admin.hostsCount", { count: hosts.length })}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground hover:text-foreground"
                    onClick={reloadHosts}
                  >
                    <RefreshCw className="size-3" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[10px] border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                    onClick={() => {
                      setEditorProtocols({
                        enableSsh: true,
                        enableRdp: false,
                        enableVnc: false,
                        enableTelnet: false,
                      });
                      setEditorTab("general");
                      setEditor({ kind: "host", host: null });
                    }}
                  >
                    <Plus className="size-3" />
                    {t("admin.addHostForUser")}
                  </Button>
                </div>
              </div>
              {!loading && hosts.length === 0 && (
                <span className="text-xs text-muted-foreground py-3">
                  {t("admin.noHostsForUser")}
                </span>
              )}
              {hosts.map((host) => (
                <div
                  key={host.id}
                  className="flex items-center justify-between py-2.5 border-b border-border last:border-0"
                >
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-xs font-semibold truncate max-w-[180px]">
                      {host.name || host.ip}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground truncate">
                      {host.username ? `${host.username}@` : ""}
                      {host.ip}:{host.port}
                    </span>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    {onOpenHostTab && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 text-muted-foreground hover:text-accent-brand"
                        title={t("admin.connectToHost")}
                        onClick={() => onOpenHostTab(host)}
                      >
                        <SquareTerminal className="size-3" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setEditorProtocols({
                          enableSsh: host.enableSsh,
                          enableRdp: host.enableRdp,
                          enableVnc: host.enableVnc,
                          enableTelnet: host.enableTelnet,
                        });
                        setEditorTab("general");
                        setEditor({ kind: "host", host });
                      }}
                    >
                      <Pencil className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        setConfirmDialog({
                          message: t("admin.deleteHostConfirm", {
                            name: host.name || host.ip,
                            username: user.username,
                          }),
                          onConfirm: async () => {
                            try {
                              await adminDeleteUserHost(
                                user.id,
                                Number(host.id),
                              );
                              setHosts((prev) =>
                                prev.filter((h) => h.id !== host.id),
                              );
                              toast.success(t("admin.hostDeletedSuccess"));
                            } catch (e) {
                              toast.error(
                                apiErrorMessage(e, t("admin.hostDeleteFailed")),
                              );
                            }
                          },
                        })
                      }
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ))}

        {activeTab === "credentials" &&
          (!dataUnlocked ? (
            lockedNotice
          ) : (
            <div className="flex flex-col">
              <div className="flex items-center justify-between py-2 border-b border-border">
                <span className="text-[10px] text-muted-foreground">
                  {t("admin.credentialsCount", { count: credentials.length })}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground hover:text-foreground"
                    onClick={reloadCredentials}
                  >
                    <RefreshCw className="size-3" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[10px] border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                    onClick={() => {
                      setEditorTab("general");
                      setEditor({ kind: "credential", credential: null });
                    }}
                  >
                    <Plus className="size-3" />
                    {t("admin.addCredentialForUser")}
                  </Button>
                </div>
              </div>
              {!loading && credentials.length === 0 && (
                <span className="text-xs text-muted-foreground py-3">
                  {t("admin.noCredentialsForUser")}
                </span>
              )}
              {credentials.map((cred) => (
                <div
                  key={cred.id}
                  className="flex items-center justify-between py-2.5 border-b border-border last:border-0"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <KeyRound className="size-3.5 text-muted-foreground shrink-0" />
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-xs font-semibold truncate max-w-[180px]">
                        {cred.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground truncate">
                        {cred.username || "-"} · {cred.type}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setEditorTab("general");
                        setEditor({ kind: "credential", credential: cred });
                      }}
                    >
                      <Pencil className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        setConfirmDialog({
                          message: t("admin.deleteCredentialConfirm", {
                            name: cred.name,
                            username: user.username,
                          }),
                          onConfirm: async () => {
                            try {
                              await adminDeleteUserCredential(
                                user.id,
                                Number(cred.id),
                              );
                              setCredentials((prev) =>
                                prev.filter((c) => c.id !== cred.id),
                              );
                              toast.success(
                                t("admin.credentialDeletedSuccess"),
                              );
                            } catch (e) {
                              toast.error(
                                apiErrorMessage(
                                  e,
                                  t("admin.credentialDeleteFailed"),
                                ),
                              );
                            }
                          },
                        })
                      }
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ))}

        {activeTab === "snippets" &&
          (!dataUnlocked ? (
            lockedNotice
          ) : (
            <div className="flex flex-col">
              <div className="flex items-center justify-between py-2 border-b border-border">
                <span className="text-[10px] text-muted-foreground">
                  {t("admin.snippetsCount", { count: snippets.length })}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground hover:text-foreground"
                    onClick={reloadSnippets}
                  >
                    <RefreshCw className="size-3" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[10px] border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                    onClick={() => {
                      setSnippetForm({ name: "", content: "", folder: "" });
                      setEditingSnippet("new");
                    }}
                  >
                    <Plus className="size-3" />
                    {t("admin.addSnippetForUser")}
                  </Button>
                </div>
              </div>
              {editingSnippet && (
                <div className="flex flex-col gap-2.5 py-3 border-b border-border">
                  <Input
                    className="h-8 text-xs"
                    placeholder={t("admin.snippetNamePlaceholder")}
                    value={snippetForm.name}
                    onChange={(e) =>
                      setSnippetForm((p) => ({ ...p, name: e.target.value }))
                    }
                  />
                  <textarea
                    rows={4}
                    placeholder={t("admin.snippetContentPlaceholder")}
                    value={snippetForm.content}
                    onChange={(e) =>
                      setSnippetForm((p) => ({
                        ...p,
                        content: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 text-[10px] bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring font-mono"
                  />
                  <Input
                    className="h-8 text-xs"
                    placeholder={t("admin.snippetFolderPlaceholder")}
                    value={snippetForm.folder}
                    onChange={(e) =>
                      setSnippetForm((p) => ({
                        ...p,
                        folder: e.target.value,
                      }))
                    }
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px]"
                      onClick={() => setEditingSnippet(null)}
                    >
                      {t("common.cancel")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-[10px] border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                      disabled={snippetSaving}
                      onClick={handleSaveSnippet}
                    >
                      {snippetSaving ? t("hosts.savingBtn") : t("common.save")}
                    </Button>
                  </div>
                </div>
              )}
              {!loading && snippets.length === 0 && !editingSnippet && (
                <span className="text-xs text-muted-foreground py-3">
                  {t("admin.noSnippetsForUser")}
                </span>
              )}
              {snippets.map((snippet) => (
                <div
                  key={snippet.id}
                  className="flex items-center justify-between py-2.5 border-b border-border last:border-0"
                >
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-xs font-semibold truncate max-w-[180px]">
                      {snippet.name}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[220px]">
                      {snippet.content}
                    </span>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setSnippetForm({
                          name: snippet.name,
                          content: snippet.content,
                          folder: snippet.folder ?? "",
                        });
                        setEditingSnippet(snippet);
                      }}
                    >
                      <Pencil className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        setConfirmDialog({
                          message: t("admin.deleteSnippetConfirm", {
                            name: snippet.name,
                            username: user.username,
                          }),
                          onConfirm: async () => {
                            try {
                              await adminDeleteUserSnippet(user.id, snippet.id);
                              setSnippets((prev) =>
                                prev.filter((s) => s.id !== snippet.id),
                              );
                              toast.success(t("admin.snippetDeletedSuccess"));
                            } catch (e) {
                              toast.error(
                                apiErrorMessage(
                                  e,
                                  t("admin.snippetDeleteFailed"),
                                ),
                              );
                            }
                          },
                        })
                      }
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ))}

        {activeTab === "sessions" && (
          <div className="flex flex-col">
            <div className="flex items-center justify-between py-2 border-b border-border">
              <span className="text-[10px] text-muted-foreground">
                {t("admin.sessionsActive", { count: sessions.length })}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-muted-foreground hover:text-foreground"
                  onClick={reloadSessions}
                >
                  <RefreshCw className="size-3" />
                </Button>
                {sessions.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[10px] border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={async () => {
                      try {
                        await revokeAllUserSessions(user.id);
                        setSessions([]);
                        toast.success(t("admin.allSessionsRevoked"));
                      } catch {
                        toast.error(t("admin.revokeSessionsFailed"));
                      }
                    }}
                  >
                    {t("admin.revokeAll")}
                  </Button>
                )}
              </div>
            </div>
            {!loading && sessions.length === 0 && (
              <span className="text-xs text-muted-foreground py-3">
                {t("admin.noSessionsForUser")}
              </span>
            )}
            {sessions.map((session) => (
              <div
                key={session.id}
                className="flex items-start justify-between py-2.5 border-b border-border last:border-0 gap-2"
              >
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <span className="text-[10px] text-muted-foreground truncate">
                    {session.deviceInfo}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {t("admin.sessionActive", { time: session.lastActiveAt })}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={async () => {
                    try {
                      await revokeSession(session.id);
                      setSessions((prev) =>
                        prev.filter((s) => s.id !== session.id),
                      );
                    } catch {
                      toast.error(t("admin.revokeSessionFailed"));
                    }
                  }}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {activeTab === "danger" && (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2.5 border border-destructive/30 bg-destructive/5 px-3 py-2.5">
              <TriangleAlert className="size-4 text-destructive shrink-0 mt-0.5" />
              <div className="flex flex-col gap-2 flex-1">
                <span className="text-xs text-muted-foreground">
                  {t("admin.deleteUserDangerDesc", {
                    username: user.username,
                  })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[10px] border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive self-start"
                  disabled={deleteLoading || user.isAdmin}
                  onClick={() =>
                    setConfirmDialog({
                      message: t("admin.deleteUserConfirm", {
                        username: user.username,
                      }),
                      onConfirm: handleDeleteUser,
                    })
                  }
                >
                  <Trash2 className="size-3" />
                  {t("admin.deleteUser", { username: user.username })}
                </Button>
                {user.isAdmin && (
                  <span className="text-[10px] text-muted-foreground">
                    {t("admin.deleteUserAdminBlocked")}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Confirm dialog overlay */}
      {confirmDialog && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="bg-popover border border-border shadow-xl w-full max-w-xs flex flex-col gap-4 p-4">
            <p className="text-sm text-foreground">{confirmDialog.message}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-3 py-1.5 text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() => {
                  confirmDialog.onConfirm();
                  setConfirmDialog(null);
                }}
                className="px-3 py-1.5 text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded transition-colors"
              >
                {t("common.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
