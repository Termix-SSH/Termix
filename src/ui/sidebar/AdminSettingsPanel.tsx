import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  getUserList,
  getSessions,
  getRoles,
  getApiKeys,
  createApiKey,
  deleteUser,
  revokeAllUserSessions,
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
} from "@/main-axios";
import type { ApiKey, CreatedApiKey, UserRole } from "@/main-axios";
import type { AdminSection } from "@/types/ui-types";
import type { Role } from "@/main-axios";
import {
  AdminRolesSection,
  AdminSessionsSection,
  AdminUsersSection,
  type AdminSession,
  type AdminUser,
} from "./AdminManagementSections";
import { toast } from "sonner";
import { getBasePath } from "@/lib/base-path";
import {
  AdminDatabaseSection,
  AdminGeneralSettingsSection,
  AdminOidcSettingsSection,
} from "./AdminSettingsSections";
import { AdminApiKeysSection } from "./AdminApiKeysSection";
import {
  AdminCreateUserDialog,
  AdminEditUserDialog,
  AdminLinkAccountDialog,
} from "./AdminUserDialogs";

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

      <AdminUsersSection
        open={openSection === "users"}
        onToggle={() => toggle("users")}
        users={users}
        setUsers={setUsers}
        loadUsers={loadUsers}
        setCreateUserOpen={setCreateUserOpen}
        setEditUserTarget={setEditUserTarget}
        setEditUserOpen={setEditUserOpen}
        setLinkAccountTarget={setLinkAccountTarget}
        setLinkAccountOpen={setLinkAccountOpen}
      />

      <AdminSessionsSection
        open={openSection === "sessions"}
        onToggle={() => toggle("sessions")}
        sessions={sessions}
        setSessions={setSessions}
        loadSessions={loadSessions}
      />

      <AdminRolesSection
        open={openSection === "roles"}
        onToggle={() => toggle("roles")}
        roles={roles}
        setRoles={setRoles}
        showCreateRole={showCreateRole}
        setShowCreateRole={setShowCreateRole}
        newRoleName={newRoleName}
        setNewRoleName={setNewRoleName}
        newRoleDisplayName={newRoleDisplayName}
        setNewRoleDisplayName={setNewRoleDisplayName}
        newRoleDescription={newRoleDescription}
        setNewRoleDescription={setNewRoleDescription}
        handleCreateRole={handleCreateRole}
        createRoleLoading={createRoleLoading}
      />

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

      <AdminApiKeysSection
        open={openSection === "api-keys"}
        onToggle={() => toggle("api-keys")}
        apiKeys={apiKeys}
        setApiKeys={setApiKeys}
        loadApiKeys={loadApiKeys}
        showCreateKey={showCreateKey}
        setShowCreateKey={setShowCreateKey}
        createdKeyToken={createdKeyToken}
        setCreatedKeyToken={setCreatedKeyToken}
        newKeyName={newKeyName}
        setNewKeyName={setNewKeyName}
        newKeyUserId={newKeyUserId}
        setNewKeyUserId={setNewKeyUserId}
        newKeyExpiry={newKeyExpiry}
        setNewKeyExpiry={setNewKeyExpiry}
        users={users}
        handleCreateApiKey={handleCreateApiKey}
        newKeyLoading={newKeyLoading}
      />

      <AdminCreateUserDialog
        open={createUserOpen}
        onOpenChange={setCreateUserOpen}
        newUsername={newUsername}
        setNewUsername={setNewUsername}
        newPassword={newPassword}
        setNewPassword={setNewPassword}
        showNewPassword={showNewPassword}
        setShowNewPassword={setShowNewPassword}
        handleCreateUser={handleCreateUser}
        createUserLoading={createUserLoading}
      />

      <AdminEditUserDialog
        open={editUserOpen}
        onOpenChange={setEditUserOpen}
        editUserTarget={editUserTarget}
        editUserLoading={editUserLoading}
        editUserRoles={editUserRoles}
        editUserRolesLoading={editUserRolesLoading}
        roles={roles}
        setEditUserRoles={setEditUserRoles}
        handleToggleAdmin={handleToggleAdmin}
        handleRevokeUserSessions={handleRevokeUserSessions}
        handleDeleteEditUser={handleDeleteEditUser}
      />

      <AdminLinkAccountDialog
        open={linkAccountOpen}
        onOpenChange={setLinkAccountOpen}
        linkAccountTarget={linkAccountTarget}
        setUsers={setUsers}
      />
    </div>
  );
}
