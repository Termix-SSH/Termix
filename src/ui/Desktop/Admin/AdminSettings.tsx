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
import { Shield, Trash2, Users, Database, Key, Lock } from "lucide-react";
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

  // Database encryption state
  const [encryptionStatus, setEncryptionStatus] = React.useState<any>(null);
  const [encryptionLoading, setEncryptionLoading] = React.useState(false);
  const [migrationLoading, setMigrationLoading] = React.useState(false);
  const [migrationProgress, setMigrationProgress] = React.useState<string>("");

  React.useEffect(() => {
    const jwt = getCookie("jwt");
    if (!jwt) return;

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
    fetchEncryptionStatus();
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
    const jwt = getCookie("jwt");
    if (!jwt) return;

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
    const jwt = getCookie("jwt");
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

    const jwt = getCookie("jwt");
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
    const jwt = getCookie("jwt");
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
      const jwt = getCookie("jwt");
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
        const jwt = getCookie("jwt");
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

  const fetchEncryptionStatus = async () => {
    if (isElectron()) {
      const serverUrl = (window as any).configuredServerUrl;
      if (!serverUrl) return;
    }

    try {
      const jwt = getCookie("jwt");
      const apiUrl = isElectron()
        ? `${(window as any).configuredServerUrl}/encryption/status`
        : "http://localhost:8081/encryption/status";

      const response = await fetch(apiUrl, {
        headers: {
          "Authorization": `Bearer ${jwt}`,
          "Content-Type": "application/json"
        }
      });

      if (response.ok) {
        const data = await response.json();
        setEncryptionStatus(data);
      }
    } catch (err) {
      console.error("Failed to fetch encryption status:", err);
    }
  };

  const handleInitializeEncryption = async () => {
    setEncryptionLoading(true);
    try {
      const jwt = getCookie("jwt");
      const apiUrl = isElectron()
        ? `${(window as any).configuredServerUrl}/encryption/initialize`
        : "http://localhost:8081/encryption/initialize";

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${jwt}`,
          "Content-Type": "application/json"
        },
      });

      if (response.ok) {
        const result = await response.json();
        toast.success("Database encryption initialized successfully!");
        await fetchEncryptionStatus();
      } else {
        throw new Error("Failed to initialize encryption");
      }
    } catch (err) {
      toast.error("Failed to initialize encryption");
    } finally {
      setEncryptionLoading(false);
    }
  };

  const handleMigrateData = async (dryRun: boolean = false) => {
    setMigrationLoading(true);
    setMigrationProgress(dryRun ? "Running dry run..." : "Starting migration...");

    try {
      const jwt = getCookie("jwt");
      const apiUrl = isElectron()
        ? `${(window as any).configuredServerUrl}/encryption/migrate`
        : "http://localhost:8081/encryption/migrate";

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${jwt}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ dryRun }),
      });

      if (response.ok) {
        const result = await response.json();
        if (dryRun) {
          toast.success("Dry run completed - no data was changed");
          setMigrationProgress("Dry run completed");
        } else {
          toast.success("Data migration completed successfully!");
          setMigrationProgress("Migration completed");
          await fetchEncryptionStatus();
        }
      } else {
        throw new Error("Migration failed");
      }
    } catch (err) {
      toast.error(dryRun ? "Dry run failed" : "Migration failed");
      setMigrationProgress("Failed");
    } finally {
      setMigrationLoading(false);
      setTimeout(() => setMigrationProgress(""), 3000);
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
              <div className="space-y-6">
                <div className="flex items-center gap-2">
                  <Database className="h-5 w-5" />
                  <h3 className="text-lg font-semibold">Database Encryption</h3>
                </div>

                {encryptionStatus && (
                  <div className="space-y-4">
                    <div className="p-4 border rounded-md bg-muted/50">
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          {encryptionStatus.encryption?.enabled ? (
                            <Lock className="h-4 w-4 text-green-600" />
                          ) : (
                            <Key className="h-4 w-4 text-yellow-600" />
                          )}
                          <span className="font-medium">
                            {t("admin.encryptionStatus")}: {" "}
                            {encryptionStatus.encryption?.enabled ? (
                              <span className="text-green-600">{t("admin.enabled")}</span>
                            ) : (
                              <span className="text-yellow-600">{t("admin.disabled")}</span>
                            )}
                          </span>
                        </div>

                        {encryptionStatus.encryption?.key && (
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div>
                                <span className="text-muted-foreground">{t("admin.keyId")}:</span>
                                <div className="font-mono text-xs bg-background rounded px-2 py-1 mt-1">
                                  {encryptionStatus.encryption.key.keyId || "Not available"}
                                </div>
                              </div>
                              <div>
                                <span className="text-muted-foreground">{t("admin.created")}:</span>
                                <div className="text-xs mt-1">
                                  {encryptionStatus.encryption.key.createdAt
                                    ? new Date(encryptionStatus.encryption.key.createdAt).toLocaleDateString()
                                    : "Not available"}
                                </div>
                              </div>
                            </div>

                            {/* KEK Protection Status */}
                            <div className="flex items-center gap-2 p-2 rounded-md bg-background border">
                              {encryptionStatus.encryption.key.kekProtected ? (
                                <>
                                  <Shield className="h-4 w-4 text-green-600" />
                                  <div className="flex-1">
                                    <div className="text-sm font-medium text-green-600">
                                      {t("admin.deviceProtectedMasterKey")}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {t("admin.masterKeyEncryptedWithDeviceFingerprint")}
                                    </div>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <Shield className="h-4 w-4 text-yellow-600" />
                                  <div className="flex-1">
                                    <div className="text-sm font-medium text-yellow-600">
                                      {t("admin.legacyKeyStorage")}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {t("admin.keyNotProtectedByDeviceBinding")}
                                    </div>
                                  </div>
                                </>
                              )}
                              {encryptionStatus.encryption.key.kekValid && (
                                <div className="text-xs text-green-600 font-medium">✓ {t("admin.valid")}</div>
                              )}
                            </div>
                          </div>
                        )}

                        <div className="text-sm">
                          <span className="text-muted-foreground">{t("admin.migrationStatus")}:</span>
                          <div className="mt-1">
                            {encryptionStatus.migration?.migrationCompleted ? (
                              <span className="text-green-600">✓ {t("admin.migrationCompleted")}</span>
                            ) : (
                              <span className="text-yellow-600">⚠ {t("admin.migrationRequired")}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {!encryptionStatus.encryption?.key?.hasKey ? (
                        <div className="space-y-3">
                          <h4 className="font-medium">{t("admin.initializeDatabaseEncryption")}</h4>
                          <p className="text-sm text-muted-foreground">
                            {t("admin.enableAes256EncryptionWithDeviceBinding")}
                                                      </p>
                          <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                            <div className="text-sm text-blue-800">
                              <div className="font-medium">{t("admin.featuresEnabled")}</div>
                              <div className="mt-1 space-y-1 text-xs">
                                <div>• {t("admin.aes256GcmAuthenticatedEncryption")}</div>
                                <div>• {t("admin.deviceFingerprintMasterKeyProtection")}</div>
                                <div>• {t("admin.pbkdf2KeyDerivation")}</div>
                                <div>• {t("admin.automaticKeyManagement")}</div>
                              </div>
                            </div>
                          </div>
                          <Button
                            onClick={handleInitializeEncryption}
                            disabled={encryptionLoading}
                            className="flex items-center gap-2"
                          >
                            <Shield className="h-4 w-4" />
                            {encryptionLoading ? t("admin.initializing") : t("admin.initializeEnterpriseEncryption")}
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {!encryptionStatus.migration?.migrationCompleted && (
                            <div className="space-y-3">
                              <h4 className="font-medium">{t("admin.migrateExistingData")}</h4>
                              <p className="text-sm text-muted-foreground">
                                {t("admin.encryptExistingUnprotectedData")}
                              </p>

                              {migrationProgress && (
                                <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                                  <div className="text-sm text-blue-800">{migrationProgress}</div>
                                </div>
                              )}

                              <div className="flex gap-2">
                                <Button
                                  onClick={() => handleMigrateData(true)}
                                  disabled={migrationLoading}
                                  variant="outline"
                                  size="sm"
                                >
                                  {t("admin.testMigrationDryRun")}
                                </Button>
                                <Button
                                  onClick={() => handleMigrateData(false)}
                                  disabled={migrationLoading}
                                  className="flex items-center gap-2"
                                >
                                  <Database className="h-4 w-4" />
                                  {migrationLoading ? t("admin.migrating") : t("admin.migrateData")}
                                </Button>
                              </div>
                            </div>
                          )}

                          <div className="space-y-3">
                            <h4 className="font-medium">{t("admin.securityInformation")}</h4>
                            <div className="text-sm space-y-2 text-muted-foreground">
                              <div>• {t("admin.sshPrivateKeysEncryptedWithAes256")}</div>
                              <div>• {t("admin.userAuthTokensProtected")}</div>
                              <div>• {t("admin.masterKeysProtectedByDeviceFingerprint")}</div>
                              <div>• {t("admin.keysBoundToServerInstance")}</div>
                              <div>• {t("admin.pbkdf2HkdfKeyDerivation")}</div>
                              <div>• {t("admin.backwardCompatibleMigration")}</div>
                            </div>

                            {encryptionStatus.encryption?.key?.kekProtected && (
                              <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                                <div className="flex items-start gap-2">
                                  <Shield className="h-4 w-4 text-green-600 mt-0.5" />
                                  <div className="text-sm">
                                    <div className="font-medium text-green-800">{t("admin.enterpriseGradeSecurityActive")}</div>
                                    <div className="text-green-700 mt-1">
                                      {t("admin.masterKeysProtectedByDeviceBinding")}
                                                                                                                </div>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="p-4 border border-yellow-200 bg-yellow-50 rounded-md">
                            <div className="flex items-start gap-2">
                              <Shield className="h-4 w-4 text-yellow-600 mt-0.5" />
                              <div className="text-sm">
                                <div className="font-medium text-yellow-800">{t("admin.important")}</div>
                                <div className="text-yellow-700 mt-1">
                                  {t("admin.keepEncryptionKeysSecure")}
                                                                  </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {!encryptionStatus && (
                  <div className="text-center py-8">
                    <div className="text-muted-foreground">{t("admin.loadingEncryptionStatus")}</div>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

export default AdminSettings;
