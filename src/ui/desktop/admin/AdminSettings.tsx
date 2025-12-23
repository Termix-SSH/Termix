import React from "react";
import { useSidebar } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Input } from "@/components/ui/input.tsx";
import { PasswordInput } from "@/components/ui/password-input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import {
  Shield,
  Trash2,
  Users,
  Database,
  Link2,
  Unlink,
  Download,
  Upload,
  Monitor,
  Smartphone,
  Globe,
  Clock,
  UserCog,
  UserPlus,
  Edit,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useConfirmation } from "@/hooks/use-confirmation.ts";
import {
  getAdminOIDCConfig,
  getRegistrationAllowed,
  getPasswordLoginAllowed,
  getUserList,
  updateRegistrationAllowed,
  updatePasswordLoginAllowed,
  updateOIDCConfig,
  disableOIDCConfig,
  makeUserAdmin,
  removeAdminStatus,
  deleteUser,
  getUserInfo,
  getCookie,
  isElectron,
  getSessions,
  revokeSession,
  revokeAllUserSessions,
  linkOIDCToPasswordAccount,
  unlinkOIDCFromPasswordAccount,
  getUserRoles,
  assignRoleToUser,
  removeRoleFromUser,
  getRoles,
  type UserRole,
  type Role,
} from "@/ui/main-axios.ts";
import { RoleManagement } from "./RoleManagement.tsx";
import { CreateUserDialog } from "./CreateUserDialog.tsx";
import { UserEditDialog } from "./UserEditDialog.tsx";

interface AdminSettingsProps {
  isTopbarOpen?: boolean;
  rightSidebarOpen?: boolean;
  rightSidebarWidth?: number;
}

