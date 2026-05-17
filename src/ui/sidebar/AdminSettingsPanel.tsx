import { useState, useEffect } from "react";
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
import type React from "react";
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
  ChevronDown,
  Copy,
  Database,
  Eye,
  EyeOff,
  KeyRound,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  Share2,
  Shield,
  Trash2,
  User,
} from "lucide-react";
import { SettingRow } from "@/components/section-card";
import type { AdminSection } from "@/types/ui-types";
import type { Role } from "@/main-axios";
import { toast } from "sonner";
import { getBasePath } from "@/lib/base-path";

function AdminToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center border-2 transition-colors ${on ? "bg-accent-brand border-accent-brand" : "bg-muted border-border"}`}
    >
      <span
        className={`pointer-events-none inline-block h-3 w-3 bg-background shadow-sm transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`}
      />
    </button>
  );
}

function AccordionSection({
  label,
  icon,
  open,
  onToggle,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border bg-card overflow-hidden">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full px-3 py-2.5 text-left hover:bg-muted/40 transition-colors"
      >
        <span className="text-muted-foreground shrink-0">{icon}</span>
        <span className="text-xs font-bold uppercase tracking-widest text-foreground flex-1">
          {label}
        </span>
        <ChevronDown
          className={`size-3.5 text-muted-foreground shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="border-t border-border px-3 pb-3">{children}</div>
      )}
    </div>
  );
}

