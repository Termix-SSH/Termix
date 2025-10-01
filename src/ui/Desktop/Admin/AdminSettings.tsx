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
  Key,
  Lock,
  Download,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useConfirmation } from "@/hooks/use-confirmation.ts";
import {
  getOIDCConfig,
  getRegistrationAllowed,
  getUserList,
  updateRegistrationAllowed,
  updateOIDCConfig,
  disableOIDCConfig,
  makeUserAdmin,
  removeAdminStatus,
  deleteUser,
  getCookie,
  isElectron,
} from "@/ui/main-axios.ts";

interface AdminSettingsProps {
  isTopbarOpen?: boolean;
}

export function AdminSettings({
  isTopbarOpen = true,
}: AdminSettingsProps): React.ReactElement {
  const { t } = useTranslation();
  const { confirmWithToast } = useConfirmation();
  const { state: sidebarState } = useSidebar();

  const [allowRegistration, setAllowRegistration] = React.useState(true);
  const [regLoading, setRegLoading] = React.useState(false);

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
    }>
  >([]);
  const [usersLoading, setUsersLoading] = React.useState(false);
  const [newAdminUsername, setNewAdminUsername] = React.useState("");
  const [makeAdminLoading, setMakeAdminLoading] = React.useState(false);
  const [makeAdminError, setMakeAdminError] = React.useState<string | null>(
    null,
  );

  const [securityInitialized, setSecurityInitialized] = React.useState(true);

  const [exportLoading, setExportLoading] = React.useState(false);
  const [importLoading, setImportLoading] = React.useState(false);
  const [importFile, setImportFile] = React.useState<File | null>(null);
  const [exportPassword, setExportPassword] = React.useState("");
  const [showPasswordInput, setShowPasswordInput] = React.useState(false);
  const [importPassword, setImportPassword] = React.useState("");

  React.useEffect(() => {
    if (isElectron()) {
      const serverUrl = (window as any).configuredServerUrl;
      if (!serverUrl) {
        return;
      }
    }

    getOIDCConfig()
      .then((res) => {
        if (res) setOidcConfig(res);
      })
      .catch((err) => {
        if (!err.message?.includes("No server configured")) {
          toast.error(t("admin.failedToFetchOidcConfig"));
        }
      });
    fetchUsers();
  }, []);

  React.useEffect(() => {
    if (isElectron()) {
      const serverUrl = (window as any).configuredServerUrl;
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

  const fetchUsers = async () => {
    if (isElectron()) {
      const serverUrl = (window as any).configuredServerUrl;
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

  const handleToggleRegistration = async (checked: boolean) => {
    setRegLoading(true);
    try {
      await updateRegistrationAllowed(checked);
      setAllowRegistration(checked);
    } finally {
      setRegLoading(false);
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
    } catch (err: any) {
      setOidcError(
        err?.response?.data?.error || t("admin.failedToUpdateOidcConfig"),
      );
    } finally {
      setOidcLoading(false);
    }
  };

  const handleOIDCConfigChange = (field: string, value: string) => {
    setOidcConfig((prev) => ({ ...prev, [field]: value }));
  };

  const handleMakeUserAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdminUsername.trim()) return;
    setMakeAdminLoading(true);
    setMakeAdminError(null);
    try {
      await makeUserAdmin(newAdminUsername.trim());
      toast.success(t("admin.userIsNowAdmin", { username: newAdminUsername }));
      setNewAdminUsername("");
      fetchUsers();
    } catch (err: any) {
      setMakeAdminError(
        err?.response?.data?.error || t("admin.failedToMakeUserAdmin"),
      );
    } finally {
      setMakeAdminLoading(false);
    }
  };

  const handleRemoveAdminStatus = async (username: string) => {
    confirmWithToast(t("admin.removeAdminStatus", { username }), async () => {
      try {
        await removeAdminStatus(username);
        toast.success(t("admin.adminStatusRemoved", { username }));
        fetchUsers();
      } catch (err: any) {
        toast.error(t("admin.failedToRemoveAdminStatus"));
      }
    });
  };

  const handleDeleteUser = async (username: string) => {
    confirmWithToast(
      t("admin.deleteUser", { username }),
      async () => {
        try {
          await deleteUser(username);
          toast.success(t("admin.userDeletedSuccessfully", { username }));
          fetchUsers();
        } catch (err: any) {
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
        process.env.NODE_ENV === "development" &&
        (window.location.port === "3000" ||
          window.location.port === "5173" ||
          window.location.port === "" ||
          window.location.hostname === "localhost" ||
          window.location.hostname === "127.0.0.1");

      const apiUrl = isElectron()
        ? `${(window as any).configuredServerUrl}/database/export`
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
    } catch (err) {
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

    if (!importPassword.trim()) {
      toast.error(t("admin.passwordRequired"));
      return;
    }

    setImportLoading(true);
    try {
      const isDev =
        process.env.NODE_ENV === "development" &&
        (window.location.port === "3000" ||
          window.location.port === "5173" ||
          window.location.port === "" ||
          window.location.hostname === "localhost" ||
          window.location.hostname === "127.0.0.1");

      const apiUrl = isElectron()
        ? `${(window as any).configuredServerUrl}/database/import`
        : isDev
          ? `http://localhost:30001/database/import`
          : `${window.location.protocol}//${window.location.host}/database/import`;

      const formData = new FormData();
      formData.append("file", importFile);
      formData.append("password", importPassword);

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
    } catch (err) {
      toast.error(t("admin.databaseImportFailed"));
    } finally {
      setImportLoading(false);
    }
  };

  const topMarginPx = isTopbarOpen ? 74 : 26;
  const leftMarginPx = sidebarState === "collapsed" ? 26 : 8;
  const bottomMarginPx = 8;
  const wrapperStyle: React.CSSProperties = {
    marginLeft: leftMarginPx,
    marginRight: 17,
    marginTop: topMarginPx,
    marginBottom: bottomMarginPx,
    height: `calc(100vh - ${topMarginPx + bottomMarginPx}px)`,
  };

  return (
    <div
      style={wrapperStyle}
      className="bg-dark-bg text-white rounded-lg border-2 border-dark-border overflow-hidden"
    >
      <div className="h-full w-full flex flex-col">
        <div className="flex items-center justify-between px-3 pt-2 pb-2">
          <h1 className="font-bold text-lg">{t("admin.title")}</h1>
        </div>
        <Separator className="p-0.25 w-full" />

        <div className="px-6 py-4 overflow-auto">
          <Tabs defaultValue="registration" className="w-full">
            <TabsList className="mb-4 bg-dark-bg border-2 border-dark-border">
              <TabsTrigger
                value="registration"
                className="flex items-center gap-2"
              >
                <Users className="h-4 w-4" />
                {t("admin.general")}
              </TabsTrigger>
              <TabsTrigger value="oidc" className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                OIDC
              </TabsTrigger>
              <TabsTrigger value="users" className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                {t("admin.users")}
              </TabsTrigger>
              <TabsTrigger value="admins" className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                {t("admin.adminManagement")}
              </TabsTrigger>
              <TabsTrigger value="security" className="flex items-center gap-2">
                <Database className="h-4 w-4" />
                {t("admin.databaseSecurity")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="registration" className="space-y-6">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">
                  {t("admin.userRegistration")}
                </h3>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={allowRegistration}
                    onCheckedChange={handleToggleRegistration}
                    disabled={regLoading}
                  />
                  {t("admin.allowNewAccountRegistration")}
                </label>
              </div>
            </TabsContent>

            <TabsContent value="oidc" className="space-y-6">
              <div className="space-y-3">
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
                        } catch (err: any) {
                          setOidcError(
                            err?.response?.data?.error ||
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
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">
                    {t("admin.userManagement")}
                  </h3>
                  <Button
                    onClick={fetchUsers}
                    disabled={usersLoading}
                    variant="outline"
                    size="sm"
                  >
                    {usersLoading ? t("admin.loading") : t("admin.refresh")}
                  </Button>
                </div>
                {usersLoading ? (
                  <div className="text-center py-8 text-muted-foreground">
                    {t("admin.loadingUsers")}
                  </div>
                ) : (
                  <div className="border rounded-md overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="px-4">
                            {t("admin.username")}
                          </TableHead>
                          <TableHead className="px-4">
                            {t("admin.type")}
                          </TableHead>
                          <TableHead className="px-4">
                            {t("admin.actions")}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {users.map((user) => (
                          <TableRow key={user.id}>
                            <TableCell className="px-4 font-medium">
                              {user.username}
                              {user.is_admin && (
                                <span className="ml-2 inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-muted/50 text-muted-foreground border border-border">
                                  {t("admin.adminBadge")}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="px-4">
                              {user.is_oidc
                                ? t("admin.external")
                                : t("admin.local")}
                            </TableCell>
                            <TableCell className="px-4">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteUser(user.username)}
                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                disabled={user.is_admin}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="admins" className="space-y-6">
              <div className="space-y-6">
                <h3 className="text-lg font-semibold">
                  {t("admin.adminManagement")}
                </h3>
                <div className="space-y-4 p-6 border rounded-md bg-muted/50">
                  <h4 className="font-medium">{t("admin.makeUserAdmin")}</h4>
                  <form onSubmit={handleMakeUserAdmin} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="new-admin-username">
                        {t("admin.username")}
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          id="new-admin-username"
                          value={newAdminUsername}
                          onChange={(e) => setNewAdminUsername(e.target.value)}
                          placeholder={t("admin.enterUsernameToMakeAdmin")}
                          required
                        />
                        <Button
                          type="submit"
                          disabled={
                            makeAdminLoading || !newAdminUsername.trim()
                          }
                        >
                          {makeAdminLoading
                            ? t("admin.adding")
                            : t("admin.makeAdmin")}
                        </Button>
                      </div>
                    </div>
                    {makeAdminError && (
                      <Alert variant="destructive">
                        <AlertTitle>{t("common.error")}</AlertTitle>
                        <AlertDescription>{makeAdminError}</AlertDescription>
                      </Alert>
                    )}
                  </form>
                </div>

                <div className="space-y-4">
                  <h4 className="font-medium">{t("admin.currentAdmins")}</h4>
                  <div className="border rounded-md overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="px-4">
                            {t("admin.username")}
                          </TableHead>
                          <TableHead className="px-4">
                            {t("admin.type")}
                          </TableHead>
                          <TableHead className="px-4">
                            {t("admin.actions")}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {users
                          .filter((u) => u.is_admin)
                          .map((admin) => (
                            <TableRow key={admin.id}>
                              <TableCell className="px-4 font-medium">
                                {admin.username}
                                <span className="ml-2 inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-muted/50 text-muted-foreground border border-border">
                                  {t("admin.adminBadge")}
                                </span>
                              </TableCell>
                              <TableCell className="px-4">
                                {admin.is_oidc
                                  ? t("admin.external")
                                  : t("admin.local")}
                              </TableCell>
                              <TableCell className="px-4">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    handleRemoveAdminStatus(admin.username)
                                  }
                                  className="text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                                >
                                  <Shield className="h-4 w-4" />
                                  {t("admin.removeAdminButton")}
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="security" className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Database className="h-5 w-5" />
                  <h3 className="text-lg font-semibold">
                    {t("admin.databaseSecurity")}
                  </h3>
                </div>

                <div className="p-4 border rounded bg-card">
                  <div className="flex items-center gap-2">
                    <Lock className="h-4 w-4 text-green-500" />
                    <div>
                      <div className="text-sm font-medium">
                        {t("admin.encryptionStatus")}
                      </div>
                      <div className="text-xs text-green-500">
                        {t("admin.encryptionEnabled")}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="p-4 border rounded bg-card">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Download className="h-4 w-4 text-blue-500" />
                        <h4 className="font-medium">{t("admin.export")}</h4>
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

                  <div className="p-4 border rounded bg-card">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Upload className="h-4 w-4 text-green-500" />
                        <h4 className="font-medium">{t("admin.import")}</h4>
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
                      {importFile && (
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
                          importLoading || !importFile || !importPassword.trim()
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
    </div>
  );
}

export default AdminSettings;
