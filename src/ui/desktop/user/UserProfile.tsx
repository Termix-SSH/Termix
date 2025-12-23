import React, { useState, useEffect } from "react";
import { Label } from "@/components/ui/label.tsx";
import { Button } from "@/components/ui/button.tsx";
import { PasswordInput } from "@/components/ui/password-input.tsx";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { User, Shield, AlertCircle, Palette, Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { TOTPSetup } from "@/ui/desktop/user/TOTPSetup.tsx";
import {
  getUserInfo,
  getVersionInfo,
  deleteAccount,
  logoutUser,
  isElectron,
  getUserRoles,
  type UserRole,
} from "@/ui/main-axios.ts";
import { PasswordReset } from "@/ui/desktop/user/PasswordReset.tsx";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/ui/desktop/user/LanguageSwitcher.tsx";
import { useSidebar } from "@/components/ui/sidebar.tsx";

interface UserProfileProps {
  isTopbarOpen?: boolean;
  rightSidebarOpen?: boolean;
  rightSidebarWidth?: number;
}

async function handleLogout() {
  try {
    await logoutUser();

    if (isElectron()) {
      localStorage.removeItem("jwt");

      const configuredServerUrl = (
        window as Window &
          typeof globalThis & {
            configuredServerUrl?: string;
          }
      ).configuredServerUrl;

      if (configuredServerUrl) {
        const iframe = document.querySelector("iframe");
        if (iframe && iframe.contentWindow) {
          try {
            const serverOrigin = new URL(configuredServerUrl).origin;
            iframe.contentWindow.postMessage(
              {
                type: "CLEAR_AUTH_DATA",
                timestamp: Date.now(),
              },
              serverOrigin,
            );
          } catch (err) {
            console.error("User profile operation failed:", err);
          }
        }
      }
    }

    window.location.reload();
  } catch (error) {
    console.error("Logout failed:", error);
    window.location.reload();
  }
}

export function UserProfile({
  isTopbarOpen = true,
  rightSidebarOpen = false,
  rightSidebarWidth = 400,
}: UserProfileProps) {
  const { t } = useTranslation();
  const { state: sidebarState } = useSidebar();
  const { theme, setTheme } = useTheme();
  const [userInfo, setUserInfo] = useState<{
    username: string;
    is_admin: boolean;
    is_oidc: boolean;
    is_dual_auth: boolean;
    totp_enabled: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [versionInfo, setVersionInfo] = useState<{ version: string } | null>(
    null,
  );

  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [fileColorCoding, setFileColorCoding] = useState<boolean>(
    localStorage.getItem("fileColorCoding") !== "false",
  );
  const [commandAutocomplete, setCommandAutocomplete] = useState<boolean>(
    localStorage.getItem("commandAutocomplete") === "true",
  );
  const [terminalSyntaxHighlighting, setTerminalSyntaxHighlighting] =
    useState<boolean>(
      () => localStorage.getItem("terminalSyntaxHighlighting") === "true",
    );
  const [defaultSnippetFoldersCollapsed, setDefaultSnippetFoldersCollapsed] =
    useState<boolean>(
      localStorage.getItem("defaultSnippetFoldersCollapsed") !== "false",
    );
  const [showHostTags, setShowHostTags] = useState<boolean>(() => {
    const saved = localStorage.getItem("showHostTags");
    return saved !== null ? saved === "true" : true;
  });
  const [userRoles, setUserRoles] = useState<UserRole[]>([]);

  useEffect(() => {
    fetchUserInfo();
    fetchVersion();
  }, []);

  const fetchVersion = async () => {
    try {
      const info = await getVersionInfo();
      setVersionInfo({ version: info.localVersion });
    } catch {
      const { toast } = await import("sonner");
      toast.error(t("user.failedToLoadVersionInfo"));
    }
  };

  const fetchUserInfo = async () => {
    setLoading(true);
    setError(null);
    try {
      const info = await getUserInfo();
      setUserInfo({
        username: info.username,
        is_admin: info.is_admin,
        is_oidc: info.is_oidc,
        is_dual_auth: info.is_dual_auth || false,
        totp_enabled: info.totp_enabled || false,
      });

      // Fetch user roles
      try {
        const rolesResponse = await getUserRoles(info.userId);
        setUserRoles(rolesResponse.roles || []);
      } catch (rolesErr) {
        console.error("Failed to fetch user roles:", rolesErr);
        setUserRoles([]);
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error?.response?.data?.error || t("errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleTOTPStatusChange = (enabled: boolean) => {
    if (userInfo) {
      setUserInfo({ ...userInfo, totp_enabled: enabled });
    }
  };

  const handleFileColorCodingToggle = (enabled: boolean) => {
    setFileColorCoding(enabled);
    localStorage.setItem("fileColorCoding", enabled.toString());
    window.dispatchEvent(new Event("fileColorCodingChanged"));
  };

  const handleCommandAutocompleteToggle = (enabled: boolean) => {
    setCommandAutocomplete(enabled);
    localStorage.setItem("commandAutocomplete", enabled.toString());
  };

  const handleTerminalSyntaxHighlightingToggle = (enabled: boolean) => {
    setTerminalSyntaxHighlighting(enabled);
    localStorage.setItem("terminalSyntaxHighlighting", enabled.toString());
    window.dispatchEvent(new Event("terminalSyntaxHighlightingChanged"));
  };

  const handleDefaultSnippetFoldersCollapsedToggle = (enabled: boolean) => {
    setDefaultSnippetFoldersCollapsed(enabled);
    localStorage.setItem("defaultSnippetFoldersCollapsed", enabled.toString());
    window.dispatchEvent(new Event("defaultSnippetFoldersCollapsedChanged"));
  };

  const handleShowHostTagsToggle = (enabled: boolean) => {
    setShowHostTags(enabled);
    localStorage.setItem("showHostTags", enabled.toString());
    window.dispatchEvent(new Event("showHostTagsChanged"));
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeleteLoading(true);
    setDeleteError(null);

    if (!deletePassword.trim()) {
      setDeleteError(t("leftSidebar.passwordRequired"));
      setDeleteLoading(false);
      return;
    }

    try {
      await deleteAccount(deletePassword);
      handleLogout();
    } catch (err: unknown) {
      setDeleteError(
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error || t("leftSidebar.failedToDeleteAccount"),
      );
      setDeleteLoading(false);
    }
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

  if (loading) {
    return (
      <div
        style={wrapperStyle}
        className="bg-canvas text-foreground rounded-lg border-2 border-edge overflow-hidden"
      >
        <div className="h-full w-full flex flex-col">
          <div className="flex items-center justify-between px-3 pt-2 pb-2">
            <h1 className="font-bold text-lg">{t("nav.userProfile")}</h1>
          </div>
          <Separator className="p-0.25 w-full" />
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-pulse text-foreground-secondary">
              {t("common.loading")}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !userInfo) {
    return (
      <div
        style={wrapperStyle}
        className="bg-canvas text-foreground rounded-lg border-2 border-edge overflow-hidden"
      >
        <div className="h-full w-full flex flex-col">
          <div className="flex items-center justify-between px-3 pt-2 pb-2">
            <h1 className="font-bold text-lg">{t("nav.userProfile")}</h1>
          </div>
          <Separator className="p-0.25 w-full" />
          <div className="flex-1 flex items-center justify-center p-6">
            <Alert
              variant="destructive"
              className="bg-red-900/20 border-red-500/50"
            >
              <AlertCircle className="h-4 w-4" />
              <AlertTitle className="text-red-400">
                {t("common.error")}
              </AlertTitle>
              <AlertDescription className="text-red-300">
                {error || t("errors.loadFailed")}
              </AlertDescription>
            </Alert>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        style={wrapperStyle}
        className="bg-canvas text-foreground rounded-lg border-2 border-edge overflow-hidden"
      >
        <div className="h-full w-full flex flex-col">
          <div className="flex items-center justify-between px-3 pt-2 pb-2">
            <h1 className="font-bold text-lg">{t("nav.userProfile")}</h1>
          </div>
          <Separator className="p-0.25 w-full" />

          <div className="px-6 py-4 overflow-auto thin-scrollbar flex-1">
            <Tabs defaultValue="profile" className="w-full">
              <TabsList className="mb-4 bg-elevated border-2 border-edge">
                <TabsTrigger
                  value="profile"
                  className="flex items-center gap-2 bg-elevated data-[state=active]:bg-button data-[state=active]:border data-[state=active]:border-edge"
                >
                  <User className="w-4 h-4" />
                  {t("profile.account")}
                </TabsTrigger>
                <TabsTrigger
                  value="appearance"
                  className="flex items-center gap-2 data-[state=active]:bg-button"
                >
                  <Palette className="w-4 h-4" />
                  {t("profile.appearance")}
                </TabsTrigger>
                {(!userInfo.is_oidc || userInfo.is_dual_auth) && (
                  <TabsTrigger
                    value="security"
                    className="flex items-center gap-2 bg-elevated data-[state=active]:bg-button data-[state=active]:border data-[state=active]:border-edge"
                  >
                    <Shield className="w-4 h-4" />
                    {t("profile.security")}
                  </TabsTrigger>
                )}
              </TabsList>

              <TabsContent value="profile" className="space-y-4">
                <div className="rounded-lg border-2 border-edge bg-elevated p-4">
                  <h3 className="text-lg font-semibold mb-4">
                    {t("profile.accountInfo")}
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-foreground-secondary">
                        {t("common.username")}
                      </Label>
                      <p className="text-lg font-medium mt-1 text-foreground">
                        {userInfo.username}
                      </p>
                    </div>
                    <div>
                      <Label className="text-foreground-secondary">
                        {t("profile.role")}
                      </Label>
                      <div className="mt-1">
                        {userRoles.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {userRoles.map((role) => (
                              <span
                                key={role.roleId}
                                className="inline-flex items-center px-2.5 py-1 rounded-md text-sm font-medium bg-muted/50 text-foreground border border-border"
                              >
                                {t(role.roleDisplayName)}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-lg font-medium text-foreground">
                            {userInfo.is_admin
                              ? t("interface.administrator")
                              : t("interface.user")}
                          </p>
                        )}
                      </div>
                    </div>
                    <div>
                      <Label className="text-foreground-secondary">
                        {t("profile.authMethod")}
                      </Label>
                      <p className="text-lg font-medium mt-1 text-foreground">
                        {userInfo.is_dual_auth
                          ? t("profile.externalAndLocal")
                          : userInfo.is_oidc
                            ? t("profile.external")
                            : t("profile.local")}
                      </p>
                    </div>
                    <div>
                      <Label className="text-foreground-secondary">
                        {t("profile.twoFactorAuth")}
                      </Label>
                      <p className="text-lg font-medium mt-1">
                        {userInfo.is_oidc && !userInfo.is_dual_auth ? (
                          <span className="text-muted-foreground">
                            {t("auth.lockedOidcAuth")}
                          </span>
                        ) : userInfo.totp_enabled ? (
                          <span className="text-green-400 flex items-center gap-1">
                            <Shield className="w-4 h-4" />
                            {t("common.enabled")}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            {t("common.disabled")}
                          </span>
                        )}
                      </p>
                    </div>
                    <div>
                      <Label className="text-foreground-secondary">
                        {t("common.version")}
                      </Label>
                      <p className="text-lg font-medium mt-1 text-foreground">
                        {versionInfo?.version || t("common.loading")}
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 pt-6 border-t border-edge">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-red-400">
                          {t("leftSidebar.deleteAccount")}
                        </Label>
                        <p className="text-sm text-muted-foreground mt-1">
                          {t(
                            "leftSidebar.deleteAccountWarningShort",
                            "This action is not reversible and will permanently delete your account.",
                          )}
                        </p>
                      </div>
                      <Button
                        variant="destructive"
                        onClick={() => setDeleteAccountOpen(true)}
                      >
                        {t("leftSidebar.deleteAccount")}
                      </Button>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="appearance" className="space-y-4">
                {/* Language & Localization Section */}
                <div className="rounded-lg border-2 border-edge bg-elevated p-4">
                  <h3 className="text-lg font-semibold mb-4">
                    {t("profile.languageLocalization")}
                  </h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-foreground-secondary">
                          {t("common.language")}
                        </Label>
                        <p className="text-sm text-muted-foreground mt-1">
                          {t("profile.selectPreferredLanguage")}
                        </p>
                      </div>
                      <LanguageSwitcher />
                    </div>
                  </div>
                </div>

                {/* Theme Section */}
                <div className="rounded-lg border-2 border-edge bg-elevated p-4">
                  <h3 className="text-lg font-semibold mb-4">
                    {t("profile.appearance", "Appearance")}
                  </h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-foreground-secondary">
                          {t("profile.theme", "Theme")}
                        </Label>
                        <p className="text-sm text-muted-foreground mt-1">
                          {t("profile.appearanceDesc", "Choose your preferred theme")}
                        </p>
                      </div>
                      <Select value={theme} onValueChange={setTheme}>
                        <SelectTrigger className="w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="light">
                            <div className="flex items-center gap-2">
                              <Sun className="w-4 h-4" />
                              {t("profile.themeLight", "Light")}
                            </div>
                          </SelectItem>
                          <SelectItem value="dark">
                            <div className="flex items-center gap-2">
                              <Moon className="w-4 h-4" />
                              {t("profile.themeDark", "Dark")}
                            </div>
                          </SelectItem>
                          <SelectItem value="system">
                            <div className="flex items-center gap-2">
                              <Monitor className="w-4 h-4" />
                              {t("profile.themeSystem", "System")}
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* File Manager Section */}
                <div className="rounded-lg border-2 border-edge bg-elevated p-4">
                  <h3 className="text-lg font-semibold mb-4">
                    {t("profile.fileManagerSettings")}
                  </h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-foreground-secondary">
                          {t("profile.fileColorCoding")}
                        </Label>
                        <p className="text-sm text-muted-foreground mt-1">
                          {t("profile.fileColorCodingDesc")}
                        </p>
                      </div>
                      <Switch
                        checked={fileColorCoding}
                        onCheckedChange={handleFileColorCodingToggle}
                      />
                    </div>
                  </div>
                </div>

                {/* Terminal Section */}
                <div className="rounded-lg border-2 border-edge bg-elevated p-4">
                  <h3 className="text-lg font-semibold mb-4">
                    {t("profile.terminalSettings")}
                  </h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-foreground-secondary">
                          {t("profile.commandAutocomplete")}
                        </Label>
                        <p className="text-sm text-muted-foreground mt-1">
                          {t("profile.commandAutocompleteDesc")}
                        </p>
                      </div>
                      <Switch
                        checked={commandAutocomplete}
                        onCheckedChange={handleCommandAutocompleteToggle}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-foreground-secondary">
                          Terminal Syntax Highlighting{" "}
                          <span className="text-xs text-yellow-500 font-semibold">
                            (BETA)
                          </span>
                        </Label>
                        <p className="text-sm text-muted-foreground mt-1">
                          Automatically highlight commands, paths, IPs, and log
                          levels in terminal output
                        </p>
                      </div>
                      <Switch
                        checked={terminalSyntaxHighlighting}
                        onCheckedChange={handleTerminalSyntaxHighlightingToggle}
                      />
                    </div>
                  </div>
                </div>

                {/* Host & Sidebar Section */}
                <div className="rounded-lg border-2 border-edge bg-elevated p-4">
                  <h3 className="text-lg font-semibold mb-4">
                    {t("profile.hostSidebarSettings")}
                  </h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-foreground-secondary">
                          {t("profile.showHostTags")}
                        </Label>
                        <p className="text-sm text-muted-foreground mt-1">
                          {t("profile.showHostTagsDesc")}
                        </p>
                      </div>
                      <Switch
                        checked={showHostTags}
                        onCheckedChange={handleShowHostTagsToggle}
                      />
                    </div>
                  </div>
                </div>

                {/* Snippets Section */}
                <div className="rounded-lg border-2 border-edge bg-elevated p-4">
                  <h3 className="text-lg font-semibold mb-4">
                    {t("profile.snippetsSettings")}
                  </h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-foreground-secondary">
                          {t("profile.defaultSnippetFoldersCollapsed")}
                        </Label>
                        <p className="text-sm text-muted-foreground mt-1">
                          {t("profile.defaultSnippetFoldersCollapsedDesc")}
                        </p>
                      </div>
                      <Switch
                        checked={defaultSnippetFoldersCollapsed}
                        onCheckedChange={
                          handleDefaultSnippetFoldersCollapsedToggle
                        }
                      />
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="security" className="space-y-4">
                <TOTPSetup
                  isEnabled={userInfo.totp_enabled}
                  onStatusChange={handleTOTPStatusChange}
                />

                {(!userInfo.is_oidc || userInfo.is_dual_auth) && (
                  <PasswordReset userInfo={userInfo} />
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
      {deleteAccountOpen && (
        <div
          className="fixed top-0 left-0 right-0 bottom-0 z-[999999] pointer-events-auto isolate"
          style={{
            transform: "translateZ(0)",
            willChange: "z-index",
          }}
        >
          <div
            className="w-[400px] h-full bg-canvas border-r-2 border-edge flex flex-col shadow-2xl relative isolate z-[9999999]"
            style={{
              boxShadow: "4px 0 20px rgba(0, 0, 0, 0.5)",
              transform: "translateZ(0)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-edge">
              <h2 className="text-lg font-semibold text-foreground">
                {t("leftSidebar.deleteAccount")}
              </h2>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDeleteAccountOpen(false);
                  setDeletePassword("");
                  setDeleteError(null);
                }}
                className="h-8 w-8 p-0 hover:bg-red-500 hover:text-foreground transition-colors flex items-center justify-center"
                title={t("leftSidebar.closeDeleteAccount")}
              >
                <span className="text-lg font-bold leading-none">×</span>
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 thin-scrollbar">
              <div className="space-y-4">
                <div className="text-sm text-foreground-secondary">
                  {t("leftSidebar.deleteAccountWarning")}
                  <Alert variant="destructive" className="mb-5 mt-5">
                    <AlertTitle>{t("common.warning")}</AlertTitle>
                    <AlertDescription>
                      {t("leftSidebar.deleteAccountWarningDetails")}
                    </AlertDescription>
                  </Alert>

                  {deleteError && (
                    <Alert variant="destructive">
                      <AlertTitle>{t("common.error")}</AlertTitle>
                      <AlertDescription>{deleteError}</AlertDescription>
                    </Alert>
                  )}

                  <form onSubmit={handleDeleteAccount} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="delete-password">
                        {t("leftSidebar.confirmPassword")}
                      </Label>
                      <PasswordInput
                        id="delete-password"
                        value={deletePassword}
                        onChange={(e) => setDeletePassword(e.target.value)}
                        placeholder={t("placeholders.confirmPassword")}
                        required
                      />
                    </div>

                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        variant="destructive"
                        className="flex-1"
                        disabled={deleteLoading || !deletePassword.trim()}
                      >
                        {deleteLoading
                          ? t("leftSidebar.deleting")
                          : t("leftSidebar.deleteAccount")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setDeleteAccountOpen(false);
                          setDeletePassword("");
                          setDeleteError(null);
                        }}
                      >
                        {t("leftSidebar.cancel")}
                      </Button>
                    </div>
                  </form>
                </div>
              </div>
            </div>

            <div
              className="flex-1 cursor-pointer"
              onClick={() => {
                setDeleteAccountOpen(false);
                setDeletePassword("");
                setDeleteError(null);
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
