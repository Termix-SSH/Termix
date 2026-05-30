import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  getUserList,
  getSessions,
  getRoles,
  getApiKeys,
  createApiKey,
  deleteUser,
  revokeSession,
  revokeAllUserSessions,
  deleteRole,
  deleteApiKey,
  createRole,
  registerUser,
  makeUserAdmin,
  removeAdminStatus,
  getRegistrationAllowed,
  updateRegistrationAllowed,
  getPasswordLoginAllowed,
  updatePasswordLoginAllowed,
  getPasswordResetAllowed,
  updatePasswordResetAllowed,
  getSessionTimeout,
  updateSessionTimeout,
  getGlobalMonitoringSettings,
  updateGlobalMonitoringSettings,
  getLogLevel,
  updateLogLevel,
  getGuacamoleSettings,
  updateGuacamoleSettings,
  getAdminOIDCConfig,
  updateOIDCConfig,
  disableOIDCConfig,
  getOidcAutoProvision,
  updateOidcAutoProvision,
  isElectron,
  getUserRoles,
  assignRoleToUser,
  removeRoleFromUser,
} from "@/main-axios";
import type { ApiKey, CreatedApiKey, UserRole } from "@/main-axios";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/dialog";
import {
  Activity,
  AlertCircle,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Share2,
  Trash2,
  User,
} from "lucide-react";
import type { AdminSection } from "@/types/ui-types";
import type { Role } from "@/main-axios";
import { toast } from "sonner";
import { getBasePath } from "@/lib/base-path";
import { AccordionSection, AdminToggle } from "./AdminSettingsShared";
import {
  AdminDatabaseSection,
  AdminGeneralSettingsSection,
  AdminOidcSettingsSection,
} from "./AdminSettingsSections";

type AdminUser = {
  id: string;
  username: string;
  isAdmin: boolean;
  isOidc: boolean;
  passwordHash?: string;
};

type AdminSession = {
  id: string;
  userId: string;
  username?: string;
  deviceType: string;
  deviceInfo: string;
  createdAt: string;
  expiresAt: string;
  lastActiveAt: string;
  isRevoked?: boolean;
  isCurrentSession?: boolean;
};

type ApiErrorLike = {
  response?: {
    data?: {
      error?: string;
    };
  };
};

function apiErrorMessage(error: unknown, fallback: string) {
  return (error as ApiErrorLike).response?.data?.error || fallback;
}

