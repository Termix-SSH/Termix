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
  adminCreateUser,
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
  getOidcAutoProvision,
  updateOidcAutoProvision,
  getOidcSilentLoginDefault,
  updateOidcSilentLoginDefault,
  getCommandHistoryEnabled,
  updateCommandHistoryEnabled,
  isElectron,
  getUserRoles,
} from "@/main-axios";
import {
  getTailscaleSettings,
  updateTailscaleSettings,
  getHostDefaults,
  updateHostDefaults,
  type HostDefaults,
} from "@/api/settings-api";
import {
  getAcmeSslSettings,
  updateAcmeSslSettings,
  requestAcmeCertificate,
  type AcmeSettings,
} from "@/api/acme-ssl-api";
import {
  getAdminSSOProviders,
  updateSSOProvider,
  deleteSSOProvider,
} from "@/api/sso-provider-api";
import {
  getMetricsHistoryRetention,
  saveMetricsHistoryRetention,
} from "@/api/host-metrics-api";
import type { SSOProvider } from "@/types/index";
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
  AdminHostDefaultsSection,
  AdminSSOSection,
  AdminSSLSection,
} from "./AdminSettingsSections";
import { SSOProviderDialog } from "./SSOProviderDialog";
import { AdminApiKeysSection } from "./AdminApiKeysSection";
import { AdminAuditLogSection } from "./AdminAuditLogSection";
import {
  AdminCreateUserDialog,
  AdminEditUserDialog,
  AdminLinkAccountDialog,
  AdminUnlinkAccountDialog,
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
  const [metricsHistoryRetention, setMetricsHistoryRetention] = useState("7");
  const [guacEnabled, setGuacEnabled] = useState(false);
  const [guacUrl, setGuacUrl] = useState("guacd:4822");
  const [logLevel, setLogLevel] = useState("info");
  const [tailscaleApiKey, setTailscaleApiKey] = useState("");
  const [commandHistoryEnabled, setCommandHistoryEnabled] = useState(true);
  const [hostDefaults, setHostDefaults] = useState<HostDefaults>({});

  // SSO / auto-provision state
  const [oidcAutoProvision, setOidcAutoProvision] = useState(false);
  const [oidcSilentLoginDefault, setOidcSilentLoginDefault] = useState(false);
  const [ssoProviders, setSsoProviders] = useState<SSOProvider[]>([]);
  const [ssoDialogOpen, setSsoDialogOpen] = useState(false);
  const [ssoDialogProvider, setSsoDialogProvider] =
    useState<SSOProvider | null>(null);

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
    isOidc: boolean;
  } | null>(null);

  // Unlink account dialog
  const [unlinkAccountOpen, setUnlinkAccountOpen] = useState(false);
  const [unlinkAccountTarget, setUnlinkAccountTarget] = useState<{
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

  // ACME SSL state
  const defaultAcmeSettings: AcmeSettings = {
    enabled: false,
    domain: "",
    email: "",
    challengeType: "http-webroot",
    cloudflareToken: "",
    lastIssuedAt: null,
    certStatus: "none",
    certExpiresAt: null,
  };
  const [acmeSettings, setAcmeSettings] =
    useState<AcmeSettings>(defaultAcmeSettings);
  const [cloudflareTokenDraft, setCloudflareTokenDraft] = useState("");
  const [acmeRequesting, setAcmeRequesting] = useState(false);

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
    loadSSOProviders();
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
        oidcSilent,
        tailscale,
        cmdHistory,
      ] = await Promise.allSettled([
        getRegistrationAllowed(),
        getPasswordLoginAllowed(),
        getPasswordResetAllowed(),
        getSessionTimeout(),
        getGlobalMonitoringSettings(),
        getLogLevel(),
        getGuacamoleSettings(),
        getOidcAutoProvision(),
        getOidcSilentLoginDefault(),
        getTailscaleSettings(),
        getCommandHistoryEnabled(),
      ]);

      if (reg.status === "fulfilled") setAllowRegistration(reg.value.allowed);
      if (pwLogin.status === "fulfilled")
        setAllowPasswordLogin(pwLogin.value.allowed);
      if (oidcProv.status === "fulfilled")
        setOidcAutoProvision(oidcProv.value.enabled);
      if (oidcSilent.status === "fulfilled")
        setOidcSilentLoginDefault(oidcSilent.value.enabled);
      if (pwReset.status === "fulfilled") setAllowPasswordReset(pwReset.value);
      if (timeout.status === "fulfilled")
        setSessionTimeout(String(timeout.value.timeoutHours));
      if (monitoring.status === "fulfilled") {
        setStatusInterval(String(monitoring.value.statusCheckInterval));
        setMetricsInterval(String(monitoring.value.metricsInterval));
      }

      getMetricsHistoryRetention()
        .then((days) => setMetricsHistoryRetention(String(days)))
        .catch(() => {});
      if (level.status === "fulfilled") setLogLevel(level.value.level);
      if (guac.status === "fulfilled") {
        setGuacEnabled(guac.value.enabled);
        setGuacUrl(guac.value.url || "guacd:4822");
      }
      if (tailscale.status === "fulfilled") {
        setTailscaleApiKey(tailscale.value.apiKey ?? "");
      }
      if (cmdHistory.status === "fulfilled") {
        setCommandHistoryEnabled(cmdHistory.value.enabled);
      }
    } catch {
      // non-fatal
    }

    getHostDefaults()
      .then((d) => setHostDefaults(d))
      .catch(() => {});

    getAcmeSslSettings()
      .then((s) => setAcmeSettings(s))
      .catch(() => {});
  }

  async function loadSSOProviders() {
    try {
      const providers = await getAdminSSOProviders();
      setSsoProviders(providers);
    } catch {
      // non-fatal
    }
  }

  function toggle(id: AdminSection) {
    setOpenSection((prev) => (prev === id ? null : id));
  }

  async function handleSaveHostDefaults() {
    try {
      await updateHostDefaults(hostDefaults);
      toast.success(t("admin.hostDefaultsSaved"));
    } catch {
      toast.error(t("admin.hostDefaultsSaveFailed"));
    }
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
    } catch (e) {
      setAllowPasswordLogin(!newVal);
      const msg = (e as ApiErrorLike).response?.data?.error;
      toast.error(msg || t("admin.updatePasswordLoginFailed"));
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

  async function handleToggleOidcSilentLoginDefault() {
    const newVal = !oidcSilentLoginDefault;
    setOidcSilentLoginDefault(newVal);
    try {
      await updateOidcSilentLoginDefault(newVal);
    } catch {
      setOidcSilentLoginDefault(!newVal);
      toast.error(t("admin.updateOidcSilentLoginDefaultFailed"));
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

  async function handleToggleCommandHistory() {
    const newVal = !commandHistoryEnabled;
    setCommandHistoryEnabled(newVal);
    try {
      await updateCommandHistoryEnabled(newVal);
    } catch {
      setCommandHistoryEnabled(!newVal);
      toast.error(t("admin.updateCommandHistoryFailed"));
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
    const retention = parseInt(metricsHistoryRetention, 10);
    if (isNaN(status) || isNaN(metrics)) {
      toast.error(t("admin.monitoringIntervalInvalid"));
      return;
    }
    if (!isNaN(retention) && (retention < 1 || retention > 90)) {
      toast.error(t("admin.metricsHistoryRetentionRange"));
      return;
    }
    try {
      await Promise.all([
        updateGlobalMonitoringSettings({
          statusCheckInterval: status,
          metricsInterval: metrics,
        }),
        !isNaN(retention)
          ? saveMetricsHistoryRetention(retention)
          : Promise.resolve(),
      ]);
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

  async function handleSaveTailscaleApiKey() {
    try {
      await updateTailscaleSettings(tailscaleApiKey);
      toast.success(t("admin.tailscaleSettingsSaved"));
    } catch {
      toast.error(t("admin.tailscaleSettingsSaveFailed"));
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

  function handleAddProvider() {
    setSsoDialogProvider(null);
    setSsoDialogOpen(true);
  }

  function handleEditProvider(provider: SSOProvider) {
    setSsoDialogProvider(provider);
    setSsoDialogOpen(true);
  }

  async function handleDeleteProvider(id: number) {
    if (!window.confirm(t("admin.ssoDeleteConfirm"))) return;
    try {
      await deleteSSOProvider(id);
      setSsoProviders((prev) => prev.filter((p) => p.id !== id));
      toast.success(t("common.deleted"));
    } catch (e) {
      toast.error(apiErrorMessage(e, t("common.deleteFailed")));
    }
  }

  async function handleToggleProviderEnabled(id: number, enabled: boolean) {
    const provider = ssoProviders.find((p) => p.id === id);
    if (!provider) return;
    setSsoProviders((prev) =>
      prev.map((p) => (p.id === id ? { ...p, enabled } : p)),
    );
    try {
      await updateSSOProvider(id, { enabled });
    } catch (e) {
      setSsoProviders((prev) =>
        prev.map((p) => (p.id === id ? { ...p, enabled: !enabled } : p)),
      );
      toast.error(apiErrorMessage(e, t("common.saveFailed")));
    }
  }

  async function handleSaveAcmeSettings() {
    try {
      const payload: Parameters<typeof updateAcmeSslSettings>[0] = {
        enabled: acmeSettings.enabled,
        domain: acmeSettings.domain,
        email: acmeSettings.email,
        challengeType: acmeSettings.challengeType,
        ...(cloudflareTokenDraft && { cloudflareToken: cloudflareTokenDraft }),
      };
      const updated = await updateAcmeSslSettings(payload);
      setAcmeSettings(updated);
      setCloudflareTokenDraft("");
      toast.success(t("admin.sslSaved"));
    } catch {
      toast.error(t("admin.sslSaveFailed"));
    }
  }

  async function handleRequestAcmeCertificate() {
    if (!acmeSettings.domain || !acmeSettings.email) {
      toast.error(t("admin.sslRequiresDomain"));
      return;
    }
    setAcmeRequesting(true);
    try {
      if (cloudflareTokenDraft) {
        await updateAcmeSslSettings({
          domain: acmeSettings.domain,
          email: acmeSettings.email,
          challengeType: acmeSettings.challengeType,
          cloudflareToken: cloudflareTokenDraft,
        });
        setCloudflareTokenDraft("");
      }
      const result = await requestAcmeCertificate();
      setAcmeSettings(result);
      toast.success(t("admin.sslRequestCertSuccess"));
    } catch (e) {
      toast.error(apiErrorMessage(e, t("admin.sslRequestCertFailed")));
    } finally {
      setAcmeRequesting(false);
    }
  }

  function handleProviderSaved(saved: SSOProvider) {
    setSsoProviders((prev) => {
      const idx = prev.findIndex((p) => p.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
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
      await adminCreateUser(newUsername.trim(), newPassword);
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
        oidcSilentLoginDefault={oidcSilentLoginDefault}
        handleToggleOidcSilentLoginDefault={handleToggleOidcSilentLoginDefault}
        allowPasswordReset={allowPasswordReset}
        handleTogglePasswordReset={handleTogglePasswordReset}
        commandHistoryEnabled={commandHistoryEnabled}
        handleToggleCommandHistory={handleToggleCommandHistory}
        sessionTimeout={sessionTimeout}
        setSessionTimeout={setSessionTimeout}
        handleSaveSessionTimeout={handleSaveSessionTimeout}
        statusInterval={statusInterval}
        setStatusInterval={setStatusInterval}
        metricsInterval={metricsInterval}
        setMetricsInterval={setMetricsInterval}
        metricsHistoryRetention={metricsHistoryRetention}
        setMetricsHistoryRetention={setMetricsHistoryRetention}
        handleSaveMonitoring={handleSaveMonitoring}
        guacEnabled={guacEnabled}
        handleToggleGuacamole={handleToggleGuacamole}
        guacUrl={guacUrl}
        setGuacUrl={setGuacUrl}
        handleSaveGuacamole={handleSaveGuacamole}
        logLevel={logLevel}
        handleSaveLogLevel={handleSaveLogLevel}
        tailscaleApiKey={tailscaleApiKey}
        setTailscaleApiKey={setTailscaleApiKey}
        handleSaveTailscaleApiKey={handleSaveTailscaleApiKey}
      />

      <AdminSSOSection
        open={openSection === "sso"}
        onToggle={() => toggle("sso")}
        providers={ssoProviders}
        onAddProvider={handleAddProvider}
        onEditProvider={handleEditProvider}
        onDeleteProvider={handleDeleteProvider}
        onToggleEnabled={handleToggleProviderEnabled}
      />

      <SSOProviderDialog
        open={ssoDialogOpen}
        onOpenChange={setSsoDialogOpen}
        provider={ssoDialogProvider}
        onSaved={handleProviderSaved}
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
        setUnlinkAccountTarget={setUnlinkAccountTarget}
        setUnlinkAccountOpen={setUnlinkAccountOpen}
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

      <AdminHostDefaultsSection
        open={openSection === "host-defaults"}
        onToggle={() => toggle("host-defaults")}
        defaults={hostDefaults}
        setDefaults={setHostDefaults}
        handleSaveDefaults={handleSaveHostDefaults}
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

      <AdminSSLSection
        open={openSection === "ssl"}
        onToggle={() => toggle("ssl")}
        settings={acmeSettings}
        setSettings={setAcmeSettings}
        cloudflareTokenDraft={cloudflareTokenDraft}
        setCloudflareTokenDraft={setCloudflareTokenDraft}
        requesting={acmeRequesting}
        handleSave={handleSaveAcmeSettings}
        handleRequest={handleRequestAcmeCertificate}
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

      <AdminAuditLogSection
        open={openSection === "audit-log"}
        onToggle={() => toggle("audit-log")}
        users={users}
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
        users={users}
      />

      <AdminUnlinkAccountDialog
        open={unlinkAccountOpen}
        onOpenChange={setUnlinkAccountOpen}
        unlinkAccountTarget={unlinkAccountTarget}
        onSuccess={(userId) =>
          setUsers((prev) =>
            prev.map((u) =>
              u.id === userId
                ? { ...u, isOidc: false, passwordHash: undefined }
                : u,
            ),
          )
        }
      />
    </div>
  );
}