export function AdminSettings({
  isTopbarOpen = true,
  rightSidebarOpen = false,
  rightSidebarWidth = 400,
}: AdminSettingsProps): React.ReactElement {
  const { t } = useTranslation();
  const { confirmWithToast } = useConfirmation();
  const { state: sidebarState } = useSidebar();

  const [allowRegistration, setAllowRegistration] = React.useState(true);
  const [regLoading, setRegLoading] = React.useState(false);

  const [allowPasswordLogin, setAllowPasswordLogin] = React.useState(true);
  const [passwordLoginLoading, setPasswordLoginLoading] = React.useState(false);

  const [oidcConfig, setOidcConfig] = React.useState({
    client_id: "",
    client_secret: "",
    issuer_url: "",
    authorization_url: "",
    token_url: "",
    identifier_path: "sub",
    name_path: "name",
    scopes: "openid email profile",
    userinfo_url: "",
  });
  const [oidcLoading, setOidcLoading] = React.useState(false);
  const [oidcError, setOidcError] = React.useState<string | null>(null);

  const [users, setUsers] = React.useState<
    Array<{
      id: string;
      username: string;
      is_admin: boolean;
      is_oidc: boolean;
      password_hash?: string;
    }>
  >([]);
  const [usersLoading, setUsersLoading] = React.useState(false);

  // New dialog states
  const [createUserDialogOpen, setCreateUserDialogOpen] = React.useState(false);
  const [userEditDialogOpen, setUserEditDialogOpen] = React.useState(false);
  const [selectedUserForEdit, setSelectedUserForEdit] = React.useState<{
    id: string;
    username: string;
    is_admin: boolean;
    is_oidc: boolean;
    password_hash?: string;
  } | null>(null);

  const [securityInitialized, setSecurityInitialized] = React.useState(true);
  const [currentUser, setCurrentUser] = React.useState<{
    id: string;
    username: string;
    is_admin: boolean;
    is_oidc: boolean;
  } | null>(null);

  const [exportLoading, setExportLoading] = React.useState(false);
  const [importLoading, setImportLoading] = React.useState(false);
  const [importFile, setImportFile] = React.useState<File | null>(null);
  const [exportPassword, setExportPassword] = React.useState("");
  const [showPasswordInput, setShowPasswordInput] = React.useState(false);
  const [importPassword, setImportPassword] = React.useState("");

  const [sessions, setSessions] = React.useState<
    Array<{
      id: string;
      userId: string;
      username?: string;
      deviceType: string;
      deviceInfo: string;
      createdAt: string;
      expiresAt: string;
      lastActiveAt: string;
      jwtToken: string;
      isRevoked?: boolean;
    }>
  >([]);
  const [sessionsLoading, setSessionsLoading] = React.useState(false);

  const [linkAccountAlertOpen, setLinkAccountAlertOpen] = React.useState(false);
  const [linkOidcUser, setLinkOidcUser] = React.useState<{
    id: string;
    username: string;
  } | null>(null);
  const [linkTargetUsername, setLinkTargetUsername] = React.useState("");
  const [linkLoading, setLinkLoading] = React.useState(false);

  const requiresImportPassword = React.useMemo(
    () => !currentUser?.is_oidc,
    [currentUser?.is_oidc],
  );

  React.useEffect(() => {
    if (isElectron()) {
      const serverUrl = (window as { configuredServerUrl?: string })
        .configuredServerUrl;
      if (!serverUrl) {
        return;
      }
    }

    getAdminOIDCConfig()
      .then((res) => {
        if (res) setOidcConfig(res);
      })
      .catch((err) => {
        if (!err.message?.includes("No server configured")) {
          toast.error(t("admin.failedToFetchOidcConfig"));
        }
      });
    getUserInfo()
      .then((info) => {
        if (info) {
          setCurrentUser({
            id: info.userId,
            username: info.username,
            is_admin: info.is_admin,
            is_oidc: info.is_oidc,
          });
        }
      })
      .catch((err) => {
        if (!err?.message?.includes("No server configured")) {
          console.warn("Failed to fetch current user info", err);
        }
      });
    fetchUsers();
    fetchSessions();
  }, []);

  React.useEffect(() => {
    if (isElectron()) {
      const serverUrl = (window as { configuredServerUrl?: string })
        .configuredServerUrl;
      if (!serverUrl) {
        return;
      }
    }

    getRegistrationAllowed()
      .then((res) => {
        if (typeof res?.allowed === "boolean") {
          setAllowRegistration(res.allowed);
        }
      })
      .catch((err) => {
        if (!err.message?.includes("No server configured")) {
          toast.error(t("admin.failedToFetchRegistrationStatus"));
        }
      });
  }, []);

  React.useEffect(() => {
    if (isElectron()) {
      const serverUrl = (window as { configuredServerUrl?: string })
        .configuredServerUrl;
      if (!serverUrl) {
        return;
      }
    }

    getPasswordLoginAllowed()
      .then((res) => {
        if (typeof res?.allowed === "boolean") {
          setAllowPasswordLogin(res.allowed);
        }
      })
      .catch((err) => {
        if (err.code !== "NO_SERVER_CONFIGURED") {
          toast.error(t("admin.failedToFetchPasswordLoginStatus"));
        }
      });
  }, []);

  const fetchUsers = async () => {
    if (isElectron()) {
      const serverUrl = (window as { configuredServerUrl?: string })
        .configuredServerUrl;
      if (!serverUrl) {
        return;
      }
    }

    setUsersLoading(true);
    try {
      const response = await getUserList();
      setUsers(response.users);
    } catch (err) {
      if (!err.message?.includes("No server configured")) {
        toast.error(t("admin.failedToFetchUsers"));
      }
    } finally {
      setUsersLoading(false);
    }
  };

  // New dialog handlers
  const handleEditUser = (user: (typeof users)[0]) => {
    setSelectedUserForEdit(user);
    setUserEditDialogOpen(true);
  };

  const handleCreateUserSuccess = () => {
    fetchUsers();
    setCreateUserDialogOpen(false);
  };

  const handleEditUserSuccess = () => {
    fetchUsers();
    setUserEditDialogOpen(false);
    setSelectedUserForEdit(null);
  };

  const getAuthTypeDisplay = (user: (typeof users)[0]): string => {
    if (user.is_oidc && user.password_hash) {
      return t("admin.dualAuth");
    } else if (user.is_oidc) {
      return t("admin.externalOIDC");
    } else {
      return t("admin.localPassword");
    }
  };

  const handleToggleRegistration = async (checked: boolean) => {
    setRegLoading(true);
    try {
      await updateRegistrationAllowed(checked);
      setAllowRegistration(checked);
    } finally {
      setRegLoading(false);
    }
  };

  const handleTogglePasswordLogin = async (checked: boolean) => {
    if (!checked) {
      const hasOIDCConfigured =
        oidcConfig.client_id &&
        oidcConfig.client_secret &&
        oidcConfig.issuer_url &&
        oidcConfig.authorization_url &&
        oidcConfig.token_url;

      if (!hasOIDCConfigured) {
        toast.error(t("admin.cannotDisablePasswordLoginWithoutOIDC"), {
          duration: 5000,
        });
        return;
      }

      confirmWithToast(
        t("admin.confirmDisablePasswordLogin"),
        async () => {
          setPasswordLoginLoading(true);
          try {
            await updatePasswordLoginAllowed(checked);
            setAllowPasswordLogin(checked);

            if (allowRegistration) {
              await updateRegistrationAllowed(false);
              setAllowRegistration(false);
              toast.success(t("admin.passwordLoginAndRegistrationDisabled"));
            } else {
              toast.success(t("admin.passwordLoginDisabled"));
            }
          } catch {
            toast.error(t("admin.failedToUpdatePasswordLoginStatus"));
          } finally {
            setPasswordLoginLoading(false);
          }
        },
        "destructive",
      );
      return;
    }

    setPasswordLoginLoading(true);
    try {
      await updatePasswordLoginAllowed(checked);
      setAllowPasswordLogin(checked);
    } finally {
      setPasswordLoginLoading(false);
    }
  };

  const handleOIDCConfigSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setOidcLoading(true);
    setOidcError(null);

    const required = [
      "client_id",
      "client_secret",
      "issuer_url",
      "authorization_url",
      "token_url",
    ];
    const missing = required.filter(
      (f) => !oidcConfig[f as keyof typeof oidcConfig],
    );
    if (missing.length > 0) {
      setOidcError(
        t("admin.missingRequiredFields", { fields: missing.join(", ") }),
      );
      setOidcLoading(false);
      return;
    }

    try {
      await updateOIDCConfig(oidcConfig);
      toast.success(t("admin.oidcConfigurationUpdated"));
    } catch (err: unknown) {
      setOidcError(
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error || t("admin.failedToUpdateOidcConfig"),
      );
    } finally {
      setOidcLoading(false);
    }
  };

  const handleOIDCConfigChange = (field: string, value: string) => {
    setOidcConfig((prev) => ({ ...prev, [field]: value }));
  };

  const handleDeleteUserQuick = async (username: string) => {
    confirmWithToast(
      t("admin.deleteUser", { username }),
      async () => {
        try {
          await deleteUser(username);
          toast.success(t("admin.userDeletedSuccessfully", { username }));
          fetchUsers();
        } catch {
          toast.error(t("admin.failedToDeleteUser"));
        }
      },
      "destructive",
    );
  };

  const handleExportDatabase = async () => {
    if (!showPasswordInput) {
      setShowPasswordInput(true);
      return;
    }

    if (!exportPassword.trim()) {
      toast.error(t("admin.passwordRequired"));
      return;
    }

    setExportLoading(true);
    try {
      const isDev =
        !isElectron() &&
        process.env.NODE_ENV === "development" &&
        (window.location.port === "3000" ||
          window.location.port === "5173" ||
          window.location.port === "" ||
          window.location.hostname === "localhost" ||
          window.location.hostname === "127.0.0.1");

      const apiUrl = isElectron()
        ? `${(window as { configuredServerUrl?: string }).configuredServerUrl}/database/export`
        : isDev
          ? `http://localhost:30001/database/export`
          : `${window.location.protocol}//${window.location.host}/database/export`;

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ password: exportPassword }),
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

        toast.success(t("admin.databaseExportedSuccessfully"));
        setExportPassword("");
        setShowPasswordInput(false);
      } else {
        const error = await response.json();
        if (error.code === "PASSWORD_REQUIRED") {
          toast.error(t("admin.passwordRequired"));
        } else {
          toast.error(error.error || t("admin.databaseExportFailed"));
        }
      }
    } catch {
      toast.error(t("admin.databaseExportFailed"));
    } finally {
      setExportLoading(false);
    }
  };

  const handleImportDatabase = async () => {
    if (!importFile) {
      toast.error(t("admin.pleaseSelectImportFile"));
      return;
    }

    if (requiresImportPassword && !importPassword.trim()) {
      toast.error(t("admin.passwordRequired"));
      return;
    }

    setImportLoading(true);
    try {
      const isDev =
        !isElectron() &&
        process.env.NODE_ENV === "development" &&
        (window.location.port === "3000" ||
          window.location.port === "5173" ||
          window.location.port === "" ||
          window.location.hostname === "localhost" ||
          window.location.hostname === "127.0.0.1");

      const apiUrl = isElectron()
        ? `${(window as { configuredServerUrl?: string }).configuredServerUrl}/database/import`
        : isDev
          ? `http://localhost:30001/database/import`
          : `${window.location.protocol}//${window.location.host}/database/import`;

      const formData = new FormData();
      formData.append("file", importFile);
      if (requiresImportPassword) {
        formData.append("password", importPassword);
      }

      const response = await fetch(apiUrl, {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          const summary = result.summary;
          const imported =
            summary.sshHostsImported +
            summary.sshCredentialsImported +
            summary.fileManagerItemsImported +
            summary.dismissedAlertsImported +
            (summary.settingsImported || 0);
          const skipped = summary.skippedItems;

          const details = [];
          if (summary.sshHostsImported > 0)
            details.push(`${summary.sshHostsImported} SSH hosts`);
          if (summary.sshCredentialsImported > 0)
            details.push(`${summary.sshCredentialsImported} credentials`);
          if (summary.fileManagerItemsImported > 0)
            details.push(
              `${summary.fileManagerItemsImported} file manager items`,
            );
          if (summary.dismissedAlertsImported > 0)
            details.push(`${summary.dismissedAlertsImported} alerts`);
          if (summary.settingsImported > 0)
            details.push(`${summary.settingsImported} settings`);

          toast.success(
            `Import completed: ${imported} items imported${details.length > 0 ? ` (${details.join(", ")})` : ""}, ${skipped} items skipped`,
          );
          setImportFile(null);
          setImportPassword("");

          setTimeout(() => {
            window.location.reload();
          }, 1500);
        } else {
          toast.error(
            `${t("admin.databaseImportFailed")}: ${result.summary?.errors?.join(", ") || "Unknown error"}`,
          );
        }
      } else {
        const error = await response.json();
        if (error.code === "PASSWORD_REQUIRED") {
          toast.error(t("admin.passwordRequired"));
        } else {
          toast.error(error.error || t("admin.databaseImportFailed"));
        }
      }
    } catch {
      toast.error(t("admin.databaseImportFailed"));
    } finally {
      setImportLoading(false);
    }
  };

  const fetchSessions = async () => {
    if (isElectron()) {
      const serverUrl = (window as { configuredServerUrl?: string })
        .configuredServerUrl;
      if (!serverUrl) {
        return;
      }
    }

    setSessionsLoading(true);
    try {
      const data = await getSessions();
      setSessions(data.sessions || []);
    } catch (err) {
      if (!err?.message?.includes("No server configured")) {
        toast.error(t("admin.failedToFetchSessions"));
      }
    } finally {
      setSessionsLoading(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    const currentJWT = getCookie("jwt");
    const currentSession = sessions.find((s) => s.jwtToken === currentJWT);
    const isCurrentSession = currentSession?.id === sessionId;

    confirmWithToast(
      t("admin.confirmRevokeSession"),
      async () => {
        try {
          await revokeSession(sessionId);
          toast.success(t("admin.sessionRevokedSuccessfully"));

          if (isCurrentSession) {
            setTimeout(() => {
              window.location.reload();
            }, 1000);
          } else {
            fetchSessions();
          }
        } catch {
          toast.error(t("admin.failedToRevokeSession"));
        }
      },
      "destructive",
    );
  };

  const handleRevokeAllUserSessions = async (userId: string) => {
    const isCurrentUser = currentUser?.id === userId;

    confirmWithToast(
      t("admin.confirmRevokeAllSessions"),
      async () => {
        try {
          const data = await revokeAllUserSessions(userId);
          toast.success(data.message || t("admin.sessionsRevokedSuccessfully"));

          if (isCurrentUser) {
            setTimeout(() => {
              window.location.reload();
            }, 1000);
          } else {
            fetchSessions();
          }
        } catch {
          toast.error(t("admin.failedToRevokeSessions"));
        }
      },
      "destructive",
    );
  };

  const handleLinkOIDCUser = (user: { id: string; username: string }) => {
    setLinkOidcUser(user);
    setLinkTargetUsername("");
    setLinkAccountAlertOpen(true);
  };

  const handleLinkSubmit = async () => {
    if (!linkOidcUser || !linkTargetUsername.trim()) {
      toast.error("Target username is required");
      return;
    }

    setLinkLoading(true);
    try {
      const result = await linkOIDCToPasswordAccount(
        linkOidcUser.id,
        linkTargetUsername.trim(),
      );

      toast.success(
        result.message ||
          `OIDC user ${linkOidcUser.username} linked to ${linkTargetUsername}`,
      );
      setLinkAccountAlertOpen(false);
      setLinkTargetUsername("");
      setLinkOidcUser(null);
      fetchUsers();
      fetchSessions();
    } catch (error: unknown) {
      const err = error as {
        response?: { data?: { error?: string; code?: string } };
      };
      toast.error(err.response?.data?.error || "Failed to link accounts");
    } finally {
      setLinkLoading(false);
    }
  };

  const handleUnlinkOIDC = async (userId: string, username: string) => {
    confirmWithToast(
      t("admin.unlinkOIDCDescription", { username }),
      async () => {
        try {
          const result = await unlinkOIDCFromPasswordAccount(userId);

          toast.success(
            result.message || t("admin.unlinkOIDCSuccess", { username }),
          );
          fetchUsers();
          fetchSessions();
        } catch (error: unknown) {
          const err = error as {
            response?: { data?: { error?: string; code?: string } };
          };
          toast.error(
            err.response?.data?.error || t("admin.failedToUnlinkOIDC"),
          );
        }
      },
      "destructive",
    );
  };

  const topMarginPx = isTopbarOpen ? 74 : 26;
  const leftMarginPx = sidebarState === "collapsed" ? 26 : 8;
  const bottomMarginPx = 8;
  const wrapperStyle: React.CSSProperties = {
    marginLeft: leftMarginPx,
    marginRight: rightSidebarOpen
      ? `calc(var(--right-sidebar-width, ${rightSidebarWidth}px) + 8px)`
      : 17,
    marginTop: topMarginPx,
    marginBottom: bottomMarginPx,
    height: `calc(100vh - ${topMarginPx + bottomMarginPx}px)`,
    transition:
      "margin-left 200ms linear, margin-right 200ms linear, margin-top 200ms linear",
  };

  return (
    <div
      style={wrapperStyle}
      className="bg-canvas text-foreground rounded-lg border-2 border-edge overflow-hidden"
    >
      <div className="h-full w-full flex flex-col">
        <div className="flex items-center justify-between px-3 pt-2 pb-2">
          <h1 className="font-bold text-lg">{t("admin.title")}</h1>
        </div>
        <Separator className="p-0.25 w-full" />

        <div className="px-6 py-4 overflow-auto thin-scrollbar">
          <Tabs defaultValue="registration" className="w-full">
            <TabsList className="mb-4 bg-elevated border-2 border-edge">
              <TabsTrigger
                value="registration"
                className="flex items-center gap-2 bg-elevated data-[state=active]:bg-button data-[state=active]:border data-[state=active]:border-edge"
              >
                <Users className="h-4 w-4" />
                {t("admin.general")}
              </TabsTrigger>
              <TabsTrigger value="oidc" className="flex items-center gap-2 bg-elevated data-[state=active]:bg-button data-[state=active]:border data-[state=active]:border-edge">
                <Shield className="h-4 w-4" />
                OIDC
              </TabsTrigger>
              <TabsTrigger value="users" className="flex items-center gap-2 bg-elevated data-[state=active]:bg-button data-[state=active]:border data-[state=active]:border-edge">
                <Users className="h-4 w-4" />
                {t("admin.users")}
              </TabsTrigger>
              <TabsTrigger value="sessions" className="flex items-center gap-2 bg-elevated data-[state=active]:bg-button data-[state=active]:border data-[state=active]:border-edge">
                <Clock className="h-4 w-4" />
                Sessions
              </TabsTrigger>
              <TabsTrigger value="roles" className="flex items-center gap-2 bg-elevated data-[state=active]:bg-button data-[state=active]:border data-[state=active]:border-edge">
                <Shield className="h-4 w-4" />
                {t("rbac.roles.label")}
              </TabsTrigger>
              <TabsTrigger value="security" className="flex items-center gap-2 bg-elevated data-[state=active]:bg-button data-[state=active]:border data-[state=active]:border-edge">
                <Database className="h-4 w-4" />
                {t("admin.databaseSecurity")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="registration" className="space-y-6">
              <div className="rounded-lg border-2 border-border bg-card p-4 space-y-4">
                <h3 className="text-lg font-semibold">
                  {t("admin.userRegistration")}
                </h3>
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={allowRegistration}
                      onCheckedChange={handleToggleRegistration}
                      disabled={regLoading || !allowPasswordLogin}
                    />
                    {t("admin.allowNewAccountRegistration")}
                    {!allowPasswordLogin && (
                      <span className="text-xs text-muted-foreground">
                        ({t("admin.requiresPasswordLogin")})
                      </span>
                    )}
                  </label>
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={allowPasswordLogin}
                      onCheckedChange={handleTogglePasswordLogin}
                      disabled={passwordLoginLoading}
                    />
                    {t("admin.allowPasswordLogin")}
                  </label>
              </div>
            </TabsContent>

            <TabsContent value="oidc" className="space-y-6">
              <div className="rounded-lg border-2 border-border bg-card p-4 space-y-3">
                <h3 className="text-lg font-semibold">
                  {t("admin.externalAuthentication")}
                </h3>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    {t("admin.configureExternalProvider")}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-3 text-xs"
                    onClick={() =>
                      window.open("https://docs.termix.site/oidc", "_blank")
                    }
                  >
                    {t("common.documentation")}
                  </Button>
                </div>

                {!allowPasswordLogin && (
                  <Alert variant="destructive">
                    <AlertTitle>{t("admin.criticalWarning")}</AlertTitle>
                    <AlertDescription>
                      {t("admin.oidcRequiredWarning")}
                    </AlertDescription>
                  </Alert>
                )}

                {oidcError && (
                  <Alert variant="destructive">
                    <AlertTitle>{t("common.error")}</AlertTitle>
                    <AlertDescription>{oidcError}</AlertDescription>
                  </Alert>
                )}

                <form onSubmit={handleOIDCConfigSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="client_id">{t("admin.clientId")}</Label>
                    <Input
                      id="client_id"
                      value={oidcConfig.client_id}
                      onChange={(e) =>
                        handleOIDCConfigChange("client_id", e.target.value)
                      }
                      placeholder={t("placeholders.clientId")}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="client_secret">
                      {t("admin.clientSecret")}
                    </Label>
                    <PasswordInput
                      id="client_secret"
                      value={oidcConfig.client_secret}
                      onChange={(e) =>
                        handleOIDCConfigChange("client_secret", e.target.value)
                      }
                      placeholder={t("placeholders.clientSecret")}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="authorization_url">
                      {t("admin.authorizationUrl")}
                    </Label>
                    <Input
                      id="authorization_url"
                      value={oidcConfig.authorization_url}
                      onChange={(e) =>
                        handleOIDCConfigChange(
                          "authorization_url",
                          e.target.value,
                        )
                      }
                      placeholder={t("placeholders.authUrl")}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="issuer_url">{t("admin.issuerUrl")}</Label>
                    <Input
                      id="issuer_url"
                      value={oidcConfig.issuer_url}
                      onChange={(e) =>
                        handleOIDCConfigChange("issuer_url", e.target.value)
                      }
                      placeholder={t("placeholders.redirectUrl")}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="token_url">{t("admin.tokenUrl")}</Label>
                    <Input
                      id="token_url"
                      value={oidcConfig.token_url}
                      onChange={(e) =>
                        handleOIDCConfigChange("token_url", e.target.value)
                      }
                      placeholder={t("placeholders.tokenUrl")}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="identifier_path">
                      {t("admin.userIdentifierPath")}
                    </Label>
                    <Input
                      id="identifier_path"
                      value={oidcConfig.identifier_path}
                      onChange={(e) =>
                        handleOIDCConfigChange(
                          "identifier_path",
                          e.target.value,
                        )
                      }
                      placeholder={t("placeholders.userIdField")}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="name_path">
                      {t("admin.displayNamePath")}
                    </Label>
                    <Input
                      id="name_path"
                      value={oidcConfig.name_path}
                      onChange={(e) =>
                        handleOIDCConfigChange("name_path", e.target.value)
                      }
                      placeholder={t("placeholders.usernameField")}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="scopes">{t("admin.scopes")}</Label>
                    <Input
                      id="scopes"
                      value={oidcConfig.scopes}
                      onChange={(e) =>
                        handleOIDCConfigChange("scopes", e.target.value)
                      }
                      placeholder={t("placeholders.scopes")}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="userinfo_url">
                      {t("admin.overrideUserInfoUrl")}
                    </Label>
                    <Input
                      id="userinfo_url"
                      value={oidcConfig.userinfo_url}
                      onChange={(e) =>
                        handleOIDCConfigChange("userinfo_url", e.target.value)
                      }
                      placeholder="https://your-provider.com/application/o/userinfo/"
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button
                      type="submit"
                      className="flex-1"
                      disabled={oidcLoading}
                    >
                      {oidcLoading
                        ? t("admin.saving")
                        : t("admin.saveConfiguration")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={async () => {
                        if (!allowPasswordLogin) {
                          confirmWithToast(
                            t("admin.confirmDisableOIDCWarning"),
                            async () => {
                              const emptyConfig = {
                                client_id: "",
                                client_secret: "",
                                issuer_url: "",
                                authorization_url: "",
                                token_url: "",
                                identifier_path: "",
                                name_path: "",
                                scopes: "",
                                userinfo_url: "",
                              };
                              setOidcConfig(emptyConfig);
                              setOidcError(null);
                              setOidcLoading(true);
                              try {
                                await disableOIDCConfig();
                                toast.success(
                                  t("admin.oidcConfigurationDisabled"),
                                );
                              } catch (err: unknown) {
                                setOidcError(
                                  (
                                    err as {
                                      response?: { data?: { error?: string } };
                                    }
                                  )?.response?.data?.error ||
                                    t("admin.failedToDisableOidcConfig"),
                                );
                              } finally {
                                setOidcLoading(false);
                              }
                            },
                            "destructive",
                          );
                          return;
                        }

                        const emptyConfig = {
                          client_id: "",
                          client_secret: "",
                          issuer_url: "",
                          authorization_url: "",
                          token_url: "",
                          identifier_path: "",
                          name_path: "",
                          scopes: "",
                          userinfo_url: "",
                        };
                        setOidcConfig(emptyConfig);
                        setOidcError(null);
                        setOidcLoading(true);
                        try {
                          await disableOIDCConfig();
                          toast.success(t("admin.oidcConfigurationDisabled"));
                        } catch (err: unknown) {
                          setOidcError(
                            (
                              err as {
                                response?: { data?: { error?: string } };
                              }
                            )?.response?.data?.error ||
                              t("admin.failedToDisableOidcConfig"),
                          );
                        } finally {
                          setOidcLoading(false);
                        }
                      }}
                      disabled={oidcLoading}
                    >
                      {t("admin.reset")}
                    </Button>
                  </div>
                </form>
              </div>
            </TabsContent>

            <TabsContent value="users" className="space-y-6">
              <div className="rounded-lg border-2 border-border bg-card p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">
                    {t("admin.userManagement")}
                  </h3>
                  <div className="flex gap-2">
                    {allowPasswordLogin && (
                      <Button
                        onClick={() => setCreateUserDialogOpen(true)}
                        size="sm"
                      >
                        <UserPlus className="h-4 w-4 mr-2" />
                        {t("admin.createUser")}
                      </Button>
                    )}
                    <Button
                      onClick={fetchUsers}
                      disabled={usersLoading}
                      variant="outline"
                      size="sm"
                    >
                      {usersLoading ? t("admin.loading") : t("admin.refresh")}
                    </Button>
                  </div>
                </div>
                {usersLoading ? (
                  <div className="text-center py-8 text-muted-foreground">
                    {t("admin.loadingUsers")}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("admin.username")}</TableHead>
                        <TableHead>{t("admin.authType")}</TableHead>
                        <TableHead>{t("admin.actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((user) => (
                        <TableRow key={user.id}>
                          <TableCell className="font-medium">
                            {user.username}
                            {user.is_admin && (
                              <span className="ml-2 inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-muted/50 text-muted-foreground border border-border">
                                {t("admin.adminBadge")}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>{getAuthTypeDisplay(user)}</TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEditUser(user)}
                                className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                title={t("admin.manageUser")}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              {user.is_oidc && !user.password_hash && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    handleLinkOIDCUser({
                                      id: user.id,
                                      username: user.username,
                                    })
                                  }
                                  className="text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                                  title="Link to password account"
                                >
                                  <Link2 className="h-4 w-4" />
                                </Button>
                              )}
                              {user.is_oidc && user.password_hash && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    handleUnlinkOIDC(user.id, user.username)
                                  }
                                  className="text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                                  title="Unlink OIDC (keep password only)"
                                >
                                  <Unlink className="h-4 w-4" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  handleDeleteUserQuick(user.username)
                                }
                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                disabled={user.is_admin}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </TabsContent>

            <TabsContent value="sessions" className="space-y-6">
              <div className="rounded-lg border-2 border-border bg-card p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">{t("admin.sessionManagement")}</h3>
                  <Button
                    onClick={fetchSessions}
                    disabled={sessionsLoading}
                    variant="outline"
                    size="sm"
                  >
                    {sessionsLoading ? t("admin.loading") : t("admin.refresh")}
                  </Button>
                </div>
                {sessionsLoading ? (
                  <div className="text-center py-8 text-muted-foreground">
                    {t("admin.loadingSessions")}
                  </div>
                ) : sessions.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    {t("admin.noActiveSessions")}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("admin.device")}</TableHead>
                        <TableHead>{t("admin.user")}</TableHead>
                        <TableHead>{t("admin.created")}</TableHead>
                        <TableHead>{t("admin.lastActive")}</TableHead>
                        <TableHead>{t("admin.expires")}</TableHead>
                        <TableHead>{t("admin.actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sessions.map((session) => {
                        const DeviceIcon =
                          session.deviceType === "desktop"
                            ? Monitor
                            : session.deviceType === "mobile"
                              ? Smartphone
                              : Globe;

                        const createdDate = new Date(session.createdAt);
                        const lastActiveDate = new Date(session.lastActiveAt);
                        const expiresDate = new Date(session.expiresAt);

                        const formatDate = (date: Date) =>
                          date.toLocaleDateString() +
                          " " +
                          date.toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          });

                        return (
                          <TableRow
                            key={session.id}
                            className={
                              session.isRevoked ? "opacity-50" : undefined
                            }
                          >
                            <TableCell className="px-4">
                              <div className="flex items-center gap-2">
                                <DeviceIcon className="h-4 w-4" />
                                <div className="flex flex-col">
                                  <span className="font-medium text-sm">
                                    {session.deviceInfo}
                                  </span>
                                  {session.isRevoked && (
                                    <span className="text-xs text-red-600">
                                      {t("admin.revoked")}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="px-4">
                              {session.username || session.userId}
                            </TableCell>
                            <TableCell className="px-4 text-sm text-muted-foreground">
                              {formatDate(createdDate)}
                            </TableCell>
                            <TableCell className="px-4 text-sm text-muted-foreground">
                              {formatDate(lastActiveDate)}
                            </TableCell>
                            <TableCell className="px-4 text-sm text-muted-foreground">
                              {formatDate(expiresDate)}
                            </TableCell>
                            <TableCell className="px-4">
                              <div className="flex gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    handleRevokeSession(session.id)
                                  }
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                  disabled={session.isRevoked}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                                {session.username && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      handleRevokeAllUserSessions(
                                        session.userId,
                                      )
                                    }
                                    className="text-orange-600 hover:text-orange-700 hover:bg-orange-50 text-xs"
                                    title={t("admin.revokeAllUserSessionsTitle")}
                                  >
                                    {t("admin.revokeAll")}
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            </TabsContent>

            <TabsContent value="roles" className="space-y-6">
              <RoleManagement />
            </TabsContent>

            <TabsContent value="security" className="space-y-6">
              <div className="rounded-lg border-2 border-border bg-card p-4 space-y-4">
                <h3 className="text-lg font-semibold">
                  {t("admin.databaseSecurity")}
                </h3>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="p-4 border rounded-lg bg-surface">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Download className="h-4 w-4 text-blue-500" />
                        <h4 className="font-semibold">{t("admin.export")}</h4>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t("admin.exportDescription")}
                      </p>
                      {showPasswordInput && (
                        <div className="space-y-2">
                          <Label htmlFor="export-password">Password</Label>
                          <PasswordInput
                            id="export-password"
                            value={exportPassword}
                            onChange={(e) => setExportPassword(e.target.value)}
                            placeholder="Enter your password"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                handleExportDatabase();
                              }
                            }}
                          />
                        </div>
                      )}
                      <Button
                        onClick={handleExportDatabase}
                        disabled={exportLoading}
                        className="w-full"
                      >
                        {exportLoading
                          ? t("admin.exporting")
                          : showPasswordInput
                            ? t("admin.confirmExport")
                            : t("admin.export")}
                      </Button>
                      {showPasswordInput && (
                        <Button
                          variant="outline"
                          onClick={() => {
                            setShowPasswordInput(false);
                            setExportPassword("");
                          }}
                          className="w-full"
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="p-4 border rounded-lg bg-surface">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Upload className="h-4 w-4 text-green-500" />
                        <h4 className="font-semibold">{t("admin.import")}</h4>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t("admin.importDescription")}
                      </p>
                      <div className="relative inline-block w-full mb-2">
                        <input
                          id="import-file-upload"
                          type="file"
                          accept=".sqlite,.db"
                          onChange={(e) =>
                            setImportFile(e.target.files?.[0] || null)
                          }
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full justify-start text-left"
                        >
                          <span
                            className="truncate"
                            title={
                              importFile?.name ||
                              t("admin.pleaseSelectImportFile")
                            }
                          >
                            {importFile
                              ? importFile.name
                              : t("admin.pleaseSelectImportFile")}
                          </span>
                        </Button>
                      </div>
                      {importFile && requiresImportPassword && (
                        <div className="space-y-2">
                          <Label htmlFor="import-password">Password</Label>
                          <PasswordInput
                            id="import-password"
                            value={importPassword}
                            onChange={(e) => setImportPassword(e.target.value)}
                            placeholder="Enter your password"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                handleImportDatabase();
                              }
                            }}
                          />
                        </div>
                      )}
                      <Button
                        onClick={handleImportDatabase}
                        disabled={
                          importLoading ||
                          !importFile ||
                          (requiresImportPassword && !importPassword.trim())
                        }
                        className="w-full"
                      >
                        {importLoading
                          ? t("admin.importing")
                          : t("admin.import")}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {linkAccountAlertOpen && (
        <Dialog
          open={linkAccountAlertOpen}
          onOpenChange={setLinkAccountAlertOpen}
        >
          <DialogContent className="sm:max-w-[500px] bg-canvas border-2 border-edge">
            <DialogHeader>
                              <DialogTitle className="flex items-center gap-2">
                                <Link2 className="w-5 h-5" />
                                {t("admin.linkOidcToPasswordAccount")}
                              </DialogTitle>              <DialogDescription className="text-muted-foreground">
                {t("admin.linkOidcToPasswordAccountDescription", {
                  username: linkOidcUser?.username,
                })}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <Alert variant="destructive">
                <AlertTitle>{t("admin.linkOidcWarningTitle")}</AlertTitle>
                <AlertDescription>
                  {t("admin.linkOidcWarningDescription")}
                  <ul className="list-disc list-inside mt-2 space-y-1">
                    <li>{t("admin.linkOidcActionDeleteUser")}</li>
                    <li>{t("admin.linkOidcActionAddCapability")}</li>
                    <li>{t("admin.linkOidcActionDualAuth")}</li>
                  </ul>
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <Label
                  htmlFor="link-target-username"
                  className="text-base font-semibold text-foreground"
                >
                  {t("admin.linkTargetUsernameLabel")}
                </Label>
                <Input
                  id="link-target-username"
                  value={linkTargetUsername}
                  onChange={(e) => setLinkTargetUsername(e.target.value)}
                  placeholder={t("admin.linkTargetUsernamePlaceholder")}
                  disabled={linkLoading}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && linkTargetUsername.trim()) {
                      handleLinkSubmit();
                    }
                  }}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setLinkAccountAlertOpen(false)}
                disabled={linkLoading}
              >
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handleLinkSubmit}
                disabled={linkLoading || !linkTargetUsername.trim()}
                variant="destructive"
              >
                {linkLoading
                  ? t("admin.linkingAccounts")
                  : t("admin.linkAccountsButton")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* New User Management Dialogs */}
      <CreateUserDialog
        open={createUserDialogOpen}
        onOpenChange={setCreateUserDialogOpen}
        onSuccess={handleCreateUserSuccess}
      />

      <UserEditDialog
        open={userEditDialogOpen}
        onOpenChange={setUserEditDialogOpen}
        user={selectedUserForEdit}
        currentUser={currentUser}
        onSuccess={handleEditUserSuccess}
        allowPasswordLogin={allowPasswordLogin}
      />
    </div>
  );
}

export default AdminSettings;
