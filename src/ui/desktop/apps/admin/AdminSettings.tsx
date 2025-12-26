import React from "react";
import { useSidebar } from "@/components/ui/sidebar.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs.tsx";
import { Shield, Users, Database, Clock } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useConfirmation } from "@/hooks/use-confirmation.ts";
import {
  getAdminOIDCConfig,
  getRegistrationAllowed,
  getPasswordLoginAllowed,
  getUserList,
  getUserInfo,
  isElectron,
  getSessions,
  unlinkOIDCFromPasswordAccount,
} from "@/ui/main-axios.ts";
import { RolesTab } from "@/ui/desktop/apps/admin/tabs/RolesTab.tsx";
import { GeneralSettingsTab } from "@/ui/desktop/apps/admin/tabs/GeneralSettingsTab.tsx";
import { OIDCSettingsTab } from "@/ui/desktop/apps/admin/tabs/OIDCSettingsTab.tsx";
import { UserManagementTab } from "@/ui/desktop/apps/admin/tabs/UserManagementTab.tsx";
import { SessionManagementTab } from "@/ui/desktop/apps/admin/tabs/SessionManagementTab.tsx";
import { DatabaseSecurityTab } from "@/ui/desktop/apps/admin/tabs/DatabaseSecurityTab.tsx";
import { CreateUserDialog } from "./dialogs/CreateUserDialog.tsx";
import { UserEditDialog } from "./dialogs/UserEditDialog.tsx";
import { LinkAccountDialog } from "./dialogs/LinkAccountDialog.tsx";

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
  const [allowPasswordLogin, setAllowPasswordLogin] = React.useState(true);

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

  const [currentUser, setCurrentUser] = React.useState<{
    id: string;
    username: string;
    is_admin: boolean;
    is_oidc: boolean;
  } | null>(null);

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

  const handleLinkOIDCUser = (user: { id: string; username: string }) => {
    setLinkOidcUser(user);
    setLinkAccountAlertOpen(true);
  };

  const handleLinkSuccess = () => {
    fetchUsers();
    fetchSessions();
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
              <TabsTrigger
                value="oidc"
                className="flex items-center gap-2 bg-elevated data-[state=active]:bg-button data-[state=active]:border data-[state=active]:border-edge"
              >
                <Shield className="h-4 w-4" />
                OIDC
              </TabsTrigger>
              <TabsTrigger
                value="users"
                className="flex items-center gap-2 bg-elevated data-[state=active]:bg-button data-[state=active]:border data-[state=active]:border-edge"
              >
                <Users className="h-4 w-4" />
                {t("admin.users")}
              </TabsTrigger>
              <TabsTrigger
                value="sessions"
                className="flex items-center gap-2 bg-elevated data-[state=active]:bg-button data-[state=active]:border data-[state=active]:border-edge"
              >
                <Clock className="h-4 w-4" />
                Sessions
              </TabsTrigger>
              <TabsTrigger
                value="roles"
                className="flex items-center gap-2 bg-elevated data-[state=active]:bg-button data-[state=active]:border data-[state=active]:border-edge"
              >
                <Shield className="h-4 w-4" />
                {t("rbac.roles.label")}
              </TabsTrigger>
              <TabsTrigger
                value="security"
                className="flex items-center gap-2 bg-elevated data-[state=active]:bg-button data-[state=active]:border data-[state=active]:border-edge"
              >
                <Database className="h-4 w-4" />
                {t("admin.databaseSecurity")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="registration" className="space-y-6">
              <GeneralSettingsTab
                allowRegistration={allowRegistration}
                setAllowRegistration={setAllowRegistration}
                allowPasswordLogin={allowPasswordLogin}
                setAllowPasswordLogin={setAllowPasswordLogin}
                oidcConfig={oidcConfig}
              />
            </TabsContent>

            <TabsContent value="oidc" className="space-y-6">
              <OIDCSettingsTab
                allowPasswordLogin={allowPasswordLogin}
                oidcConfig={oidcConfig}
                setOidcConfig={setOidcConfig}
              />
            </TabsContent>

            <TabsContent value="users" className="space-y-6">
              <UserManagementTab
                users={users}
                usersLoading={usersLoading}
                allowPasswordLogin={allowPasswordLogin}
                fetchUsers={fetchUsers}
                onCreateUser={() => setCreateUserDialogOpen(true)}
                onEditUser={handleEditUser}
                onLinkOIDCUser={handleLinkOIDCUser}
                onUnlinkOIDC={handleUnlinkOIDC}
              />
            </TabsContent>

            <TabsContent value="sessions" className="space-y-6">
              <SessionManagementTab
                sessions={sessions}
                sessionsLoading={sessionsLoading}
                fetchSessions={fetchSessions}
              />
            </TabsContent>

            <TabsContent value="roles" className="space-y-6">
              <div className="rounded-lg border-2 border-border bg-card p-4 space-y-4">
                <RolesTab />
              </div>
            </TabsContent>

            <TabsContent value="security" className="space-y-6">
              <DatabaseSecurityTab currentUser={currentUser} />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Dialogs */}
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

      <LinkAccountDialog
        open={linkAccountAlertOpen}
        onOpenChange={setLinkAccountAlertOpen}
        oidcUser={linkOidcUser}
        onSuccess={handleLinkSuccess}
      />
    </div>
  );
}

export default AdminSettings;