export function AdminSettingsPanel() {
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
  const [editUserTarget, setEditUserTarget] = useState<any | null>(null);
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

  const [users, setUsers] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
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
  }, [editUserOpen, editUserTarget?.id]);

  function loadUsers() {
    getUserList()
      .then(({ users: u }) => setUsers(u))
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
      const [reg, pwLogin, pwReset, timeout, monitoring, level, guac, oidcProv] =
        await Promise.allSettled([
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
      toast.error("Failed to update registration setting");
    }
  }

  async function handleTogglePasswordLogin() {
    const newVal = !allowPasswordLogin;
    setAllowPasswordLogin(newVal);
    try {
      await updatePasswordLoginAllowed(newVal);
    } catch {
      setAllowPasswordLogin(!newVal);
      toast.error("Failed to update password login setting");
    }
  }

  async function handleToggleOidcAutoProvision() {
    const newVal = !oidcAutoProvision;
    setOidcAutoProvision(newVal);
    try {
      await updateOidcAutoProvision(newVal);
    } catch {
      setOidcAutoProvision(!newVal);
      toast.error("Failed to update OIDC auto-provision setting");
    }
  }

  async function handleTogglePasswordReset() {
    const newVal = !allowPasswordReset;
    setAllowPasswordReset(newVal);
    try {
      await updatePasswordResetAllowed(newVal);
    } catch {
      setAllowPasswordReset(!newVal);
      toast.error("Failed to update password reset setting");
    }
  }

  async function handleSaveSessionTimeout() {
    const hours = parseInt(sessionTimeout, 10);
    if (isNaN(hours) || hours < 1 || hours > 720) {
      toast.error("Session timeout must be between 1 and 720 hours");
      return;
    }
    try {
      await updateSessionTimeout(hours);
      toast.success("Session timeout saved");
    } catch {
      toast.error("Failed to save session timeout");
    }
  }

  async function handleSaveMonitoring() {
    const status = parseInt(statusInterval, 10);
    const metrics = parseInt(metricsInterval, 10);
    if (isNaN(status) || isNaN(metrics)) {
      toast.error("Invalid interval values");
      return;
    }
    try {
      await updateGlobalMonitoringSettings({
        statusCheckInterval: status,
        metricsInterval: metrics,
      });
      toast.success("Monitoring settings saved");
    } catch {
      toast.error("Failed to save monitoring settings");
    }
  }

  async function handleSaveGuacamole() {
    try {
      await updateGuacamoleSettings({ enabled: guacEnabled, url: guacUrl });
      toast.success("Guacamole settings saved");
    } catch {
      toast.error("Failed to save Guacamole settings");
    }
  }

  async function handleToggleGuacamole() {
    const newVal = !guacEnabled;
    setGuacEnabled(newVal);
    try {
      await updateGuacamoleSettings({ enabled: newVal, url: guacUrl });
    } catch {
      setGuacEnabled(!newVal);
      toast.error("Failed to update Guacamole setting");
    }
  }

  async function handleSaveLogLevel(level: string) {
    setLogLevel(level);
    try {
      await updateLogLevel(level);
    } catch {
      toast.error("Failed to update log level");
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
      toast.success("OIDC configuration saved");
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to save OIDC config");
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
      toast.success("OIDC configuration removed");
    } catch {
      toast.error("Failed to remove OIDC config");
    }
  }

  async function handleCreateUser() {
    if (!newUsername.trim() || !newPassword.trim()) {
      toast.error("Username and password are required");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setCreateUserLoading(true);
    try {
      await registerUser(newUsername.trim(), newPassword);
      toast.success(`User "${newUsername}" created`);
      setCreateUserOpen(false);
      setNewUsername("");
      setNewPassword("");
      loadUsers();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to create user");
    } finally {
      setCreateUserLoading(false);
    }
  }

  async function handleToggleAdmin(user: any) {
    setEditUserLoading(true);
    try {
      if (user.isAdmin) {
        await removeAdminStatus(user.id);
        setEditUserTarget((prev: any) => ({ ...prev, isAdmin: false }));
        setUsers((prev) =>
          prev.map((u) => (u.id === user.id ? { ...u, isAdmin: false } : u)),
        );
      } else {
        await makeUserAdmin(user.id);
        setEditUserTarget((prev: any) => ({ ...prev, isAdmin: true }));
        setUsers((prev) =>
          prev.map((u) => (u.id === user.id ? { ...u, isAdmin: true } : u)),
        );
      }
    } catch {
      toast.error("Failed to update admin status");
    } finally {
      setEditUserLoading(false);
    }
  }

  async function handleRevokeUserSessions(userId: string) {
    try {
      await revokeAllUserSessions(userId);
      toast.success("All sessions revoked");
      loadSessions();
    } catch {
      toast.error("Failed to revoke sessions");
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
      toast.success(`User "${editUserTarget.username}" deleted`);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to delete user");
    } finally {
      setEditUserLoading(false);
    }
  }

  async function handleCreateRole() {
    if (!newRoleName.trim() || !newRoleDisplayName.trim()) {
      toast.error("Name and display name are required");
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
      toast.success(`Role "${displayName}" created`);
      loadRoles();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to create role");
    } finally {
      setCreateRoleLoading(false);
    }
  }

  async function handleCreateApiKey() {
    if (!newKeyName.trim()) {
      toast.error("Key name is required");
      return;
    }
    if (!newKeyUserId.trim()) {
      toast.error("User ID is required");
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
      toast.success(`API key "${created.name}" created`);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to create API key");
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
        ? `${(window as any).configuredServerUrl}/database/export`
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
        toast.success("Database exported successfully");
      } else {
        const err = await response.json().catch(() => ({}));
        toast.error(err.error || "Database export failed");
      }
    } catch {
      toast.error("Database export failed");
    } finally {
      setExportLoading(false);
    }
  }

  async function handleImportDatabase() {
    if (!importFile) {
      toast.error("Please select a file first");
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
        ? `${(window as any).configuredServerUrl}/database/import`
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
            `Import completed: ${total} items imported, ${s.skippedItems || 0} skipped`,
          );
          setImportFile(null);
          setTimeout(() => window.location.reload(), 1500);
        } else {
          toast.error(
            `Import failed: ${result.summary?.errors?.join(", ") || "Unknown error"}`,
          );
        }
      } else {
        const err = await response.json().catch(() => ({}));
        toast.error(err.error || "Database import failed");
      }
    } catch {
      toast.error("Database import failed");
    } finally {
      setImportLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      {/* General */}
      <AccordionSection
        label="General"
        icon={<Settings className="size-3.5" />}
        open={openSection === "general"}
        onToggle={() => toggle("general")}
      >
        <div className="flex flex-col gap-0 pt-2">
          <SettingRow
            label="Allow User Registration"
            description="Let new users self-register"
          >
            <AdminToggle
              on={allowRegistration}
              onToggle={handleToggleRegistration}
            />
          </SettingRow>
          <SettingRow
            label="Allow Password Login"
            description="Username/password login"
          >
            <AdminToggle
              on={allowPasswordLogin}
              onToggle={handleTogglePasswordLogin}
            />
          </SettingRow>
          <SettingRow
            label="OIDC Auto-Provision"
            description="Auto-create accounts for OIDC users even when registration is disabled"
          >
            <AdminToggle
              on={oidcAutoProvision}
              onToggle={handleToggleOidcAutoProvision}
            />
          </SettingRow>
          <SettingRow
            label="Allow Password Reset"
            description="Reset code via Docker logs"
          >
            <AdminToggle
              on={allowPasswordReset}
              onToggle={handleTogglePasswordReset}
            />
          </SettingRow>

          <div className="flex flex-col gap-2 border-t border-border pt-3 mt-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Session Timeout
            </span>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={720}
                value={sessionTimeout}
                onChange={(e) => setSessionTimeout(e.target.value)}
                className="w-20 text-sm"
              />
              <span className="text-xs text-muted-foreground">hours</span>
              <Button
                variant="outline"
                size="sm"
                className="text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand h-7"
                onClick={handleSaveSessionTimeout}
              >
                Save
              </Button>
            </div>
            <span className="text-[10px] text-muted-foreground">
              Min 1h · Max 720h
            </span>
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-3 mt-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Monitoring Defaults
            </span>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                Status Check
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  value={statusInterval}
                  onChange={(e) => setStatusInterval(e.target.value)}
                  className="w-20 text-sm"
                />
                <span className="text-xs text-muted-foreground">sec</span>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                Metrics
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  value={metricsInterval}
                  onChange={(e) => setMetricsInterval(e.target.value)}
                  className="w-20 text-sm"
                />
                <span className="text-xs text-muted-foreground">sec</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand h-7"
                  onClick={handleSaveMonitoring}
                >
                  Save
                </Button>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-3 mt-2">
            <SettingRow
              label="Enable Guacamole"
              description="RDP/VNC remote desktop"
            >
              <AdminToggle on={guacEnabled} onToggle={handleToggleGuacamole} />
            </SettingRow>
            {guacEnabled && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                  guacd URL
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    value={guacUrl}
                    onChange={(e) => setGuacUrl(e.target.value)}
                    placeholder="guacd:4822"
                    className="text-sm"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand h-7 shrink-0"
                    onClick={handleSaveGuacamole}
                  >
                    Save
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-3 mt-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Log Level
            </span>
            <div className="flex gap-1.5 flex-wrap">
              {["debug", "info", "warn", "error"].map((l) => (
                <button
                  key={l}
                  onClick={() => handleSaveLogLevel(l)}
                  className={`px-2 py-1 text-[10px] font-semibold border capitalize transition-colors ${logLevel === l ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand" : "border-border text-muted-foreground hover:text-foreground"}`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
      </AccordionSection>

      {/* OIDC */}
      <AccordionSection
        label="OIDC"
        icon={<Shield className="size-3.5" />}
        open={openSection === "oidc"}
        onToggle={() => toggle("oidc")}
      >
        <div className="flex flex-col gap-3 pt-3">
          <span className="text-[10px] text-muted-foreground">
            Configure OpenID Connect for SSO. Fields marked{" "}
            <span className="text-accent-brand">*</span> are required.
          </span>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
              Client ID <span className="text-accent-brand">*</span>
            </label>
            <Input
              value={oidcClientId}
              onChange={(e) => setOidcClientId(e.target.value)}
              placeholder="your-client-id"
              className="text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
              Client Secret <span className="text-accent-brand">*</span>
            </label>
            <Input
              type="password"
              value={oidcClientSecret}
              onChange={(e) => setOidcClientSecret(e.target.value)}
              placeholder="your-client-secret"
              className="text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
              Authorization URL <span className="text-accent-brand">*</span>
            </label>
            <Input
              value={oidcAuthUrl}
              onChange={(e) => setOidcAuthUrl(e.target.value)}
              placeholder="https://provider/oauth2/auth"
              className="text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
              Issuer URL <span className="text-accent-brand">*</span>
            </label>
            <Input
              value={oidcIssuerUrl}
              onChange={(e) => setOidcIssuerUrl(e.target.value)}
              placeholder="https://provider"
              className="text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
              Token URL <span className="text-accent-brand">*</span>
            </label>
            <Input
              value={oidcTokenUrl}
              onChange={(e) => setOidcTokenUrl(e.target.value)}
              placeholder="https://provider/oauth2/token"
              className="text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
              User Identifier Path <span className="text-accent-brand">*</span>
            </label>
            <Input
              value={oidcUserIdentifier}
              onChange={(e) => setOidcUserIdentifier(e.target.value)}
              placeholder="sub"
              className="text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
              Display Name Path <span className="text-accent-brand">*</span>
            </label>
            <Input
              value={oidcDisplayName}
              onChange={(e) => setOidcDisplayName(e.target.value)}
              placeholder="name"
              className="text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
              Scopes <span className="text-accent-brand">*</span>
            </label>
            <Input
              value={oidcScopes}
              onChange={(e) => setOidcScopes(e.target.value)}
              placeholder="openid email profile"
              className="text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
              Override Userinfo URL
            </label>
            <Input
              value={oidcUserinfoUrl}
              onChange={(e) => setOidcUserinfoUrl(e.target.value)}
              placeholder="https://provider/oauth2/userinfo"
              className="text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
              Allowed Users
            </label>
            <span className="text-[10px] text-muted-foreground">
              One email per line. Leave empty to allow all.
            </span>
            <textarea
              value={oidcAllowedUsers}
              onChange={(e) => setOidcAllowedUsers(e.target.value)}
              placeholder={"user@example.com\nanother@example.com"}
              rows={3}
              className="w-full px-2 py-1.5 text-xs bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring font-mono"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              className="text-xs border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={handleRemoveOidc}
            >
              <Trash2 className="size-3" />
              Remove
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
              onClick={handleSaveOidc}
              disabled={oidcSaving}
            >
              <RefreshCw className="size-3" />
              {oidcSaving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </AccordionSection>

      {/* Users */}
      <AccordionSection
        label="Users"
        icon={<User className="size-3.5" />}
        open={openSection === "users"}
        onToggle={() => toggle("users")}
      >
        <div className="flex flex-col pt-2">
          <div className="flex items-center justify-between py-2 border-b border-border">
            <span className="text-[10px] text-muted-foreground">
              {users.length} users
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
                Create
              </Button>
            </div>
          </div>
          {users.map((user) => {
            const authLabel =
              user.isOidc && user.passwordHash
                ? "Dual"
                : user.isOidc
                  ? "OIDC"
                  : "Local";
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
                          ADMIN
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
                        toast.success(`User "${user.username}" deleted`);
                      } catch (e: any) {
                        toast.error(
                          e?.response?.data?.error || "Failed to delete user",
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
        label="Sessions"
        icon={<Activity className="size-3.5" />}
        open={openSection === "sessions"}
        onToggle={() => toggle("sessions")}
      >
        <div className="flex flex-col pt-2">
          <div className="flex items-center justify-between py-2 border-b border-border">
            <span className="text-[10px] text-muted-foreground">
              {sessions.length} active
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
                      YOU
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground truncate">
                  {session.deviceInfo}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  Active: {session.lastActiveAt}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  Exp: {session.expiresAt}
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
                      toast.success("All sessions for user revoked");
                    } catch {
                      toast.error("Failed to revoke sessions");
                    }
                  }}
                >
                  All
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
                      toast.error("Failed to revoke session");
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
        label="Roles"
        icon={<KeyRound className="size-3.5" />}
        open={openSection === "roles"}
        onToggle={() => toggle("roles")}
      >
        <div className="flex flex-col pt-2">
          <div className="flex items-center justify-between py-2 border-b border-border">
            <span className="text-[10px] text-muted-foreground">
              {roles.length} roles
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10px] border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
              onClick={() => setShowCreateRole((o) => !o)}
            >
              <Plus className="size-3" />
              Create
            </Button>
          </div>
          {showCreateRole && (
            <div className="flex flex-col gap-2.5 py-3 border-b border-border">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                New Role
              </span>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                  Name <span className="text-accent-brand">*</span>
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
                  Display Name <span className="text-accent-brand">*</span>
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
                  Description
                </label>
                <textarea
                  rows={2}
                  placeholder="Optional"
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
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                  onClick={handleCreateRole}
                  disabled={createRoleLoading}
                >
                  {createRoleLoading ? "Creating..." : "Create"}
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
                      SYS
                    </span>
                  ) : (
                    <span className="text-[9px] font-semibold px-1 py-px border border-accent-brand/40 bg-accent-brand/10 text-accent-brand">
                      CUSTOM
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
                      toast.success(`Role "${role.displayName}" deleted`);
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

      {/* Database */}
      <AccordionSection
        label="Database"
        icon={<Database className="size-3.5" />}
        open={openSection === "database"}
        onToggle={() => toggle("database")}
      >
        <div className="flex flex-col gap-3 pt-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Export Database</span>
            <span className="text-[10px] text-muted-foreground">
              Download a backup of all hosts, credentials, and settings
            </span>
            <Button
              variant="outline"
              size="sm"
              className="self-start text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand mt-1"
              onClick={handleExportDatabase}
              disabled={exportLoading}
            >
              {exportLoading ? "Exporting..." : "Export"}
            </Button>
          </div>
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <span className="text-xs font-medium">Import Database</span>
            <span className="text-[10px] text-muted-foreground">
              {importFile
                ? `Selected: ${importFile.name}`
                : "Restore from a .sqlite backup file"}
            </span>
            <div className="flex items-center gap-2 mt-1">
              <div className="relative">
                <input
                  type="file"
                  accept=".sqlite,.db"
                  onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="pointer-events-none text-xs"
                >
                  {importFile ? "Change" : "Select File"}
                </Button>
              </div>
              {importFile && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                  onClick={handleImportDatabase}
                  disabled={importLoading}
                >
                  {importLoading ? "Importing..." : "Import"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </AccordionSection>

      {/* API Keys */}
      <AccordionSection
        label="API Keys"
        icon={<Network className="size-3.5" />}
        open={openSection === "api-keys"}
        onToggle={() => toggle("api-keys")}
      >
        <div className="flex flex-col pt-2">
          <div className="flex items-center justify-between py-2 border-b border-border">
            <span className="text-[10px] text-muted-foreground">
              {apiKeys.length} keys
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
                Create
              </Button>
            </div>
          </div>
          {showCreateKey && (
            <div className="flex flex-col gap-2.5 py-3 border-b border-border">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                New API Key
              </span>
              {createdKeyToken ? (
                <div className="flex flex-col gap-2">
                  <span className="text-[10px] text-accent-brand font-semibold">
                    Key created — copy it now, it won't be shown again.
                  </span>
                  <div className="flex items-center gap-2 bg-muted/30 border border-border px-2 py-1.5">
                    <span className="text-[10px] font-mono flex-1 truncate">
                      {createdKeyToken}
                    </span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(createdKeyToken);
                        toast.info("Copied to clipboard");
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
                    Done
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                      Name <span className="text-accent-brand">*</span>
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
                      User <span className="text-accent-brand">*</span>
                    </label>
                    <select
                      className="px-2 py-1.5 text-xs bg-background border border-border text-foreground outline-none"
                      value={newKeyUserId}
                      onChange={(e) => setNewKeyUserId(e.target.value)}
                    >
                      <option value="">Select a user...</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.username}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                      Expires At
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
                      Cancel
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                      onClick={handleCreateApiKey}
                      disabled={newKeyLoading}
                    >
                      {newKeyLoading ? "Creating..." : "Create Key"}
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
                      REVOKED
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground">
                  User: {key.username}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground truncate">
                  {key.tokenPrefix}…
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {key.createdAt.split("T")[0]} ·{" "}
                  {key.expiresAt ? key.expiresAt.split("T")[0] : "No expiry"}
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
                    toast.success(`Key "${key.name}" revoked`);
                  } catch {
                    toast.error("Failed to revoke key");
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
            <DialogTitle className="text-lg font-bold">Create User</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Create a new local account.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 mt-1">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Username <span className="text-accent-brand">*</span>
              </label>
              <Input
                placeholder="Enter username"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateUser()}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Password <span className="text-accent-brand">*</span>
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
                Minimum 6 characters.
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
              Cancel
            </Button>
            <Button
              variant="outline"
              className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
              onClick={handleCreateUser}
              disabled={createUserLoading}
            >
              {createUserLoading ? "Creating..." : "Create User"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={editUserOpen} onOpenChange={setEditUserOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              Manage User: {editUserTarget?.username}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Edit roles, admin status, sessions, and account settings.
            </DialogDescription>
          </DialogHeader>
          {editUserTarget && (
            <div className="flex flex-col gap-0 mt-1 divide-y divide-border">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 py-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
                    Username
                  </span>
                  <span className="text-sm font-semibold">
                    {editUserTarget.username}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
                    Auth Type
                  </span>
                  <span className="text-sm font-semibold">
                    {editUserTarget.isOidc && editUserTarget.passwordHash
                      ? "Dual Auth"
                      : editUserTarget.isOidc
                        ? "OIDC"
                        : "Local"}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
                    Admin Status
                  </span>
                  <span className="text-sm font-semibold">
                    {editUserTarget.isAdmin ? "Administrator" : "Regular User"}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
                    User ID
                  </span>
                  <span className="text-xs font-mono text-muted-foreground truncate">
                    {editUserTarget.id}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between py-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">Administrator</span>
                  <span className="text-xs text-muted-foreground">
                    Full access to all admin settings
                  </span>
                </div>
                <AdminToggle
                  on={editUserTarget.isAdmin}
                  onToggle={() => handleToggleAdmin(editUserTarget)}
                />
              </div>
              <div className="flex flex-col gap-2 py-3">
                <span className="text-sm font-medium">Roles</span>
                {editUserRolesLoading ? (
                  <span className="text-xs text-muted-foreground">
                    Loading...
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
                                      toast.error("Failed to remove role");
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
                          Add role
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
                                    toast.error("Failed to assign role");
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
                          No custom roles defined
                        </span>
                      )}
                  </>
                )}
              </div>
              <div className="flex items-center justify-between py-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">
                    Revoke All Sessions
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Force re-login on all devices
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive shrink-0 ml-8"
                  onClick={() => handleRevokeUserSessions(editUserTarget.id)}
                  disabled={editUserLoading}
                >
                  Revoke
                </Button>
              </div>
              <div className="flex flex-col gap-2 py-3">
                <div className="flex items-start gap-2.5 border border-destructive/30 bg-destructive/5 px-3 py-2.5">
                  <AlertCircle className="size-4 text-destructive shrink-0 mt-0.5" />
                  <span className="text-xs text-destructive">
                    Deleting this user is permanent.
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
                    ? "Deleting..."
                    : `Delete ${editUserTarget.username}`}
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
              Link OIDC to Password Account
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Merge the OIDC account{" "}
              <span className="font-semibold text-foreground">
                {linkAccountTarget?.username}
              </span>{" "}
              with an existing local account.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 mt-1">
            <div className="flex items-start gap-2.5 border border-destructive/30 bg-destructive/5 px-3 py-2.5">
              <AlertCircle className="size-4 text-destructive shrink-0 mt-0.5" />
              <div className="flex flex-col gap-1 text-xs text-destructive">
                <span>This will:</span>
                <ul className="list-disc list-inside space-y-0.5 ml-1">
                  <li>Delete the OIDC-only account</li>
                  <li>Add OIDC login to the target account</li>
                  <li>Allow both OIDC and password login</li>
                </ul>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Target Username <span className="text-accent-brand">*</span>
              </label>
              <Input placeholder="Enter the local account username to link to" />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="ghost" onClick={() => setLinkAccountOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              Link Accounts
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
