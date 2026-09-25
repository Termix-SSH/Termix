import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useBranding } from "@/contexts/BrandingContext";
import {
  getNotificationPrivateEndpoints,
  setNotificationPrivateEndpoints as setNotificationPrivateEndpointsApi,
} from "@/api/private-endpoints-api";
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
  getStatusCheckSettings,
  updateStatusCheckSettings,
  getLogLevel,
  updateLogLevel,
  getOidcAutoProvision,
  updateOidcAutoProvision,
  getSecondFactorAfterExternalLogin,
  updateSecondFactorAfterExternalLogin,
  getOidcSilentLoginDefault,
  updateOidcSilentLoginDefault,
  isElectron,
  getUserRoles,
} from "@/main-axios";
import {
  getHostDefaults,
  updateHostDefaults,
  getAnalyticsEnabled,
  updateAnalyticsEnabled,
  getBranding,
  updateBranding,
  type HostDefaults,
  type BrandingSettings,
} from "@/api/settings-api";
import {
  getTlsStatus,
  uploadTlsCertificate,
  type TlsStatus,
} from "@/api/tls-api";
import {
  type ApiKey,
  type CreatedApiKey,
  type Role,
  type UserRole,
} from "@/main-axios";
import { type AdminSection, type Host } from "@/types/ui-types";
import {
  FeatureSettingsSection,
  featureSectionId,
  useFeatureSettings,
  type FeatureSectionId,
} from "@/settings/FeatureSettingsSections";
import {
  AdminRolesSection,
  AdminSessionsSection,
  AdminUsersSection,
  type AdminSession,
  type AdminUser,
} from "./AdminManagementSections";
import { toast } from "sonner";
import { getDatabaseTransferUrl } from "@/lib/database-transfer-url";
import {
  AdminDatabaseSection,
  AdminGeneralSettingsSection,
  AdminHostDefaultsSection,
  AdminSSLSection,
} from "./AdminSettingsSections";
import { AdminApiKeysSection } from "./AdminApiKeysSection";
import { AdminAuditLogSection } from "./AdminAuditLogSection";
import {
  AdminCreateUserDialog,
  AdminEditUserDialog,
  AdminLinkAccountDialog,
  AdminUnlinkAccountDialog,
} from "./AdminUserDialogs";
import { AdminUserManagePanel } from "./AdminUserManagePanel";
import { AdminBrandingSection } from "./AdminBrandingSection";

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

const USERS_PAGE_SIZE = 25;