export function AdminSettingsPanel() {
  const { t } = useTranslation();
  const [openSection, setOpenSection] = useState<AdminSection | null>(
    "general",
  );
  const [allowRegistration, setAllowRegistration] = useState(true);
  const [allowPasswordLogin, setAllowPasswordLogin] = useState(true);
  const [allowPasswordReset, setAllowPasswordReset] = useState(true);
  const [sessionTimeout, setSessionTimeout] = useState("24");
  const [statusInterval, setStatusInterval] = useState("60");
  const [metricsInterval, setMetricsInterval] = useState("30");
  const [guacEnabled, setGuacEnabled] = useState(false);
  const [guacUrl, setGuacUrl] = useState("guacd:4822");
  const [logLevel, setLogLevel] = useState("info");

  // OIDC state
  const [oidcAutoProvision, setOidcAutoProvision] = useState(false);
  const [oidcClientId, setOidcClientId] = useState("");
  const [oidcClientSecret, setOidcClientSecret] = useState("");
  const [oidcAuthUrl, setOidcAuthUrl] = useState("");
  const [oidcIssuerUrl, setOidcIssuerUrl] = useState("");
  const [oidcTokenUrl, setOidcTokenUrl] = useState("");
  const [oidcUserIdentifier, setOidcUserIdentifier] = useState("sub");
  const [oidcDisplayName, setOidcDisplayName] = useState("name");
  const [oidcScopes, setOidcScopes] = useState("openid email profile");
  const [oidcUserinfoUrl, setOidcUserinfoUrl] = useState("");
  const [oidcAllowedUsers, setOidcAllowedUsers] = useState("");
  const [oidcSaving, setOidcSaving] = useState(false);

  // Create user dialog
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [createUserLoading, setCreateUserLoading] = useState(false);

  // Edit user dialog
  const [editUserOpen, setEditUserOpen] = useState(false);
  const [editUserTarget, setEditUserTarget] = useState<AdminUser | null>(null);
  const [editUserLoading, setEditUserLoading] = useState(false);
  const [editUserRoles, setEditUserRoles] = useState<UserRole[]>([]);
  const [editUserRolesLoading, setEditUserRolesLoading] = useState(false);

  // Link account dialog
  const [linkAccountOpen, setLinkAccountOpen] = useState(false);
  const [linkAccountTarget, setLinkAccountTarget] = useState<{
    id: string;
    username: string;
  } | null>(null);

  // Create role form
  const [showCreateRole, setShowCreateRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleDisplayName, setNewRoleDisplayName] = useState("");
  const [newRoleDescription, setNewRoleDescription] = useState("");
  const [createRoleLoading, setCreateRoleLoading] = useState(false);

  // Create API key form
  const [showCreateKey, setShowCreateKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyUserId, setNewKeyUserId] = useState("");
  const [newKeyExpiry, setNewKeyExpiry] = useState("");
  const [newKeyLoading, setNewKeyLoading] = useState(false);
  const [createdKeyToken, setCreatedKeyToken] = useState<string | null>(null);

  // Import state
  const [importFile, setImportFile] = useState<File | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);

  useEffect(() => {
    loadUsers();
    loadSessions();
    loadRoles();
    loadApiKeys();
    loadGeneralSettings();
    loadOidcConfig();
  }, []);

  useEffect(() => {
    if (editUserOpen && editUserTarget) {
      setEditUserRoles([]);
      setEditUserRolesLoading(true);
      getUserRoles(editUserTarget.id)
        .then(({ roles: r }) => setEditUserRoles(r))
        .catch(() => {})
        .finally(() => setEditUserRolesLoading(false));
    }
  }, [editUserOpen, editUserTarget]);

  function loadUsers() {
    getUserList()
      .then(({ users: u }) =>
        setUsers(
          u.map((user) => ({
            id: user.userId,
            username: user.username,
            isAdmin: user.is_admin,
            isOidc: user.is_oidc,
            passwordHash: user.password_hash,
          })),
        ),
      )
      .catch(() => {});
  }

  function loadSessions() {
    getSessions()
      .then(({ sessions: s }) => setSessions(s))
      .catch(() => {});
  }

  function loadRoles() {
    getRoles()
      .then(({ roles: r }) => setRoles(r))
      .catch(() => {});
  }

  function loadApiKeys() {
    getApiKeys()
      .then(({ apiKeys: k }) => setApiKeys(k))
      .catch(() => {});
  }

  async function loadGeneralSettings() {
    try {
      const [
        reg,
        pwLogin,
        pwReset,
        timeout,
        monitoring,
        level,
        guac,
        oidcProv,
      ] = await Promise.allSettled([
        getRegistrationAllowed(),
        getPasswordLoginAllowed(),
        getPasswordResetAllowed(),
        getSessionTimeout(),
        getGlobalMonitoringSettings(),
        getLogLevel(),
        getGuacamoleSettings(),
        getOidcAutoProvision(),
      ]);

      if (reg.status === "fulfilled") setAllowRegistration(reg.value.allowed);
      if (pwLogin.status === "fulfilled")
        setAllowPasswordLogin(pwLogin.value.allowed);
      if (oidcProv.status === "fulfilled")
        setOidcAutoProvision(oidcProv.value.enabled);
      if (pwReset.status === "fulfilled") setAllowPasswordReset(pwReset.value);
      if (timeout.status === "fulfilled")
        setSessionTimeout(String(timeout.value.timeoutHours));
      if (monitoring.status === "fulfilled") {
        setStatusInterval(String(monitoring.value.statusCheckInterval));
        setMetricsInterval(String(monitoring.value.metricsInterval));
      }
      if (level.status === "fulfilled") setLogLevel(level.value.level);
      if (guac.status === "fulfilled") {
        setGuacEnabled(guac.value.enabled);
        setGuacUrl(guac.value.url || "guacd:4822");
      }
    } catch {
      // non-fatal
    }
  }

  async function loadOidcConfig() {
    try {
      const config = await getAdminOIDCConfig();
      if (!config) return;
      setOidcClientId((config.client_id as string) ?? "");
      setOidcClientSecret((config.client_secret as string) ?? "");
      setOidcAuthUrl((config.authorization_url as string) ?? "");
      setOidcIssuerUrl((config.issuer_url as string) ?? "");
      setOidcTokenUrl((config.token_url as string) ?? "");
      setOidcUserIdentifier((config.identifier_path as string) ?? "sub");
      setOidcDisplayName((config.name_path as string) ?? "name");
      setOidcScopes((config.scopes as string) ?? "openid email profile");
      setOidcUserinfoUrl((config.userinfo_url as string) ?? "");
      setOidcAllowedUsers(
        typeof config.allowed_users === "string"
          ? (config.allowed_users as string)
              .split(",")
              .filter(Boolean)
              .join("\n")
          : "",
      );
    } catch {
      // no OIDC configured yet
    }
  }

  function toggle(id: AdminSection) {
    setOpenSection((prev) => (prev === id ? null : id));
  }

  async function handleToggleRegistration() {
    const newVal = !allowRegistration;
    setAllowRegistration(newVal);
    try {
      await updateRegistrationAllowed(newVal);
    } catch {
      setAllowRegistration(!newVal);
      toast.error(t("admin.updateRegistrationFailed"));
    }
  }

  async function handleTogglePasswordLogin() {
    const newVal = !allowPasswordLogin;
    setAllowPasswordLogin(newVal);
    try {
      await updatePasswordLoginAllowed(newVal);
    } catch {
      setAllowPasswordLogin(!newVal);
      toast.error(t("admin.updatePasswordLoginFailed"));
    }
  }

  async function handleToggleOidcAutoProvision() {
    const newVal = !oidcAutoProvision;
    setOidcAutoProvision(newVal);
    try {
      await updateOidcAutoProvision(newVal);
    } catch {
      setOidcAutoProvision(!newVal);
      toast.error(t("admin.updateOidcAutoProvisionFailed"));
    }
  }

  async function handleTogglePasswordReset() {
    const newVal = !allowPasswordReset;
    setAllowPasswordReset(newVal);
    try {
      await updatePasswordResetAllowed(newVal);
    } catch {
      setAllowPasswordReset(!newVal);
      toast.error(t("admin.updatePasswordResetFailed"));
    }
  }

  async function handleSaveSessionTimeout() {
    const hours = parseInt(sessionTimeout, 10);
    if (isNaN(hours) || hours < 1 || hours > 720) {
      toast.error(t("admin.sessionTimeoutRange2"));
      return;
    }
    try {
      await updateSessionTimeout(hours);
      toast.success(t("admin.sessionTimeoutSaved"));
    } catch {
      toast.error(t("admin.sessionTimeoutSaveFailed"));
    }
  }

  async function handleSaveMonitoring() {
    const status = parseInt(statusInterval, 10);
    const metrics = parseInt(metricsInterval, 10);
    if (isNaN(status) || isNaN(metrics)) {
      toast.error(t("admin.monitoringIntervalInvalid"));
      return;
    }
    try {
      await updateGlobalMonitoringSettings({
        statusCheckInterval: status,
        metricsInterval: metrics,
      });
      toast.success(t("admin.monitoringSaved"));
    } catch {
      toast.error(t("admin.monitoringSaveFailed"));
    }
  }

  async function handleSaveGuacamole() {
    try {
      await updateGuacamoleSettings({ enabled: guacEnabled, url: guacUrl });
      toast.success(t("admin.guacamoleSaved"));
    } catch {
      toast.error(t("admin.guacamoleSaveFailed"));
    }
  }

  async function handleToggleGuacamole() {
    const newVal = !guacEnabled;
    setGuacEnabled(newVal);
    try {
      await updateGuacamoleSettings({ enabled: newVal, url: guacUrl });
    } catch {
      setGuacEnabled(!newVal);
      toast.error(t("admin.guacamoleUpdateFailed"));
    }
  }

  async function handleSaveLogLevel(level: string) {
    setLogLevel(level);
    try {
      await updateLogLevel(level);
    } catch {
      toast.error(t("admin.logLevelUpdateFailed"));
    }
  }

  async function handleSaveOidc() {
    setOidcSaving(true);
    try {
      await updateOIDCConfig({
        client_id: oidcClientId,
        client_secret: oidcClientSecret,
        authorization_url: oidcAuthUrl,
        issuer_url: oidcIssuerUrl,
        token_url: oidcTokenUrl,
        identifier_path: oidcUserIdentifier,
        name_path: oidcDisplayName,
        scopes: oidcScopes,
        userinfo_url: oidcUserinfoUrl || "",
        allowed_users: oidcAllowedUsers
          ? oidcAllowedUsers.split("\n").filter(Boolean).join(",")
          : "",
      });
      toast.success(t("admin.oidcSaved"));
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, t("admin.oidcSaveFailed")));
    } finally {
      setOidcSaving(false);
    }
  }

  async function handleRemoveOidc() {
    try {
      await disableOIDCConfig();
      setOidcClientId("");
      setOidcClientSecret("");
      setOidcAuthUrl("");
      setOidcIssuerUrl("");
      setOidcTokenUrl("");
      setOidcUserIdentifier("sub");
      setOidcDisplayName("name");
      setOidcScopes("openid email profile");
      setOidcUserinfoUrl("");
      setOidcAllowedUsers("");
      toast.success(t("admin.oidcRemoved"));
    } catch {
      toast.error(t("admin.oidcRemoveFailed"));
    }
  }

  async function handleCreateUser() {
    if (!newUsername.trim() || !newPassword.trim()) {
      toast.error(t("admin.createUserRequired"));
      return;
    }
    if (newPassword.length < 6) {
      toast.error(t("admin.createUserPasswordTooShort"));
      return;
    }
    setCreateUserLoading(true);
    try {
      await registerUser(newUsername.trim(), newPassword);
      toast.success(t("admin.createUserSuccess", { username: newUsername }));
      setCreateUserOpen(false);
      setNewUsername("");
      setNewPassword("");
      loadUsers();
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, t("admin.createUserFailed")));
    } finally {
      setCreateUserLoading(false);
    }
  }

  async function handleToggleAdmin(user: AdminUser) {
    setEditUserLoading(true);
    try {
      if (user.isAdmin) {
        await removeAdminStatus(user.id);
        setEditUserTarget((prev) =>
          prev ? { ...prev, isAdmin: false } : prev,
        );
        setUsers((prev) =>
          prev.map((u) => (u.id === user.id ? { ...u, isAdmin: false } : u)),
        );
      } else {
        await makeUserAdmin(user.id);
        setEditUserTarget((prev) => (prev ? { ...prev, isAdmin: true } : prev));
        setUsers((prev) =>
          prev.map((u) => (u.id === user.id ? { ...u, isAdmin: true } : u)),
        );
      }
    } catch {
      toast.error(t("admin.updateAdminStatusFailed"));
    } finally {
      setEditUserLoading(false);
    }
  }

  async function handleRevokeUserSessions(userId: string) {
    try {
      await revokeAllUserSessions(userId);
      toast.success(t("admin.allSessionsRevoked"));
      loadSessions();
    } catch {
      toast.error(t("admin.revokeSessionsFailed"));
    }
  }

  async function handleDeleteEditUser() {
    if (!editUserTarget) return;
    setEditUserLoading(true);
    try {
      await deleteUser(editUserTarget.username);
      setUsers((prev) => prev.filter((u) => u.id !== editUserTarget.id));
      setEditUserOpen(false);
      setEditUserTarget(null);
      toast.success(
        t("admin.deleteUserSuccess", { username: editUserTarget.username }),
      );
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, t("admin.deleteUserFailed")));
    } finally {
      setEditUserLoading(false);
    }
  }

  async function handleCreateRole() {
    if (!newRoleName.trim() || !newRoleDisplayName.trim()) {
      toast.error(t("admin.createRoleRequired"));
      return;
    }
    setCreateRoleLoading(true);
    const displayName = newRoleDisplayName.trim();
    try {
      await createRole({
        name: newRoleName.trim(),
        displayName,
        description: newRoleDescription.trim() || null,
      });
      setShowCreateRole(false);
      setNewRoleName("");
      setNewRoleDisplayName("");
      setNewRoleDescription("");
      toast.success(t("admin.createRoleSuccess", { name: displayName }));
      loadRoles();
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, t("admin.createRoleFailed")));
    } finally {
      setCreateRoleLoading(false);
    }
  }

  async function handleCreateApiKey() {
    if (!newKeyName.trim()) {
      toast.error(t("admin.apiKeyNameRequired"));
      return;
    }
    if (!newKeyUserId.trim()) {
      toast.error(t("admin.apiKeyUserRequired"));
      return;
    }
    setNewKeyLoading(true);
    try {
      const created: CreatedApiKey = await createApiKey(
        newKeyName.trim(),
        newKeyUserId.trim(),
        newKeyExpiry ? new Date(newKeyExpiry).toISOString() : undefined,
      );
      setApiKeys((prev) => [{ ...created, isActive: true }, ...prev]);
      setCreatedKeyToken(created.token);
      setNewKeyName("");
      setNewKeyUserId("");
      setNewKeyExpiry("");
      toast.success(t("admin.apiKeyCreatedSuccess", { name: created.name }));
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, t("admin.apiKeyCreateFailed")));
    } finally {
      setNewKeyLoading(false);
    }
  }

  async function handleExportDatabase() {
    setExportLoading(true);
    try {
      const isDev =
        !isElectron() &&
        (window.location.port === "5173" ||
          window.location.hostname === "localhost" ||
          window.location.hostname === "127.0.0.1");

      const apiUrl = isElectron()
        ? `${window.configuredServerUrl}/database/export`
        : isDev
          ? `http://localhost:30001/database/export`
          : `${window.location.protocol}//${window.location.host}${getBasePath()}/database/export`;

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });

      if (response.ok) {
        const blob = await response.blob();
        const contentDisposition = response.headers.get("content-disposition");
        const filename =
          contentDisposition?.match(/filename="([^"]+)"/)?.[1] ||
          "termix-export.sqlite";
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        toast.success(t("admin.exportSuccess"));
      } else {
        const err = await response.json().catch(() => ({}));
        toast.error(err.error || t("admin.exportFailed"));
      }
    } catch {
      toast.error(t("admin.exportFailed"));
    } finally {
      setExportLoading(false);
    }
  }

  async function handleImportDatabase() {
    if (!importFile) {
      toast.error(t("admin.importSelectFile"));
      return;
    }
    setImportLoading(true);
    try {
      const isDev =
        !isElectron() &&
        (window.location.port === "5173" ||
          window.location.hostname === "localhost" ||
          window.location.hostname === "127.0.0.1");

      const apiUrl = isElectron()
        ? `${window.configuredServerUrl}/database/import`
        : isDev
          ? `http://localhost:30001/database/import`
          : `${window.location.protocol}//${window.location.host}${getBasePath()}/database/import`;

      const formData = new FormData();
      formData.append("file", importFile);

      const response = await fetch(apiUrl, {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          const s = result.summary;
          const total =
            (s.sshHostsImported || 0) +
            (s.sshCredentialsImported || 0) +
            (s.fileManagerItemsImported || 0) +
            (s.dismissedAlertsImported || 0) +
            (s.settingsImported || 0);
          toast.success(
            t("admin.importCompleted", { total, skipped: s.skippedItems || 0 }),
          );
          setImportFile(null);
          setTimeout(() => window.location.reload(), 1500);
        } else {
          toast.error(
            t("admin.importFailed", {
              error: result.summary?.errors?.join(", ") || "Unknown error",
            }),
          );
        }
      } else {
        const err = await response.json().catch(() => ({}));
        toast.error(err.error || t("admin.importError"));
      }
    } catch {
      toast.error(t("admin.importError"));
    } finally {
      setImportLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <AdminGeneralSettingsSection
        open={openSection === "general"}
        onToggle={() => toggle("general")}
        allowRegistration={allowRegistration}
        handleToggleRegistration={handleToggleRegistration}
        allowPasswordLogin={allowPasswordLogin}
        handleTogglePasswordLogin={handleTogglePasswordLogin}
        oidcAutoProvision={oidcAutoProvision}
        handleToggleOidcAutoProvision={handleToggleOidcAutoProvision}
        allowPasswordReset={allowPasswordReset}
        handleTogglePasswordReset={handleTogglePasswordReset}
        sessionTimeout={sessionTimeout}
        setSessionTimeout={setSessionTimeout}
        handleSaveSessionTimeout={handleSaveSessionTimeout}
        statusInterval={statusInterval}
        setStatusInterval={setStatusInterval}
        metricsInterval={metricsInterval}
        setMetricsInterval={setMetricsInterval}
        handleSaveMonitoring={handleSaveMonitoring}
        guacEnabled={guacEnabled}
        handleToggleGuacamole={handleToggleGuacamole}
        guacUrl={guacUrl}
        setGuacUrl={setGuacUrl}
        handleSaveGuacamole={handleSaveGuacamole}
        logLevel={logLevel}
        handleSaveLogLevel={handleSaveLogLevel}
      />

      <AdminOidcSettingsSection
        open={openSection === "oidc"}
        onToggle={() => toggle("oidc")}
        oidcClientId={oidcClientId}
        setOidcClientId={setOidcClientId}
        oidcClientSecret={oidcClientSecret}
        setOidcClientSecret={setOidcClientSecret}
        oidcAuthUrl={oidcAuthUrl}
        setOidcAuthUrl={setOidcAuthUrl}
        oidcIssuerUrl={oidcIssuerUrl}
        setOidcIssuerUrl={setOidcIssuerUrl}
        oidcTokenUrl={oidcTokenUrl}
        setOidcTokenUrl={setOidcTokenUrl}
        oidcUserIdentifier={oidcUserIdentifier}
        setOidcUserIdentifier={setOidcUserIdentifier}
        oidcDisplayName={oidcDisplayName}
        setOidcDisplayName={setOidcDisplayName}
        oidcScopes={oidcScopes}
        setOidcScopes={setOidcScopes}
        oidcUserinfoUrl={oidcUserinfoUrl}
        setOidcUserinfoUrl={setOidcUserinfoUrl}
        oidcAllowedUsers={oidcAllowedUsers}
        setOidcAllowedUsers={setOidcAllowedUsers}
        oidcSaving={oidcSaving}
        handleRemoveOidc={handleRemoveOidc}
        handleSaveOidc={handleSaveOidc}
      />

      {/* Users */}
      <AccordionSection
        label={t("admin.sectionUsers")}
        icon={<User className="size-3.5" />}
        open={openSection === "users"}
        onToggle={() => toggle("users")}
      >
        <div className="flex flex-col pt-2">
          <div className="flex items-center justify-between py-2 border-b border-border">
            <span className="text-[10px] text-muted-foreground">
              {t("admin.usersCount", { count: users.length })}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground hover:text-foreground"
                onClick={loadUsers}
              >
                <RefreshCw className="size-3" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                onClick={() => setCreateUserOpen(true)}
              >
                <Plus className="size-3" />
                {t("admin.createUser")}
              </Button>
            </div>
          </div>
          {users.map((user) => {
            const authLabel =
              user.isOidc && user.passwordHash
                ? t("admin.authTypeDual")
                : user.isOidc
                  ? t("admin.authTypeOidc")
                  : t("admin.authTypeLocal");
            return (
              <div
                key={user.id}
                className="flex items-center justify-between py-2.5 border-b border-border last:border-0"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="size-6 bg-muted border border-border flex items-center justify-center text-[10px] font-bold shrink-0">
                    {user.username[0].toUpperCase()}
                  </div>
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-xs font-semibold truncate max-w-[120px]">
                      {user.username}
                    </span>
                    <div className="flex items-center gap-1">
                      {user.isAdmin && (
                        <span className="text-[9px] font-semibold px-1 py-px border border-accent-brand/40 bg-accent-brand/10 text-accent-brand">
                          {t("admin.adminBadge")}
                        </span>
                      )}
                      <span className="text-[9px] font-semibold px-1 py-px border border-border text-muted-foreground">
                        {authLabel}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setEditUserTarget(user);
                      setEditUserOpen(true);
                    }}
                  >
                    <Pencil className="size-3" />
                  </Button>
                  {user.isOidc && !user.passwordHash && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setLinkAccountTarget({
                          id: user.id,
                          username: user.username,
                        });
                        setLinkAccountOpen(true);
                      }}
                    >
                      <Share2 className="size-3" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground hover:text-destructive"
                    disabled={user.isAdmin}
                    onClick={async () => {
                      try {
                        await deleteUser(user.username);
                        setUsers((prev) =>
                          prev.filter((u) => u.id !== user.id),
                        );
                        toast.success(
                          t("admin.deleteUserSuccess", {
                            username: user.username,
                          }),
                        );
                      } catch (e: unknown) {
                        toast.error(
                          apiErrorMessage(e, t("admin.deleteUserFailed")),
                        );
                      }
                    }}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </AccordionSection>

      {/* Sessions */}
      <AccordionSection
        label={t("admin.sectionSessions")}
        icon={<Activity className="size-3.5" />}
        open={openSection === "sessions"}
        onToggle={() => toggle("sessions")}
      >
        <div className="flex flex-col pt-2">
          <div className="flex items-center justify-between py-2 border-b border-border">
            <span className="text-[10px] text-muted-foreground">
              {t("admin.sessionsActive", { count: sessions.length })}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-foreground"
              onClick={loadSessions}
            >
              <RefreshCw className="size-3" />
            </Button>
          </div>
          {sessions.map((session) => (
            <div
              key={session.id}
              className="flex items-start justify-between py-2.5 border-b border-border last:border-0 gap-2"
            >
              <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-semibold">
                    {session.username}
                  </span>
                  {session.isCurrentSession && (
                    <span className="text-[9px] font-semibold px-1 py-px border border-accent-brand/40 bg-accent-brand/10 text-accent-brand">
                      {t("admin.youBadge")}
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground truncate">
                  {session.deviceInfo}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {t("admin.sessionActive", { time: session.lastActiveAt })}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {t("admin.sessionExpires", { time: session.expiresAt })}
                </span>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-[10px] text-muted-foreground hover:text-destructive h-6 px-1.5"
                  onClick={async () => {
                    try {
                      await revokeAllUserSessions(session.userId);
                      setSessions((prev) =>
                        prev.filter((s) => s.userId !== session.userId),
                      );
                      toast.success(t("admin.revokeAllSessionsSuccess"));
                    } catch {
                      toast.error(t("admin.revokeAllSessionsFailed"));
                    }
                  }}
                >
                  {t("admin.revokeAll")}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-muted-foreground hover:text-destructive"
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
            </div>
          ))}
        </div>
      </AccordionSection>

      {/* Roles */}
      <AccordionSection
        label={t("admin.sectionRoles")}
        icon={<KeyRound className="size-3.5" />}
        open={openSection === "roles"}
        onToggle={() => toggle("roles")}
      >
        <div className="flex flex-col pt-2">
          <div className="flex items-center justify-between py-2 border-b border-border">
            <span className="text-[10px] text-muted-foreground">
              {t("admin.rolesCount", { count: roles.length })}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10px] border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
              onClick={() => setShowCreateRole((o) => !o)}
            >
              <Plus className="size-3" />
              {t("admin.createRole")}
            </Button>
          </div>
          {showCreateRole && (
            <div className="flex flex-col gap-2.5 py-3 border-b border-border">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {t("admin.newRole")}
              </span>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                  {t("admin.roleName")}{" "}
                  <span className="text-accent-brand">*</span>
                </label>
                <Input
                  placeholder="e.g., developer"
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                  className="text-xs"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                  {t("admin.roleDisplayName")}{" "}
                  <span className="text-accent-brand">*</span>
                </label>
                <Input
                  placeholder="e.g., Developer"
                  value={newRoleDisplayName}
                  onChange={(e) => setNewRoleDisplayName(e.target.value)}
                  className="text-xs"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                  {t("admin.roleDescription")}
                </label>
                <textarea
                  rows={2}
                  placeholder={t("common.optional")}
                  value={newRoleDescription}
                  onChange={(e) => setNewRoleDescription(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => {
                    setShowCreateRole(false);
                    setNewRoleName("");
                    setNewRoleDisplayName("");
                    setNewRoleDescription("");
                  }}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                  onClick={handleCreateRole}
                  disabled={createRoleLoading}
                >
                  {createRoleLoading
                    ? t("admin.creating")
                    : t("admin.createRole")}
                </Button>
              </div>
            </div>
          )}
          {roles.map((role) => (
            <div
              key={role.id}
              className="flex items-center justify-between py-2.5 border-b border-border last:border-0"
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-semibold truncate">
                    {role.displayName}
                  </span>
                  {role.isSystem ? (
                    <span className="text-[9px] font-semibold px-1 py-px border border-border text-muted-foreground">
                      {t("admin.systemBadge")}
                    </span>
                  ) : (
                    <span className="text-[9px] font-semibold px-1 py-px border border-accent-brand/40 bg-accent-brand/10 text-accent-brand">
                      {t("admin.customBadge")}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {role.name}
                </span>
              </div>
              {!role.isSystem && (
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground hover:text-destructive"
                    onClick={async () => {
                      await deleteRole(role.id);
                      setRoles((prev) => prev.filter((r) => r.id !== role.id));
                      toast.success(
                        t("admin.deleteRoleSuccess", {
                          name: role.displayName,
                        }),
                      );
                    }}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </AccordionSection>

      <AdminDatabaseSection
        open={openSection === "database"}
        onToggle={() => toggle("database")}
        importFile={importFile}
        setImportFile={setImportFile}
        exportLoading={exportLoading}
        importLoading={importLoading}
        handleExportDatabase={handleExportDatabase}
        handleImportDatabase={handleImportDatabase}
      />

      {/* API Keys */}
      <AccordionSection
        label={t("admin.sectionApiKeys")}
        icon={<Network className="size-3.5" />}
        open={openSection === "api-keys"}
        onToggle={() => toggle("api-keys")}
      >
        <div className="flex flex-col pt-2">
          <div className="flex items-center justify-between py-2 border-b border-border">
            <span className="text-[10px] text-muted-foreground">
              {t("admin.apiKeysCount", { count: apiKeys.length })}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground hover:text-foreground"
                onClick={loadApiKeys}
              >
                <RefreshCw className="size-3" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                onClick={() => {
                  setShowCreateKey((o) => !o);
                  setCreatedKeyToken(null);
                }}
              >
                <Plus className="size-3" />
                {t("admin.createRole")}
              </Button>
            </div>
          </div>
          {showCreateKey && (
            <div className="flex flex-col gap-2.5 py-3 border-b border-border">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {t("admin.newApiKey")}
              </span>
              {createdKeyToken ? (
                <div className="flex flex-col gap-2">
                  <span className="text-[10px] text-accent-brand font-semibold">
                    {t("admin.apiKeyCreatedWarning")}
                  </span>
                  <div className="flex items-center gap-2 bg-muted/30 border border-border px-2 py-1.5">
                    <span className="text-[10px] font-mono flex-1 truncate">
                      {createdKeyToken}
                    </span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(createdKeyToken);
                        toast.info(t("admin.copiedToClipboard"));
                      }}
                      className="text-muted-foreground hover:text-accent-brand shrink-0"
                    >
                      <Copy className="size-3.5" />
                    </button>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs self-end"
                    onClick={() => {
                      setShowCreateKey(false);
                      setCreatedKeyToken(null);
                    }}
                  >
                    {t("admin.done")}
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                      {t("admin.apiKeyName")}{" "}
                      <span className="text-accent-brand">*</span>
                    </label>
                    <Input
                      placeholder="e.g., CI Pipeline"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                      {t("admin.apiKeyUser")}{" "}
                      <span className="text-accent-brand">*</span>
                    </label>
                    <select
                      className="px-2 py-1.5 text-xs bg-background border border-border text-foreground outline-none"
                      value={newKeyUserId}
                      onChange={(e) => setNewKeyUserId(e.target.value)}
                    >
                      <option value="">{t("admin.apiKeySelectUser")}</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.username}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                      {t("admin.apiKeyExpiresAt")}
                    </label>
                    <Input
                      type="date"
                      value={newKeyExpiry}
                      onChange={(e) => setNewKeyExpiry(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs"
                      onClick={() => setShowCreateKey(false)}
                    >
                      {t("common.cancel")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                      onClick={handleCreateApiKey}
                      disabled={newKeyLoading}
                    >
                      {newKeyLoading
                        ? t("admin.creating")
                        : t("admin.createKey")}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
          {apiKeys.map((key) => (
            <div
              key={key.id}
              className="flex items-start justify-between py-2.5 border-b border-border last:border-0 gap-2"
            >
              <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-semibold truncate">
                    {key.name}
                  </span>
                  {!key.isActive && (
                    <span className="text-[9px] font-semibold px-1 py-px border border-destructive/40 bg-destructive/10 text-destructive">
                      {t("admin.revokedBadge")}
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {t("admin.apiKeyUser")}: {key.username}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground truncate">
                  {key.tokenPrefix}…
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {key.createdAt.split("T")[0]} ·{" "}
                  {key.expiresAt
                    ? key.expiresAt.split("T")[0]
                    : t("admin.apiKeyNoExpiry")}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground hover:text-destructive shrink-0"
                onClick={async () => {
                  try {
                    await deleteApiKey(key.id);
                    setApiKeys((prev) => prev.filter((k) => k.id !== key.id));
                    toast.success(
                      t("admin.revokeKeySuccess", { name: key.name }),
                    );
                  } catch {
                    toast.error(t("admin.revokeKeyFailed"));
                  }
                }}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      </AccordionSection>

      {/* Create User Dialog */}
      <Dialog open={createUserOpen} onOpenChange={setCreateUserOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              {t("admin.createUserTitle")}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("admin.createUserDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 mt-1">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {t("admin.createUserUsername")}{" "}
                <span className="text-accent-brand">*</span>
              </label>
              <Input
                placeholder={t("admin.createUserEnterUsername")}
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateUser()}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {t("admin.createUserPassword")}{" "}
                <span className="text-accent-brand">*</span>
              </label>
              <div className="relative">
                <Input
                  type={showNewPassword ? "text" : "password"}
                  placeholder="Enter password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateUser()}
                  className="pr-9"
                />
                <button
                  onClick={() => setShowNewPassword((o) => !o)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showNewPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
              <span className="text-xs text-muted-foreground">
                {t("admin.createUserPasswordHint")}
              </span>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button
              variant="ghost"
              onClick={() => {
                setCreateUserOpen(false);
                setNewUsername("");
                setNewPassword("");
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="outline"
              className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
              onClick={handleCreateUser}
              disabled={createUserLoading}
            >
              {createUserLoading
                ? t("admin.creating")
                : t("admin.createUserSubmit")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={editUserOpen} onOpenChange={setEditUserOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              {t("admin.editUserTitle", { username: editUserTarget?.username })}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("admin.editUserDesc")}
            </DialogDescription>
          </DialogHeader>
          {editUserTarget && (
            <div className="flex flex-col gap-0 mt-1 divide-y divide-border">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 py-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
                    {t("admin.editUserUsername")}
                  </span>
                  <span className="text-sm font-semibold">
                    {editUserTarget.username}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
                    {t("admin.editUserAuthType")}
                  </span>
                  <span className="text-sm font-semibold">
                    {editUserTarget.isOidc && editUserTarget.passwordHash
                      ? t("admin.authTypeDual")
                      : editUserTarget.isOidc
                        ? t("admin.authTypeOidc")
                        : t("admin.authTypeLocal")}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
                    {t("admin.editUserAdminStatus")}
                  </span>
                  <span className="text-sm font-semibold">
                    {editUserTarget.isAdmin
                      ? t("admin.adminStatusAdministrator")
                      : t("admin.adminStatusRegularUser")}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
                    {t("admin.editUserUserId")}
                  </span>
                  <span className="text-xs font-mono text-muted-foreground truncate">
                    {editUserTarget.id}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between py-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">
                    {t("admin.userAdminAccess")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("admin.userAdminAccessDesc")}
                  </span>
                </div>
                <AdminToggle
                  on={editUserTarget.isAdmin}
                  onToggle={() => handleToggleAdmin(editUserTarget)}
                />
              </div>
              <div className="flex flex-col gap-2 py-3">
                <span className="text-sm font-medium">
                  {t("admin.userRoles")}
                </span>
                {editUserRolesLoading ? (
                  <span className="text-xs text-muted-foreground">
                    {t("newUi.sidebar.snippets.loading")}
                  </span>
                ) : (
                  <>
                    {editUserRoles.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {editUserRoles.map((ur) => {
                          const roleInfo = roles.find(
                            (r) => r.id === ur.roleId,
                          );
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
                                      await removeRoleFromUser(
                                        editUserTarget.id,
                                        ur.roleId,
                                      );
                                      setEditUserRoles((prev) =>
                                        prev.filter(
                                          (r) => r.roleId !== ur.roleId,
                                        ),
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
                    {roles.filter(
                      (r) =>
                        !r.isSystem &&
                        !editUserRoles.some((ur) => ur.roleId === r.id),
                    ).length > 0 && (
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
                          {t("admin.addRole")}
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {roles
                            .filter(
                              (r) =>
                                !r.isSystem &&
                                !editUserRoles.some((ur) => ur.roleId === r.id),
                            )
                            .map((r) => (
                              <button
                                key={r.id}
                                onClick={async () => {
                                  try {
                                    await assignRoleToUser(
                                      editUserTarget.id,
                                      r.id,
                                    );
                                    setEditUserRoles((prev) => [
                                      ...prev,
                                      {
                                        userId: editUserTarget.id,
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
                    )}
                    {editUserRoles.length === 0 &&
                      roles.filter((r) => !r.isSystem).length === 0 && (
                        <span className="text-xs text-muted-foreground">
                          {t("admin.noCustomRoles")}
                        </span>
                      )}
                  </>
                )}
              </div>
              <div className="flex items-center justify-between py-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">
                    {t("admin.revokeAllUserSessions")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("admin.revokeAllUserSessionsDesc")}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive shrink-0 ml-8"
                  onClick={() => handleRevokeUserSessions(editUserTarget.id)}
                  disabled={editUserLoading}
                >
                  {t("admin.revoke")}
                </Button>
              </div>
              <div className="flex flex-col gap-2 py-3">
                <div className="flex items-start gap-2.5 border border-destructive/30 bg-destructive/5 px-3 py-2.5">
                  <AlertCircle className="size-4 text-destructive shrink-0 mt-0.5" />
                  <span className="text-xs text-destructive">
                    {t("admin.deleteUserWarning")}
                  </span>
                </div>
                <Button
                  variant="outline"
                  className="w-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={editUserTarget.isAdmin || editUserLoading}
                  onClick={handleDeleteEditUser}
                >
                  <Trash2 className="size-3.5" />
                  {editUserLoading
                    ? t("admin.deleting")
                    : t("admin.deleteUser", {
                        username: editUserTarget.username,
                      })}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Link Account Dialog */}
      <Dialog open={linkAccountOpen} onOpenChange={setLinkAccountOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              {t("admin.linkAccountTitle")}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("admin.linkAccountDesc", {
                username: linkAccountTarget?.username,
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 mt-1">
            <div className="flex items-start gap-2.5 border border-destructive/30 bg-destructive/5 px-3 py-2.5">
              <AlertCircle className="size-4 text-destructive shrink-0 mt-0.5" />
              <div className="flex flex-col gap-1 text-xs text-destructive">
                <span>{t("admin.linkAccountWarningTitle")}</span>
                <ul className="list-disc list-inside space-y-0.5 ml-1">
                  <li>{t("admin.linkAccountEffect1")}</li>
                  <li>{t("admin.linkAccountEffect2")}</li>
                  <li>{t("admin.linkAccountEffect3")}</li>
                </ul>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {t("admin.linkAccountTargetUsername")}{" "}
                <span className="text-accent-brand">*</span>
              </label>
              <Input placeholder={t("admin.linkAccountTargetPlaceholder")} />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="ghost" onClick={() => setLinkAccountOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {t("admin.linkAccounts")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