export function AdminSettingsPanel({
  onEditingChange,
  onOpenHostTab,
}: {
  onEditingChange?: (editing: boolean) => void;
  onOpenHostTab?: (host: Host) => void;
} = {}) {
  const { t } = useTranslation();
  const [openSections, setOpenSections] = useState<
    Set<AdminSection | FeatureSectionId>
  >(() => new Set(["general"]));
  const featureSettings = useFeatureSettings("admin");
  const [manageUser, setManageUser] = useState<AdminUser | null>(null);
  const [allowRegistration, setAllowRegistration] = useState(true);
  const [allowPasswordLogin, setAllowPasswordLogin] = useState(true);
  const [passwordLoginForced, setPasswordLoginForced] = useState(false);
  const [allowPasswordReset, setAllowPasswordReset] = useState(true);
  const [sessionTimeout, setSessionTimeout] = useState("24");
  const [statusInterval, setStatusInterval] = useState("60");
  const [logLevel, setLogLevel] = useState("info");
  const [analyticsEnabled, setAnalyticsEnabled] = useState(true);
  const [analyticsLocked, setAnalyticsLocked] = useState(false);
  const [oidcSilentLoginDefaultLocked, setOidcSilentLoginDefaultLocked] =
    useState(false);
  const [notificationPrivateEndpoints, setNotificationPrivateEndpoints] =
    useState<string[]>([]);
  const [hostDefaults, setHostDefaults] = useState<HostDefaults>({});

  // Terminal image storage state. localDir stays a draft: the API never
  // returns the configured backend path, so it is only sent when changed.

  const [brandingSettings, setBrandingSettings] =
    useState<BrandingSettings | null>(null);
  const [brandingSaving, setBrandingSaving] = useState(false);
  const { applyBranding } = useBranding();

  // External login state
  const [oidcAutoProvision, setOidcAutoProvision] = useState(false);
  const [secondFactorAfterExternalLogin, setSecondFactorAfterExternalLogin] =
    useState(false);
  const [oidcSilentLoginDefault, setOidcSilentLoginDefault] = useState(false);

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

  const [tlsStatus, setTlsStatus] = useState<TlsStatus | null>(null);
  const [manualCertDraft, setManualCertDraft] = useState("");
  const [manualKeyDraft, setManualKeyDraft] = useState("");
  const [manualUploading, setManualUploading] = useState(false);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [userPage, setUserPage] = useState(0);
  const [userTotal, setUserTotal] = useState(0);
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);

  useEffect(() => {
    loadSessions();
    loadRoles();
    loadApiKeys();
    loadGeneralSettings();
  }, []);

  // Debounced so typing in the search box does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(loadUsers, userSearch ? 250 : 0);
    return () => clearTimeout(timer);
  }, [userSearch, userPage]);

  // A new search term starts again from the first page.
  useEffect(() => {
    setUserPage(0);
  }, [userSearch]);

  useEffect(() => {
    onEditingChange?.(manageUser !== null);
    return () => onEditingChange?.(false);
  }, [manageUser, onEditingChange]);

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
    // Paged server-side so an install with thousands of accounts does not
    // ship the whole directory to render one screen of it.
    getUserList({
      search: userSearch.trim() || undefined,
      limit: USERS_PAGE_SIZE,
      offset: userPage * USERS_PAGE_SIZE,
    })
      .then(({ users: u, total }) => {
        setUsers(
          u.map((user) => ({
            id: user.userId,
            username: user.username,
            isAdmin: user.is_admin,
            isOidc: user.is_oidc,
            passwordHash: user.password_hash,
            dataUnlocked: user.data_unlocked,
            secondFactorEnabled: user.second_factor_enabled,
          })),
        );
        setUserTotal(total ?? u.length);
      })
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
        oidcProv,
        secondFactorExternal,
        oidcSilent,
        analytics,
        notificationEndpoints,
        branding,
      ] = await Promise.allSettled([
        getRegistrationAllowed(),
        getPasswordLoginAllowed(),
        getPasswordResetAllowed(),
        getSessionTimeout(),
        getStatusCheckSettings(),
        getLogLevel(),
        getOidcAutoProvision(),
        getSecondFactorAfterExternalLogin(),
        getOidcSilentLoginDefault(),
        getAnalyticsEnabled(),
        getNotificationPrivateEndpoints(),
        getBranding(),
      ]);

      if (reg.status === "fulfilled") setAllowRegistration(reg.value.allowed);
      if (pwLogin.status === "fulfilled") {
        // When forced on, the setting itself is off; show that and warn.
        setPasswordLoginForced(!!pwLogin.value.forced);
        setAllowPasswordLogin(
          pwLogin.value.forced ? false : pwLogin.value.allowed,
        );
      }
      if (oidcProv.status === "fulfilled")
        setOidcAutoProvision(oidcProv.value.enabled);
      if (secondFactorExternal.status === "fulfilled")
        setSecondFactorAfterExternalLogin(secondFactorExternal.value.enabled);
      if (oidcSilent.status === "fulfilled") {
        setOidcSilentLoginDefault(oidcSilent.value.enabled);
        setOidcSilentLoginDefaultLocked(oidcSilent.value.locked ?? false);
      }
      if (pwReset.status === "fulfilled") setAllowPasswordReset(pwReset.value);
      if (timeout.status === "fulfilled")
        setSessionTimeout(String(timeout.value.timeoutHours));
      if (monitoring.status === "fulfilled") {
        setStatusInterval(String(monitoring.value.statusCheckInterval));
      }

      if (level.status === "fulfilled") setLogLevel(level.value.level);
      if (analytics.status === "fulfilled") {
        setAnalyticsEnabled(analytics.value.enabled);
        setAnalyticsLocked(analytics.value.locked ?? false);
      }
      if (notificationEndpoints.status === "fulfilled") {
        setNotificationPrivateEndpoints(notificationEndpoints.value);
      }
      if (branding.status === "fulfilled") {
        setBrandingSettings(branding.value);
      }
    } catch {
      // non-fatal
    }

    getHostDefaults()
      .then((d) => setHostDefaults(d))
      .catch(() => {});

    getTlsStatus()
      .then((s) => setTlsStatus(s))
      .catch(() => {});
  }

  function toggle(id: AdminSection | FeatureSectionId) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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

  async function handleToggleSecondFactorAfterExternalLogin() {
    const newVal = !secondFactorAfterExternalLogin;
    setSecondFactorAfterExternalLogin(newVal);
    try {
      await updateSecondFactorAfterExternalLogin(newVal);
    } catch {
      setSecondFactorAfterExternalLogin(!newVal);
      toast.error(t("admin.updateSecondFactorAfterExternalLoginFailed"));
    }
  }

  async function handleToggleOidcSilentLoginDefault() {
    if (oidcSilentLoginDefaultLocked) return;
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

  async function handleToggleAnalytics() {
    if (analyticsLocked) return;
    const newVal = !analyticsEnabled;
    setAnalyticsEnabled(newVal);
    try {
      await updateAnalyticsEnabled(newVal);
    } catch {
      setAnalyticsEnabled(!newVal);
      toast.error(t("admin.updateAnalyticsFailed"));
    }
  }

  async function handleSaveNotificationPrivateEndpoints(hosts: string[]) {
    const previous = notificationPrivateEndpoints;
    setNotificationPrivateEndpoints(hosts);
    try {
      setNotificationPrivateEndpoints(
        await setNotificationPrivateEndpointsApi(hosts),
      );
    } catch {
      setNotificationPrivateEndpoints(previous);
      toast.error(t("admin.updateNotificationEndpointsFailed"));
    }
  }

  async function handleSaveBranding() {
    if (!brandingSettings) return;
    setBrandingSaving(true);
    try {
      const saved = await updateBranding({
        appName: brandingSettings.appName,
        tagline: brandingSettings.tagline,
        logo: brandingSettings.logo,
      });
      setBrandingSettings(saved);
      applyBranding(saved);
      toast.success(t("admin.brandingSaved"));
    } catch (e) {
      toast.error(apiErrorMessage(e, t("admin.brandingSaveFailed")));
    } finally {
      setBrandingSaving(false);
    }
  }

  async function handleResetBrandingLogo() {
    if (!brandingSettings) return;
    setBrandingSaving(true);
    try {
      const saved = await updateBranding({ logo: null });
      setBrandingSettings(saved);
      applyBranding(saved);
      toast.success(t("admin.brandingSaved"));
    } catch (e) {
      toast.error(apiErrorMessage(e, t("admin.brandingSaveFailed")));
    } finally {
      setBrandingSaving(false);
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
    if (isNaN(status) || status < 5 || status > 3600) {
      toast.error(t("admin.monitoringIntervalInvalid"));
      return;
    }
    try {
      await updateStatusCheckSettings({ statusCheckInterval: status });
      toast.success(t("admin.monitoringSaved"));
    } catch {
      toast.error(t("admin.monitoringSaveFailed"));
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

  async function handleManualSslUpload() {
    if (!manualCertDraft.trim() || !manualKeyDraft.trim()) {
      toast.error(t("admin.sslManualRequiresFields"));
      return;
    }
    setManualUploading(true);
    try {
      const result = await uploadTlsCertificate({
        certificate: manualCertDraft,
        privateKey: manualKeyDraft,
      });
      setTlsStatus(result);
      setManualCertDraft("");
      setManualKeyDraft("");
      toast.success(t("admin.sslManualUploadSuccess"));
      if (result.reloadMessage) {
        toast.info(result.reloadMessage);
      }
    } catch (e) {
      toast.error(apiErrorMessage(e, t("admin.sslManualUploadFailed")));
    } finally {
      setManualUploading(false);
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
      const apiUrl = getDatabaseTransferUrl("export", {
        electron: isElectron(),
        configuredServerUrl: null,
        location: window.location,
      });

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
      const apiUrl = getDatabaseTransferUrl("import", {
        electron: isElectron(),
        configuredServerUrl: null,
        location: window.location,
      });

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
            (s.pluginItemsImported || 0) +
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

  if (manageUser) {
    return (
      <AdminUserManagePanel
        key={manageUser.id}
        user={manageUser}
        roles={roles}
        onBack={() => setManageUser(null)}
        onOpenHostTab={onOpenHostTab}
        onUserDeleted={() => {
          setUsers((prev) => prev.filter((u) => u.id !== manageUser.id));
          setManageUser(null);
        }}
        onSecondFactorsReset={() => {
          setUsers((prev) =>
            prev.map((u) =>
              u.id === manageUser.id ? { ...u, secondFactorEnabled: false } : u,
            ),
          );
        }}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 p-3 flex-1 min-h-0 overflow-y-auto">
      <AdminGeneralSettingsSection
        open={openSections.has("general")}
        onToggle={() => toggle("general")}
        analyticsEnabled={analyticsEnabled}
        analyticsLocked={analyticsLocked}
        handleToggleAnalytics={handleToggleAnalytics}
        notificationPrivateEndpoints={notificationPrivateEndpoints}
        onSaveNotificationPrivateEndpoints={
          handleSaveNotificationPrivateEndpoints
        }
        allowRegistration={allowRegistration}
        handleToggleRegistration={handleToggleRegistration}
        allowPasswordLogin={allowPasswordLogin}
        passwordLoginForced={passwordLoginForced && !allowPasswordLogin}
        handleTogglePasswordLogin={handleTogglePasswordLogin}
        oidcAutoProvision={oidcAutoProvision}
        handleToggleOidcAutoProvision={handleToggleOidcAutoProvision}
        secondFactorAfterExternalLogin={secondFactorAfterExternalLogin}
        handleToggleSecondFactorAfterExternalLogin={
          handleToggleSecondFactorAfterExternalLogin
        }
        oidcSilentLoginDefault={oidcSilentLoginDefault}
        oidcSilentLoginDefaultLocked={oidcSilentLoginDefaultLocked}
        handleToggleOidcSilentLoginDefault={handleToggleOidcSilentLoginDefault}
        allowPasswordReset={allowPasswordReset}
        handleTogglePasswordReset={handleTogglePasswordReset}
        sessionTimeout={sessionTimeout}
        setSessionTimeout={setSessionTimeout}
        handleSaveSessionTimeout={handleSaveSessionTimeout}
        statusInterval={statusInterval}
        setStatusInterval={setStatusInterval}
        handleSaveMonitoring={handleSaveMonitoring}
        logLevel={logLevel}
        handleSaveLogLevel={handleSaveLogLevel}
      />

      <AdminUsersSection
        open={openSections.has("users")}
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
        onManageUser={setManageUser}
        search={userSearch}
        onSearchChange={setUserSearch}
        page={userPage}
        pageSize={USERS_PAGE_SIZE}
        total={userTotal}
        onPageChange={setUserPage}
      />

      <AdminSessionsSection
        open={openSections.has("sessions")}
        onToggle={() => toggle("sessions")}
        sessions={sessions}
        setSessions={setSessions}
        loadSessions={loadSessions}
      />

      <AdminRolesSection
        open={openSections.has("roles")}
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
        open={openSections.has("host-defaults")}
        onToggle={() => toggle("host-defaults")}
        defaults={hostDefaults}
        setDefaults={setHostDefaults}
        handleSaveDefaults={handleSaveHostDefaults}
      />

      <AdminBrandingSection
        open={openSections.has("branding")}
        onToggle={() => toggle("branding")}
        settings={brandingSettings}
        setSettings={setBrandingSettings}
        saving={brandingSaving}
        onSave={() => void handleSaveBranding()}
        onResetLogo={() => void handleResetBrandingLogo()}
      />

      <AdminDatabaseSection
        open={openSections.has("database")}
        onToggle={() => toggle("database")}
        importFile={importFile}
        setImportFile={setImportFile}
        exportLoading={exportLoading}
        importLoading={importLoading}
        handleExportDatabase={handleExportDatabase}
        handleImportDatabase={handleImportDatabase}
      />

      <AdminSSLSection
        open={openSections.has("ssl")}
        onToggle={() => toggle("ssl")}
        status={tlsStatus}
        manualCertDraft={manualCertDraft}
        setManualCertDraft={setManualCertDraft}
        manualKeyDraft={manualKeyDraft}
        setManualKeyDraft={setManualKeyDraft}
        manualUploading={manualUploading}
        handleManualUpload={handleManualSslUpload}
      />

      <AdminApiKeysSection
        open={openSections.has("api-keys")}
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
        open={openSections.has("audit-log")}
        onToggle={() => toggle("audit-log")}
        users={users}
      />

      {featureSettings.map((plugin) => (
        <FeatureSettingsSection
          key={plugin.id}
          plugin={plugin}
          scope="admin"
          open={openSections.has(featureSectionId(plugin.id))}
          onToggle={() => toggle(featureSectionId(plugin.id))}
        />
      ))}

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
