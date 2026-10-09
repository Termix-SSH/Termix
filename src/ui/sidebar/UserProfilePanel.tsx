import { InlineView, useConfirm } from "@/components/surface/surface-scope";
import { FormFooter } from "@/components/list-kit";
import { useState, useRef, useEffect } from "react";
import { AuthEnrollmentSections } from "./AuthEnrollmentSections";
import { useTranslation } from "react-i18next";
import { copyToClipboard } from "@/lib/clipboard";
import {
  getUserInfo,
  getApiKeys,
  createApiKey,
  deleteApiKey,
  changePassword,
  deleteAccount,
  logoutUser,
  getVersionInfo,
  releaseUrlFrom,
  getUserRoles,
  saveUserPreferences,
  getUserPreferences,
} from "@/main-axios";
import { getDatabaseTransferUrl } from "@/lib/database-transfer-url";
import { readRailPreference, setRailPreference } from "./rail-preferences";
import { useHostSidebarPreferences } from "./tree/hooks/useHostSidebarPreferences";
import type { LinkedAccountInfo, UserRole } from "@/main-axios";
import type React from "react";
import { isElectron } from "@/lib/electron";
import { shell } from "@/plugin-host/shell-bridge";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { VersionBadge } from "@/components/version-badge";
import {
  AlertCircle,
  ChevronDown,
  Copy,
  Database,
  Eye,
  EyeOff,
  KeyRound,
  LayoutTemplate,
  Network,
  Palette,
  Plus,
  RotateCcw,
  Shield,
  ShieldCheck,
  Trash2,
  Type,
  User,
} from "lucide-react";
import { SettingRow, FakeSwitch } from "@/components/section-card";
import { NavigationVisibilityToggles } from "./NavigationVisibilityToggles";
import { InterfacePresetSettings } from "./InterfacePresetSettings";
import { useSettingsEmbedded } from "@/settings/settings-embed";
import { useUiPreferencesContext } from "@/contexts/UiPreferencesContext";
import {
  ACCENT_PRESET_COLORS,
  applyAccentColor,
  applyFontSize,
  applyUiFont,
  FONT_SIZES,
  UI_FONTS,
} from "@/lib/theme";
import type { ApiKey } from "@/main-axios";
import { useTheme } from "@/components/theme-provider";
import type { FontSizeId, ThemeId, UiFontId } from "@/types/ui-types";
import { toast } from "sonner";
import { changeAppLanguage, normalizeLanguageCode } from "@/i18n/i18n";
import { Select2 } from "@/components/select2";
import { LANGUAGES, THEMES } from "@/settings/appearance/appearance-controls";
import { clearLocalAdaptivePreferences } from "@/lib/local-adaptive-preferences";
import { reportBetaFeedbackUrl } from "@/lib/issue-url";
import { isPrerelease } from "@/plugins/plugin-model";
import {
  FeatureSettingsSection,
  featureSectionId,
  useFeatureSettings,
  type FeatureSectionId,
} from "@/settings/FeatureSettingsSections";
import { docsUrl } from "@/lib/docs";

type UserProfileSection =
  | "account"
  | "interface"
  | "appearance"
  | "security"
  | "api-keys"
  | "data"
  | FeatureSectionId;

export function AccordionSection({
  id,
  label,
  icon,
  open,
  onToggle,
  hidden = false,
  children,
}: {
  id: string;
  label: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  hidden?: boolean;
  children: React.ReactNode;
}) {
  const embedded = useSettingsEmbedded();
  if (hidden) return null;
  if (embedded) {
    if (!open) return null;
    return (
      <div
        id={`${id}-content`}
        className="flex flex-col border border-border bg-card px-3 pb-3"
      >
        {children}
      </div>
    );
  }

  return (
    <div className="border border-border bg-card overflow-hidden">
      <button
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`${id}-content`}
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
        <div id={`${id}-content`} className="border-t border-border px-3 pb-3">
          {children}
        </div>
      )}
    </div>
  );
}

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

type CreatedProfileApiKey = {
  id: string;
  name: string;
  token?: string;
  tokenPrefix?: string;
  createdAt?: string;
  expiresAt?: string | null;
};

export function NewApiKeyDialog({
  open,
  onOpenChange,
  onAdd,
  userId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdd: (key: CreatedProfileApiKey) => void;
  userId: string;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const close = () => {
    setName("");
    setExpiry("");
    setCreatedToken(null);
    onOpenChange(false);
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error(t("newUi.sidebar.userProfile.apiKeyNameRequired"));
      return;
    }
    if (creating) return;
    setCreating(true);
    try {
      const created = await createApiKey(
        name.trim(),
        userId,
        expiry ? new Date(expiry).toISOString() : undefined,
      );
      onAdd(created);
      setCreatedToken(created.token);
      toast.success(t("newUi.sidebar.userProfile.apiKeyCreated", { name }));
    } catch {
      toast.error(t("newUi.sidebar.userProfile.apiKeyCreateFailed"));
    } finally {
      setCreating(false);
    }
  };

  return (
    <InlineView
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen || !createdToken) onOpenChange(nextOpen);
      }}
      title={t("newUi.sidebar.userProfile.createApiKeyTitle")}
      footer={
        createdToken ? (
          <FormFooter
            onSave={close}
            saveLabel={t("newUi.sidebar.userProfile.done")}
          />
        ) : (
          <FormFooter
            onCancel={close}
            cancelLabel={t("newUi.sidebar.userProfile.cancel")}
            onSave={() => void handleCreate()}
            saveLabel={t("newUi.sidebar.userProfile.createKey")}
            saving={creating}
          />
        )
      }
    >
      <p className="text-xs text-muted-foreground">
        {t("newUi.sidebar.userProfile.createApiKeyDescription")}
      </p>
      {createdToken ? (
        <div className="flex flex-col gap-3 px-5 py-4">
          <span className="text-xs font-semibold text-accent-brand">
            {t("newUi.sidebar.userProfile.apiKeyCreatedWarning")}
          </span>
          <div className="flex items-center gap-2 border border-border bg-muted/30 px-2 py-2">
            <code className="min-w-0 flex-1 break-all text-xs text-accent-brand">
              {createdToken}
            </code>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label={t("newUi.sidebar.userProfile.copyApiKey")}
              onClick={() => {
                copyToClipboard(createdToken);
                toast.info(t("newUi.sidebar.userProfile.copiedToClipboard"));
              }}
            >
              <Copy className="size-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              {t("newUi.sidebar.userProfile.apiKeyNameLabel")}
            </label>
            <Input
              autoFocus
              placeholder={t("newUi.sidebar.userProfile.apiKeyNamePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              className="rounded-none bg-muted/50 border-border text-sm h-9"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              {t("newUi.sidebar.userProfile.expiryDateLabel")}{" "}
              <span className="text-muted-foreground/50 normal-case font-medium">
                ({t("newUi.sidebar.userProfile.optional")})
              </span>
            </label>
            <Input
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              className="rounded-none bg-muted/50 border-border text-sm h-9"
            />
          </div>
        </div>
      )}
    </InlineView>
  );
}

function PasswordChangeSection({
  showPassword,
  setShowPassword,
  onLogout,
}: {
  showPassword: boolean;
  setShowPassword: (v: boolean | ((prev: boolean) => boolean)) => void;
  onLogout?: () => void;
}) {
  const { t } = useTranslation();
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");

  async function handleUpdate() {
    if (!currentPw || !newPw) {
      toast.error(t("newUi.sidebar.userProfile.passwordFieldsRequired"));
      return;
    }
    if (newPw !== confirmPw) {
      toast.error(t("newUi.sidebar.userProfile.passwordMismatch"));
      return;
    }
    if (newPw.length < 6) {
      toast.error(t("newUi.sidebar.userProfile.passwordTooShort"));
      return;
    }
    try {
      await changePassword(currentPw, newPw);
      toast.success(t("newUi.sidebar.userProfile.passwordUpdated"));
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      onLogout?.();
    } catch (e: unknown) {
      toast.error(
        apiErrorMessage(e, t("newUi.sidebar.userProfile.passwordUpdateFailed")),
      );
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {t("newUi.sidebar.userProfile.changePassword")}
      </span>
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
          {t("newUi.sidebar.userProfile.currentPasswordLabel")}
        </label>
        <div className="relative">
          <Input
            type={showPassword ? "text" : "password"}
            placeholder={t(
              "newUi.sidebar.userProfile.currentPasswordPlaceholder",
            )}
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            className="pr-9 text-sm"
          />
          <button
            onClick={() => setShowPassword((o) => !o)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showPassword ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
          {t("newUi.sidebar.userProfile.newPasswordLabel")}
        </label>
        <Input
          type="password"
          placeholder={t("newUi.sidebar.userProfile.newPasswordPlaceholder")}
          value={newPw}
          onChange={(e) => setNewPw(e.target.value)}
          className="text-sm"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
          {t("newUi.sidebar.userProfile.confirmPasswordLabel")}
        </label>
        <Input
          type="password"
          placeholder={t(
            "newUi.sidebar.userProfile.confirmPasswordPlaceholder",
          )}
          value={confirmPw}
          onChange={(e) => setConfirmPw(e.target.value)}
          className="text-sm"
        />
      </div>
      <Button
        variant="outline"
        size="sm"
        className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand self-end"
        onClick={handleUpdate}
      >
        <KeyRound className="size-3.5" />
        {t("newUi.sidebar.userProfile.updatePassword")}
      </Button>
    </div>
  );
}

export function UserProfilePanel({
  username,
  onLogout,
  userPrefs,
  onPrefsChange,
  section,
  onOpenSettingsPage,
}: {
  /** Shows just this section, flat, as a Settings page. */
  section?: string;
  /** Moves the Settings tab to another page. */
  onOpenSettingsPage?: (id: string) => void;
  username?: string;
  onLogout?: () => void;
  userPrefs?: {
    reopenTabsOnLogin: boolean;
    storageMode?: string | null;
    commandPaletteEnabled?: boolean | null;
    showHostTags?: boolean | null;
    hostTrayOnClick?: boolean | null;
    compactHostView?: boolean | null;
    pinAppRail?: boolean | null;
    expandAppRailOnHover?: boolean | null;
    showPinAppRailButton?: boolean | null;
    disableUpdateCheck?: boolean | null;
    confirmTabClose?: boolean | null;
    hiddenRailTabs?: string | null;
    statusColorScheme?: string | null;
  };
  onPrefsChange?: (prefs: {
    reopenTabsOnLogin?: boolean;
    storageMode?: "local" | "cloud";
  }) => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const themeLabel: Record<ThemeId, string> = {
    system: t("newUi.sidebar.userProfile.themeSystem"),
    light: t("newUi.sidebar.userProfile.themeLight"),
    dark: t("newUi.sidebar.userProfile.themeDark"),
    dracula: t("newUi.sidebar.userProfile.themeDracula"),
    catppuccin: t("newUi.sidebar.userProfile.themeCatppuccin"),
    nord: t("newUi.sidebar.userProfile.themeNord"),
    solarized: t("newUi.sidebar.userProfile.themeSolarized"),
    "tokyo-night": t("newUi.sidebar.userProfile.themeTokyoNight"),
    "one-dark": t("newUi.sidebar.userProfile.themeOneDark"),
    gruvbox: t("newUi.sidebar.userProfile.themeGruvbox"),
  };
  const [openSections, setOpenSections] = useState<Set<UserProfileSection>>(
    () => new Set(["account"]),
  );
  const featureSettings = useFeatureSettings("user");

  // User info
  const [userId, setUserId] = useState("");
  const [accountUsername, setAccountUsername] = useState(username ?? "");
  const [accountTotpEnabled, setAccountTotpEnabled] = useState(false);
  const [userRole, setUserRole] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [authMethod, setAuthMethod] = useState("");
  const [version, setVersion] = useState("");
  const [versionStatus, setVersionStatus] = useState<
    "up_to_date" | "requires_update" | "beta" | "unknown"
  >("up_to_date");
  const [releaseUrl, setReleaseUrl] = useState("");
  const [isExternal, setIsExternal] = useState(false);
  const [isDualAuth, setIsDualAuth] = useState(false);

  // Delete account
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Data export/import
  const [importFile, setImportFile] = useState<File | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);

  // UI state
  const [showPassword, setShowPassword] = useState(false);
  const [newKeyOpen, setNewKeyOpen] = useState(false);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const { theme, setTheme } = useTheme();
  const localSnapshot = useRef<Record<string, string | null>>({});

  // Appearance state, initialized from localStorage
  const [accentColor, setAccentColor] = useState(
    () => localStorage.getItem("termix-accent") ?? "#f59145",
  );
  const [customColorInput, setCustomColorInput] = useState(
    () => localStorage.getItem("termix-accent") ?? "#f59145",
  );
  const [fontSize, setFontSize] = useState<FontSizeId>(
    () => (localStorage.getItem("termix-font-size") as FontSizeId) ?? "md",
  );
  const [uiFont, setUiFont] = useState<UiFontId>(
    () =>
      (localStorage.getItem("termix-ui-font") as UiFontId) ?? "jetbrains-mono",
  );
  const [language, setLanguage] = useState(() =>
    normalizeLanguageCode(localStorage.getItem("i18nextLng")),
  );
  const [storageMode, setStorageMode] = useState<"local" | "cloud">(() =>
    userPrefs?.storageMode === "cloud" ? "cloud" : "local",
  );

  useEffect(() => {
    if (userPrefs?.storageMode) {
      setStorageMode(userPrefs.storageMode === "cloud" ? "cloud" : "local");
    }
  }, [userPrefs?.storageMode]);

  // On the desktop app, the account it is linked to on a server, if any.
  // "Cloud" storage only has somewhere to go once it is linked.
  const [linkedAccount, setLinkedAccount] = useState<
    LinkedAccountInfo | null | undefined
  >(() => (isElectron() ? undefined : null));
  const isLinked = !!linkedAccount;

  useEffect(() => {
    if (isElectron() && linkedAccount === null && storageMode === "cloud") {
      setStorageMode("local");
      onPrefsChange?.({ storageMode: "local" });
    }
  }, [linkedAccount, storageMode, onPrefsChange]);

  // Settings toggles, all backed by localStorage
  const [commandPaletteEnabled, setCommandPaletteEnabled] = useState(() => {
    const v = localStorage.getItem("commandPaletteShortcutEnabled");
    return v !== null ? v === "true" : true;
  });
  // Sidebar display customization (density, tags, tray trigger, status
  // colors) now lives in the dedicated Customize Sidebar panel opened from
  // the Hosts toolbar, not here -- resetToDefaults still needs write access.
  const { update: updateSidebarPrefs } = useHostSidebarPreferences();
  const uiPrefs = useUiPreferencesContext();

  const [pinAppRail, setPinAppRail] = useState(() =>
    readRailPreference("pinAppRail"),
  );
  const [expandAppRailOnHover, setExpandAppRailOnHover] = useState(() =>
    readRailPreference("expandAppRailOnHover"),
  );
  const [showPinAppRailButton, setShowPinAppRailButton] = useState(() =>
    readRailPreference("showPinAppRailButton"),
  );
  const [disableUpdateCheck, setDisableUpdateCheck] = useState(
    () => localStorage.getItem("disableUpdateCheck") === "true",
  );
  const [confirmTabClose, setConfirmTabClose] = useState(
    () => localStorage.getItem("confirmTabClose") === "true",
  );
  const [showTabNumbers, setShowTabNumbers] = useState(
    () => localStorage.getItem("showTabNumbers") === "true",
  );
  const [hiddenRailTabs, setHiddenRailTabs] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("hiddenRailTabs");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  // API keys
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);

  // RBAC roles
  const [userRoles, setUserRoles] = useState<UserRole[]>([]);

  useEffect(() => {
    getUserInfo()
      .then((info) => {
        setUserId(info.userId);
        setIsExternal(info.is_external ?? false);
        setIsDualAuth(info.is_dual_auth ?? false);
        const linked = info.linked ?? null;
        setLinkedAccount(linked);
        // A linked desktop is the account it is signed in to on the server.
        setAccountUsername(linked?.username || info.username);
        setAccountTotpEnabled(info.totp_enabled ?? false);
        setIsAdmin(Boolean(linked ? linked.isAdmin : info.is_admin));
        setUserRole(
          (linked ? linked.isAdmin : info.is_admin)
            ? t("newUi.sidebar.userProfile.roleAdministrator")
            : t("newUi.sidebar.userProfile.roleUser"),
        );
        if (info.is_dual_auth) {
          setAuthMethod(t("newUi.sidebar.userProfile.authMethodDual"));
        } else if (info.is_external) {
          setAuthMethod(t("newUi.sidebar.userProfile.authMethodExternal"));
        } else {
          setAuthMethod(t("newUi.sidebar.userProfile.authMethodLocal"));
        }
        if (linked) {
          setUserRoles(
            linked.roles.map((name, index) => ({
              id: index,
              roleId: index,
              roleName: name,
              roleDisplayName: name,
            })) as unknown as UserRole[],
          );
        } else {
          getUserRoles(info.userId)
            .then(({ roles }) => setUserRoles(roles ?? []))
            .catch(() => {});
        }
      })
      .catch(() => {});
    getApiKeys()
      .then(({ apiKeys: keys }) => setApiKeys(keys))
      .catch(() => {});
    getVersionInfo()
      .then((info) => {
        setVersion(info.localVersion);
        setVersionStatus(info.status ?? "unknown");
        setReleaseUrl(releaseUrlFrom(info));
      })
      .catch(() => {
        // Backend/network unreachable (offline machine). The installer
        // version is still known locally via Electron, so use that instead
        // of leaving the version blank.
        if (isElectron()) {
          window.electronAPI
            ?.getAppVersion?.()
            .then((appVersion) => {
              if (appVersion) {
                setVersion(appVersion);
                setVersionStatus("unknown");
              }
            })
            .catch(() => {});
        }
      });
  }, [t]);

  // The rail can toggle these from its right-click menu while this panel is
  // mounted, so mirror the change back into the switches instead of letting
  // them drift from the stored value.
  useEffect(() => {
    const pinHandler = () => setPinAppRail(readRailPreference("pinAppRail"));
    const hoverHandler = () =>
      setExpandAppRailOnHover(readRailPreference("expandAppRailOnHover"));
    const showPinButtonHandler = () =>
      setShowPinAppRailButton(readRailPreference("showPinAppRailButton"));
    window.addEventListener("pinAppRailChanged", pinHandler);
    window.addEventListener("expandAppRailOnHoverChanged", hoverHandler);
    window.addEventListener(
      "showPinAppRailButtonChanged",
      showPinButtonHandler,
    );
    return () => {
      window.removeEventListener("pinAppRailChanged", pinHandler);
      window.removeEventListener("expandAppRailOnHoverChanged", hoverHandler);
      window.removeEventListener(
        "showPinAppRailButtonChanged",
        showPinButtonHandler,
      );
    };
  }, []);

  function saveToCloud(prefs: Parameters<typeof saveUserPreferences>[0]) {
    void saveUserPreferences(prefs).catch(() => {});
  }

  async function handleStorageModeChange(mode: "local" | "cloud") {
    setStorageMode(mode);
    onPrefsChange?.({ storageMode: mode });
    if (mode === "cloud") {
      // Snapshot current browser localStorage values so any tab can restore them later
      const SNAPSHOT_KEYS = [
        "termix-accent",
        "termix-font-size",
        "termix-ui-font",
        "i18nextLng",
        "commandPaletteShortcutEnabled",
        "showHostTags",
        "hostTrayOnClick",
        "compactHostView",
        "pinAppRail",
        "expandAppRailOnHover",
        "showPinAppRailButton",
        "disableUpdateCheck",
        "confirmTabClose",
        "hiddenRailTabs",
        "statusColorScheme",
        "uiPreferences",
        // Layout/view keys that were never snapshotted, so switching to cloud
        // and back silently reset them.
        "dashboardTab.slots",
        "dashboardTab.mainWidthPct",
      ];
      const snap: Record<string, string | null> = { __theme: theme };
      for (const key of SNAPSHOT_KEYS) snap[key] = localStorage.getItem(key);
      localSnapshot.current = snap;
      localStorage.setItem("termix-local-snapshot", JSON.stringify(snap));

      try {
        const prefs = await getUserPreferences();
        if (prefs.theme) setTheme(prefs.theme as ThemeId);
        if (prefs.fontSize) {
          setFontSize(prefs.fontSize as FontSizeId);
          applyFontSize(prefs.fontSize as FontSizeId);
        }
        if (prefs.accentColor) {
          setAccentColor(prefs.accentColor);
          setCustomColorInput(prefs.accentColor);
          localStorage.setItem("termix-accent", prefs.accentColor);
          applyAccentColor(prefs.accentColor);
        }
        if (prefs.language) {
          const language = await changeAppLanguage(prefs.language);
          setLanguage(language);
        }
        if (prefs.commandPaletteEnabled != null) {
          setCommandPaletteEnabled(prefs.commandPaletteEnabled);
          localStorage.setItem(
            "commandPaletteShortcutEnabled",
            String(prefs.commandPaletteEnabled),
          );
        }
        // showHostTags/hostTrayOnClick/compactHostView/statusColorScheme are
        // no longer restored here -- useHostSidebarPreferences independently
        // fetches its own authoritative copy from /host-sidebar/preferences.
        if (prefs.pinAppRail != null) {
          setPinAppRail(prefs.pinAppRail);
          localStorage.setItem("pinAppRail", String(prefs.pinAppRail));
          window.dispatchEvent(new Event("pinAppRailChanged"));
        }
        if (prefs.expandAppRailOnHover != null) {
          setExpandAppRailOnHover(prefs.expandAppRailOnHover);
          localStorage.setItem(
            "expandAppRailOnHover",
            String(prefs.expandAppRailOnHover),
          );
          window.dispatchEvent(new Event("expandAppRailOnHoverChanged"));
        }
        if (prefs.showPinAppRailButton != null) {
          setShowPinAppRailButton(prefs.showPinAppRailButton);
          localStorage.setItem(
            "showPinAppRailButton",
            String(prefs.showPinAppRailButton),
          );
          window.dispatchEvent(new Event("showPinAppRailButtonChanged"));
        }
        if (prefs.disableUpdateCheck != null) {
          setDisableUpdateCheck(prefs.disableUpdateCheck);
          localStorage.setItem(
            "disableUpdateCheck",
            String(prefs.disableUpdateCheck),
          );
        }
        if (prefs.confirmTabClose != null) {
          setConfirmTabClose(prefs.confirmTabClose);
          localStorage.setItem(
            "confirmTabClose",
            String(prefs.confirmTabClose),
          );
        }
        if (prefs.hiddenRailTabs != null) {
          const s = new Set<string>(JSON.parse(prefs.hiddenRailTabs));
          setHiddenRailTabs(s);
          localStorage.setItem("hiddenRailTabs", prefs.hiddenRailTabs);
          window.dispatchEvent(new CustomEvent("hiddenRailTabsChanged"));
        }
      } catch {
        // leave UI as-is on error
      }
      saveToCloud({ storageMode: "cloud" });
    } else {
      restoreLocalSnapshot();
      saveToCloud({ storageMode: "local" });
    }
  }

  function resetToDefaults() {
    clearLocalAdaptivePreferences();
    const DEFAULT_ACCENT = "#f59145";
    setTheme("system");
    setFontSize("md");
    applyFontSize("md");
    setUiFont("jetbrains-mono");
    applyUiFont("jetbrains-mono");
    setAccentColor(DEFAULT_ACCENT);
    setCustomColorInput(DEFAULT_ACCENT);
    localStorage.setItem("termix-accent", DEFAULT_ACCENT);
    applyAccentColor(DEFAULT_ACCENT);
    setLanguage("en");
    void changeAppLanguage("en");
    setCommandPaletteEnabled(true);
    localStorage.setItem("commandPaletteShortcutEnabled", "true");
    updateSidebarPrefs((prev) => ({
      ...prev,
      display: {
        ...prev.display,
        showTags: true,
        trayTrigger: "hover",
        density: "comfortable",
        statusColorScheme: "accent",
      },
    }));
    setPinAppRail(false);
    localStorage.setItem("pinAppRail", "false");
    window.dispatchEvent(new Event("pinAppRailChanged"));
    setExpandAppRailOnHover(true);
    localStorage.setItem("expandAppRailOnHover", "true");
    window.dispatchEvent(new Event("expandAppRailOnHoverChanged"));
    setShowPinAppRailButton(false);
    localStorage.setItem("showPinAppRailButton", "false");
    window.dispatchEvent(new Event("showPinAppRailButtonChanged"));
    setDisableUpdateCheck(false);
    localStorage.setItem("disableUpdateCheck", "false");
    setConfirmTabClose(false);
    localStorage.setItem("confirmTabClose", "false");
    setHiddenRailTabs(new Set());
    localStorage.removeItem("hiddenRailTabs");
    window.dispatchEvent(new CustomEvent("hiddenRailTabsChanged"));
    // Back to the preset that matches the pre-preset UI, with nothing pinned.
    uiPrefs?.setPreset("balanced");
    uiPrefs?.clearAllOverrides();
    if (storageMode === "cloud") {
      saveToCloud({
        theme: "system",
        fontSize: "md",
        accentColor: DEFAULT_ACCENT,
        language: "en",
        commandPaletteEnabled: true,
        pinAppRail: false,
        expandAppRailOnHover: true,
        showPinAppRailButton: false,
        disableUpdateCheck: false,
        confirmTabClose: false,
        hiddenRailTabs: "[]",
      });
    }
    localSnapshot.current = {};
    localStorage.removeItem("termix-local-snapshot");
    toast.success(t("newUi.sidebar.userProfile.resetToDefaultsSuccess"));
  }

  function restoreLocalSnapshot() {
    // Prefer the persisted snapshot (survives new tabs/reloads), fall back to in-memory ref.
    // If neither exists there were never any browser values to restore, so use current localStorage.
    const persisted = localStorage.getItem("termix-local-snapshot");
    const snap: Record<string, string | null> = persisted
      ? (JSON.parse(persisted) as Record<string, string | null>)
      : localSnapshot.current;
    const hasSnap = Object.keys(snap).length > 0;
    const restore = (key: string, fallback: string | null = null) =>
      hasSnap
        ? snap[key] !== undefined
          ? snap[key]
          : fallback
        : (localStorage.getItem(key) ?? fallback);

    const restoredTheme =
      ((hasSnap ? snap["__theme"] : theme) as ThemeId) ?? "system";
    setTheme(restoredTheme);

    const restoredFontSize =
      (restore("termix-font-size", "md") as FontSizeId) ?? "md";
    setFontSize(restoredFontSize);
    applyFontSize(restoredFontSize);

    const restoredUiFont =
      (restore("termix-ui-font", "jetbrains-mono") as UiFontId) ??
      "jetbrains-mono";
    setUiFont(restoredUiFont);
    applyUiFont(restoredUiFont);

    const restoredAccent = restore("termix-accent", "#f59145") ?? "#f59145";
    setAccentColor(restoredAccent);
    setCustomColorInput(restoredAccent);
    localStorage.setItem("termix-accent", restoredAccent);
    applyAccentColor(restoredAccent);

    const restoredLang = normalizeLanguageCode(restore("i18nextLng", "en"));
    setLanguage(restoredLang);
    void changeAppLanguage(restoredLang);

    const restoredPalette =
      restore("commandPaletteShortcutEnabled", "true") !== "false";
    setCommandPaletteEnabled(restoredPalette);
    localStorage.setItem(
      "commandPaletteShortcutEnabled",
      String(restoredPalette),
    );

    // showHostTags/hostTrayOnClick/compactHostView/statusColorScheme are no
    // longer part of this snapshot -- useHostSidebarPreferences keeps its own
    // localStorage cache independent of storageMode switches.

    const restoredPinRail = restore("pinAppRail", "false") === "true";
    setPinAppRail(restoredPinRail);
    localStorage.setItem("pinAppRail", String(restoredPinRail));
    window.dispatchEvent(new Event("pinAppRailChanged"));

    const restoredExpandRailOnHover =
      restore("expandAppRailOnHover", "true") !== "false";
    setExpandAppRailOnHover(restoredExpandRailOnHover);
    localStorage.setItem(
      "expandAppRailOnHover",
      String(restoredExpandRailOnHover),
    );
    window.dispatchEvent(new Event("expandAppRailOnHoverChanged"));

    const restoredShowPinButton =
      restore("showPinAppRailButton", "false") === "true";
    setShowPinAppRailButton(restoredShowPinButton);
    localStorage.setItem("showPinAppRailButton", String(restoredShowPinButton));
    window.dispatchEvent(new Event("showPinAppRailButtonChanged"));

    const restoredUpdateCheck =
      restore("disableUpdateCheck", "false") === "true";
    setDisableUpdateCheck(restoredUpdateCheck);
    localStorage.setItem("disableUpdateCheck", String(restoredUpdateCheck));

    const restoredConfirmTab = restore("confirmTabClose", "false") === "true";
    setConfirmTabClose(restoredConfirmTab);
    localStorage.setItem("confirmTabClose", String(restoredConfirmTab));

    const restoredHiddenRaw = hasSnap
      ? snap["hiddenRailTabs"]
      : localStorage.getItem("hiddenRailTabs");
    if (restoredHiddenRaw == null) {
      setHiddenRailTabs(new Set());
      localStorage.removeItem("hiddenRailTabs");
    } else {
      try {
        setHiddenRailTabs(new Set(JSON.parse(restoredHiddenRaw)));
      } catch {
        setHiddenRailTabs(new Set());
      }
      localStorage.setItem("hiddenRailTabs", restoredHiddenRaw);
    }
    window.dispatchEvent(new CustomEvent("hiddenRailTabsChanged"));

    localStorage.removeItem("termix-local-snapshot");
    localSnapshot.current = {};
  }

  function handleThemeChange(id: ThemeId) {
    setTheme(id);
    if (storageMode === "cloud") saveToCloud({ theme: id });
  }

  function handleAccentChange(value: string) {
    setAccentColor(value);
    setCustomColorInput(value);
    localStorage.setItem("termix-accent", value);
    applyAccentColor(value);
    if (storageMode === "cloud") saveToCloud({ accentColor: value });
  }

  function handleFontSizeChange(id: FontSizeId) {
    setFontSize(id);
    applyFontSize(id);
    if (storageMode === "cloud") saveToCloud({ fontSize: id });
  }

  function handleUiFontChange(id: UiFontId) {
    setUiFont(id);
    applyUiFont(id);
  }

  function handleLanguageChange(code: string) {
    void changeAppLanguage(code)
      .then((language) => {
        setLanguage(language);
        if (storageMode === "cloud") saveToCloud({ language });
      })
      .catch(() => {});
  }

  function toggle(id: UserProfileSection) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDeleteAccount() {
    if (!deletePassword.trim()) {
      toast.error(t("newUi.sidebar.userProfile.deletePasswordRequired"));
      return;
    }
    setDeleteLoading(true);
    try {
      await deleteAccount(deletePassword);
      await logoutUser().catch(() => {});
      window.location.reload();
    } catch (e: unknown) {
      toast.error(
        apiErrorMessage(e, t("newUi.sidebar.userProfile.deleteFailed")),
      );
      setDeleteLoading(false);
    }
  }

  async function handleExportData() {
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
        toast.success(t("newUi.sidebar.userProfile.exportSuccess"));
      } else {
        const err = await response.json().catch(() => ({}));
        toast.error(err.error || t("newUi.sidebar.userProfile.exportFailed"));
      }
    } catch {
      toast.error(t("newUi.sidebar.userProfile.exportFailed"));
    } finally {
      setExportLoading(false);
    }
  }

  async function handleImportData() {
    if (!importFile) {
      toast.error(t("newUi.sidebar.userProfile.importSelectFile"));
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
            (s.settingsImported || 0);
          toast.success(
            t("newUi.sidebar.userProfile.importCompleted", {
              total,
              skipped: s.skippedItems || 0,
            }),
          );
          setImportFile(null);
          setTimeout(() => window.location.reload(), 1500);
        } else {
          toast.error(
            t("newUi.sidebar.userProfile.importFailed", {
              error: result.summary?.errors?.join(", ") || "Unknown error",
            }),
          );
        }
      } else {
        const err = await response.json().catch(() => ({}));
        toast.error(
          t("newUi.sidebar.userProfile.importFailed", {
            error: err.error || "Unknown error",
          }),
        );
      }
    } catch {
      toast.error(
        t("newUi.sidebar.userProfile.importFailed", {
          error: "Unknown error",
        }),
      );
    } finally {
      setImportLoading(false);
    }
  }

  const canChangePasword = !isExternal || isDualAuth;
  const isOpen = (id: string) =>
    section ? section === id : openSections.has(id as UserProfileSection);
  const shows = (id: string) => !section || section === id;

  return (
    <div
      className={
        section
          ? "flex w-full flex-col gap-2"
          : "mx-auto flex w-full max-w-5xl flex-col gap-2 p-3"
      }
    >
      <NewApiKeyDialog
        open={newKeyOpen}
        onOpenChange={setNewKeyOpen}
        onAdd={(key) => setApiKeys((prev) => [key as ApiKey, ...prev])}
        userId={userId}
      />

      {/* Storage mode toggle, only meaningful once a remote server is
          connected; with no sync there's nowhere for "cloud" to sync to,
          so this stays forced to local storage and hidden. */}
      {(!isElectron() || isLinked) && shows("data") && (
        <div className="border border-border bg-card px-3 py-2.5 flex flex-col gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("newUi.sidebar.userProfile.storageModeSwitch")}
          </span>
          <div className="flex border border-border overflow-hidden w-full">
            <button
              onClick={() => handleStorageModeChange("local")}
              className={`flex-1 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                storageMode === "local"
                  ? "bg-accent-brand/10 text-accent-brand"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
              }`}
            >
              {t("newUi.sidebar.userProfile.storageModeLocal")}
            </button>
            <button
              onClick={() => handleStorageModeChange("cloud")}
              className={`flex-1 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                storageMode === "cloud"
                  ? "bg-accent-brand/10 text-accent-brand"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
              }`}
            >
              {t("newUi.sidebar.userProfile.storageModeCloud")}
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            {t("newUi.sidebar.userProfile.storageModeDescription")}
          </p>
          <button
            onClick={resetToDefaults}
            className="self-start flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
          >
            <RotateCcw className="size-3" />
            {t("newUi.sidebar.userProfile.resetToDefaults")}
          </button>
        </div>
      )}

      {/* Account */}
      <AccordionSection
        id="account"
        label={t("newUi.sidebar.userProfile.sectionAccount")}
        icon={<User className="size-3.5" />}
        open={isOpen("account")}
        onToggle={() => toggle("account")}
      >
        <div className="flex flex-col gap-0 pt-2">
          {isElectron() && (
            <div className="border border-accent-brand/40 bg-accent-brand/10 px-3 py-2.5 mb-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-accent-brand">
                <ShieldCheck className="size-3.5" />
                {isLinked
                  ? t("newUi.sidebar.userProfile.linkedProfileTitle", {
                      server:
                        linkedAccount?.serverName || linkedAccount?.serverUrl,
                    })
                  : t("newUi.sidebar.userProfile.desktopProfileTitle")}
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed mt-1">
                {isLinked
                  ? t("newUi.sidebar.userProfile.linkedProfileDescription")
                  : t("newUi.sidebar.userProfile.desktopProfileDescription")}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 h-7 text-[10px] rounded-none"
                onClick={() => shell.openRailView("sync")}
              >
                {isLinked
                  ? t("newUi.sidebar.userProfile.manageSync")
                  : t("newUi.sidebar.userProfile.setUpSync")}
              </Button>
            </div>
          )}
          {(!isElectron() || isLinked) && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-0">
              <div className="flex flex-col py-2">
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
                  {t("newUi.sidebar.userProfile.usernameLabel")}
                </span>
                <span className="text-sm font-semibold mt-0.5">
                  {accountUsername || "-"}
                </span>
              </div>
              <div className="flex flex-col py-2">
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
                  {t("newUi.sidebar.userProfile.roleLabel")}
                </span>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold border border-accent-brand/40 bg-accent-brand/10 text-accent-brand w-fit">
                    {userRole || "-"}
                  </span>
                  {userRoles.map((r) => (
                    <span
                      key={r.roleId}
                      className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold border border-border bg-muted text-muted-foreground w-fit"
                    >
                      {r.roleDisplayName}
                    </span>
                  ))}
                </div>
              </div>
              {!isElectron() && (
                <>
                  <div className="flex flex-col py-2">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
                      {t("newUi.sidebar.userProfile.authMethodLabel")}
                    </span>
                    <span className="text-sm font-semibold mt-0.5">
                      {authMethod || "-"}
                    </span>
                  </div>
                  <div className="flex flex-col py-2">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
                      {t("newUi.sidebar.userProfile.twoFaLabel")}
                    </span>
                    <span className="flex items-center gap-1 mt-0.5">
                      {accountTotpEnabled ? (
                        <>
                          <ShieldCheck className="size-3.5 text-accent-brand" />
                          <span className="text-sm font-semibold text-accent-brand">
                            {t("newUi.sidebar.userProfile.twoFaOn")}
                          </span>
                        </>
                      ) : (
                        <span className="text-sm font-semibold text-muted-foreground">
                          {t("newUi.sidebar.userProfile.twoFaOff")}
                        </span>
                      )}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="border-t border-border pt-3 mt-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
                {t("newUi.sidebar.userProfile.versionLabel")}
              </span>
              <VersionBadge
                status={versionStatus}
                releaseUrl={releaseUrl}
                className="shrink-0 px-1 py-px text-[9px]"
              />
            </div>
            <span
              className="mt-1.5 block truncate text-sm font-bold text-accent-brand"
              title={version ? `v${version}` : undefined}
            >
              {version ? `v${version}` : "-"}
            </span>
          </div>

          {(isPrerelease(version) || isAdmin) && (
            <div className="border-t border-border pt-3 mt-3">
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium">
                    {isPrerelease(version)
                      ? t("newUi.sidebar.userProfile.onBetaTitle")
                      : t("newUi.sidebar.userProfile.tryBetaTitle")}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {isPrerelease(version)
                      ? t("newUi.sidebar.userProfile.onBetaDescription")
                      : t("newUi.sidebar.userProfile.tryBetaDescription")}
                  </span>
                </div>
                {isPrerelease(version) ? (
                  <a
                    href={reportBetaFeedbackUrl(version)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 ml-3 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest border border-border px-2 py-1.5 hover:bg-muted/40 transition-colors"
                  >
                    {t("newUi.sidebar.userProfile.sendBetaFeedback")}
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpenSettingsPage?.("updates")}
                    className="shrink-0 ml-3 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest border border-border px-2 py-1.5 hover:bg-muted/40 transition-colors"
                  >
                    {t("newUi.sidebar.userProfile.openUpdates")}
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="border-t border-border pt-3 mt-3">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium">
                  {t("newUi.sidebar.userProfile.cliTitle")}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {t("newUi.sidebar.userProfile.cliDescription")}
                </span>
              </div>
              <a
                href={docsUrl("cli")}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 ml-3 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest border border-border px-2 py-1.5 hover:bg-muted/40 transition-colors"
              >
                {t("newUi.sidebar.userProfile.cliLearnMore")}
              </a>
            </div>
          </div>

          {!isElectron() && (
            <div className="border-t border-border pt-3 mt-3">
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium text-destructive">
                    {t("newUi.sidebar.userProfile.deleteAccount")}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {t("newUi.sidebar.userProfile.deleteAccountDescription")}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive shrink-0 ml-3 text-[10px] h-7"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  {t("newUi.sidebar.userProfile.deleteButton")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </AccordionSection>

      {/* Interface */}
      <AccordionSection
        id="interface"
        label={t("newUi.sidebar.userProfile.sectionInterface")}
        icon={<LayoutTemplate size={13} />}
        open={isOpen("interface")}
        onToggle={() => toggle("interface")}
      >
        <div className="flex flex-col gap-4 pt-3">
          <InterfacePresetSettings
            onRunSetupAgain={() =>
              window.dispatchEvent(new Event("termix:open-onboarding"))
            }
          />
        </div>
      </AccordionSection>

      {/* Appearance */}
      <AccordionSection
        id="appearance"
        label={t("newUi.sidebar.userProfile.sectionAppearance")}
        icon={<Palette className="size-3.5" />}
        open={isOpen("appearance")}
        onToggle={() => toggle("appearance")}
      >
        <div className="flex flex-col gap-4 pt-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("newUi.sidebar.userProfile.languageLabel")}
            </span>
            <Select2
              value={language}
              onChange={(e) => handleLanguageChange(e.target.value)}
              className="px-2.5 py-1.5 text-xs bg-background border border-border text-foreground outline-none focus:ring-1 focus:ring-ring w-full"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </Select2>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("newUi.sidebar.userProfile.themeLabel")}
            </span>
            <div className="relative">
              <Select2
                value={theme}
                onChange={(e) => handleThemeChange(e.target.value as ThemeId)}
                className="w-full px-2.5 py-1.5 text-xs bg-background border border-border text-foreground outline-none focus:ring-1 focus:ring-ring appearance-none pr-7"
              >
                {THEMES.map((th) => (
                  <option key={th.id} value={th.id}>
                    {themeLabel[th.id]}
                  </option>
                ))}
              </Select2>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground pointer-events-none" />
            </div>
            <div className="flex gap-1 mt-0.5">
              {THEMES.filter((th) => th.id !== "system").map((th) => (
                <button
                  key={th.id}
                  title={themeLabel[th.id]}
                  onClick={() => handleThemeChange(th.id)}
                  className={`h-4 flex-1 border transition-all ${theme === th.id ? "border-accent-brand ring-1 ring-accent-brand" : "border-border/50"}`}
                  style={{ background: th.preview }}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <Type className="size-3" />
              {t("newUi.sidebar.userProfile.interfaceFontLabel")}
            </span>
            <Select2
              value={uiFont}
              onChange={(event) =>
                handleUiFontChange(event.target.value as UiFontId)
              }
              className="px-2.5 py-1.5 text-xs bg-background border border-border text-foreground outline-none focus:ring-1 focus:ring-ring w-full"
            >
              {UI_FONTS.map((font) => (
                <option key={font.id} value={font.id}>
                  {font.label}
                </option>
              ))}
            </Select2>
            <span className="text-[10px] text-muted-foreground">
              {t("newUi.sidebar.userProfile.interfaceFontDescription")}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <Type className="size-3" />
              {t("newUi.sidebar.userProfile.fontSizeLabel")}
            </span>
            <div className="flex gap-1">
              {FONT_SIZES.map((fs) => (
                <button
                  key={fs.id}
                  onClick={() => handleFontSizeChange(fs.id)}
                  className={`flex-1 py-1.5 border text-[10px] font-bold transition-colors ${
                    fontSize === fs.id
                      ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {fs.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("newUi.sidebar.userProfile.accentColorLabel")}
            </span>
            <div className="grid grid-cols-6 gap-1">
              {ACCENT_PRESET_COLORS.map((ac) => (
                <button
                  key={ac.value}
                  title={ac.label}
                  onClick={() => handleAccentChange(ac.value)}
                  className={`h-6 border-2 transition-all ${
                    accentColor === ac.value
                      ? "border-foreground scale-110"
                      : "border-transparent hover:border-foreground/40"
                  }`}
                  style={{ background: ac.value }}
                />
              ))}
            </div>
            <div className="flex items-center gap-2 border border-border bg-muted/30 px-2 py-1.5">
              <button
                onClick={() => colorInputRef.current?.click()}
                className="size-5 shrink-0 border border-border/60 cursor-pointer"
                style={{ background: accentColor }}
                title={t("newUi.sidebar.userProfile.colorPickerTooltip")}
              />
              <input
                ref={colorInputRef}
                type="color"
                value={accentColor.startsWith("#") ? accentColor : "#f97316"}
                onChange={(e) => handleAccentChange(e.target.value)}
                className="sr-only"
              />
              <Input
                value={customColorInput}
                onChange={(e) => setCustomColorInput(e.target.value)}
                onBlur={() => {
                  const v = customColorInput.trim();
                  if (
                    /^#[0-9a-fA-F]{6}$/.test(v) ||
                    /^#[0-9a-fA-F]{3}$/.test(v)
                  ) {
                    handleAccentChange(v);
                  } else {
                    setCustomColorInput(accentColor);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const v = customColorInput.trim();
                    if (
                      /^#[0-9a-fA-F]{6}$/.test(v) ||
                      /^#[0-9a-fA-F]{3}$/.test(v)
                    ) {
                      handleAccentChange(v);
                    }
                  }
                }}
                placeholder="#f97316"
                className="h-6 text-[11px] font-mono border-0 bg-transparent p-0 focus-visible:ring-0 flex-1 min-w-0"
              />
              <span className="text-[10px] text-muted-foreground shrink-0">
                hex
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-1 border-t border-border pt-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
              {t("newUi.sidebar.userProfile.settingsTabsAndShortcuts")}
            </span>
            <SettingRow
              label={t("newUi.sidebar.userProfile.keyboardShortcuts")}
              description={t(
                "newUi.sidebar.userProfile.keyboardShortcutsDescription",
              )}
            >
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenSettingsPage?.("keybindings")}
              >
                {t("newUi.sidebar.userProfile.manageShortcuts")}
              </Button>
            </SettingRow>
            <SettingRow
              label={t("newUi.sidebar.userProfile.commandPalette")}
              description={t("newUi.sidebar.userProfile.commandPaletteDesc")}
            >
              <FakeSwitch
                checked={commandPaletteEnabled}
                onChange={(v) => {
                  setCommandPaletteEnabled(v);
                  localStorage.setItem(
                    "commandPaletteShortcutEnabled",
                    v.toString(),
                  );
                  window.dispatchEvent(
                    new Event("commandPaletteShortcutEnabledChanged"),
                  );
                  if (storageMode === "cloud")
                    saveToCloud({ commandPaletteEnabled: v });
                }}
              />
            </SettingRow>
            <SettingRow
              label={t("newUi.sidebar.userProfile.reopenTabsOnLogin")}
              description={t("newUi.sidebar.userProfile.reopenTabsOnLoginDesc")}
            >
              <FakeSwitch
                checked={userPrefs?.reopenTabsOnLogin ?? false}
                onChange={(v) => {
                  onPrefsChange?.({ reopenTabsOnLogin: v });
                  import("@/main-axios").then(({ saveUserPreferences }) => {
                    saveUserPreferences({ reopenTabsOnLogin: v }).catch(
                      () => {},
                    );
                  });
                }}
              />
            </SettingRow>
            <SettingRow
              label={t("newUi.sidebar.userProfile.confirmTabClose")}
              description={t("newUi.sidebar.userProfile.confirmTabCloseDesc")}
            >
              <FakeSwitch
                checked={confirmTabClose}
                onChange={(v) => {
                  setConfirmTabClose(v);
                  localStorage.setItem("confirmTabClose", v.toString());
                  if (storageMode === "cloud")
                    saveToCloud({ confirmTabClose: v });
                }}
              />
            </SettingRow>
            <SettingRow
              label={t("newUi.sidebar.userProfile.showTabNumbers")}
              description={t("newUi.sidebar.userProfile.showTabNumbersDesc")}
            >
              <FakeSwitch
                checked={showTabNumbers}
                onChange={(v) => {
                  setShowTabNumbers(v);
                  localStorage.setItem("showTabNumbers", v.toString());
                  window.dispatchEvent(new Event("showTabNumbersChanged"));
                }}
              />
            </SettingRow>
          </div>

          <div className="flex flex-col gap-1 border-t border-border pt-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
              {t("newUi.sidebar.userProfile.settingsAppRail")}
            </span>
            <p className="text-[10px] text-muted-foreground mb-2">
              {t("newUi.sidebar.userProfile.sidebarSettingsMoved")}
            </p>
            <SettingRow
              label={t("newUi.sidebar.userProfile.pinAppRail")}
              description={t("newUi.sidebar.userProfile.pinAppRailDesc")}
            >
              <FakeSwitch
                checked={pinAppRail}
                onChange={(v) => {
                  setPinAppRail(v);
                  setRailPreference("pinAppRail", v);
                }}
              />
            </SettingRow>
            <SettingRow
              label={t("newUi.sidebar.userProfile.expandAppRailOnHover")}
              description={t(
                "newUi.sidebar.userProfile.expandAppRailOnHoverDesc",
              )}
            >
              <FakeSwitch
                checked={expandAppRailOnHover}
                onChange={(v) => {
                  setExpandAppRailOnHover(v);
                  setRailPreference("expandAppRailOnHover", v);
                }}
              />
            </SettingRow>
            <SettingRow
              label={t("newUi.sidebar.userProfile.showPinAppRailButton")}
              description={t(
                "newUi.sidebar.userProfile.showPinAppRailButtonDesc",
              )}
            >
              <FakeSwitch
                checked={showPinAppRailButton}
                onChange={(v) => {
                  setShowPinAppRailButton(v);
                  setRailPreference("showPinAppRailButton", v);
                }}
              />
            </SettingRow>
          </div>

          <div
            id="settings-navigation"
            className="flex flex-col gap-1 border-t border-border pt-3"
          >
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
              {t("newUi.sidebar.userProfile.settingsNavigation")}
            </span>
            <p className="text-[10px] text-muted-foreground mb-2">
              {t("newUi.sidebar.userProfile.navigationTabsDesc")}
            </p>
            <NavigationVisibilityToggles
              hidden={hiddenRailTabs}
              onChange={(next) => {
                setHiddenRailTabs(next);
                const serialized = JSON.stringify([...next]);
                localStorage.setItem("hiddenRailTabs", serialized);
                window.dispatchEvent(new Event("hiddenRailTabsChanged"));
                if (storageMode === "cloud")
                  saveToCloud({ hiddenRailTabs: serialized });
              }}
            />
          </div>

          <div className="flex flex-col gap-1 border-t border-border pt-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
              {t("newUi.sidebar.userProfile.settingsUpdates")}
            </span>
            <SettingRow
              label={t("newUi.sidebar.userProfile.disableUpdateChecks")}
              description={t(
                "newUi.sidebar.userProfile.disableUpdateChecksDesc",
              )}
            >
              <FakeSwitch
                checked={disableUpdateCheck}
                onChange={(v) => {
                  setDisableUpdateCheck(v);
                  localStorage.setItem("disableUpdateCheck", v.toString());
                  if (storageMode === "cloud")
                    saveToCloud({ disableUpdateCheck: v });
                }}
              />
            </SettingRow>
          </div>
        </div>
      </AccordionSection>

      {/* The embedded desktop backend auto-authenticates its machine-local
          profile, so server login controls would imply protection they do
          not provide. A linked account's sign-in is managed on its server. */}
      <AccordionSection
        hidden={isElectron()}
        id="security"
        label={t("newUi.sidebar.userProfile.sectionSecurity")}
        icon={<Shield className="size-3.5" />}
        open={isOpen("security")}
        onToggle={() => toggle("security")}
      >
        <div className="flex flex-col gap-4 pt-3">
          <AuthEnrollmentSections />

          {canChangePasword && (
            <PasswordChangeSection
              showPassword={showPassword}
              setShowPassword={setShowPassword}
              onLogout={onLogout}
            />
          )}
        </div>
      </AccordionSection>

      {/* API Keys */}
      <AccordionSection
        id="api-keys"
        label={t("newUi.sidebar.userProfile.sectionApiKeys")}
        icon={<Network className="size-3.5" />}
        open={isOpen("api-keys")}
        onToggle={() => toggle("api-keys")}
      >
        <div className="flex flex-col gap-2 pt-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">
              {t("newUi.sidebar.userProfile.apiKeyCount", {
                count: apiKeys.length,
              })}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10px] font-bold uppercase tracking-widest border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 gap-1"
              onClick={() => setNewKeyOpen(true)}
            >
              <Plus className="size-3" />{" "}
              {t("newUi.sidebar.userProfile.newKey")}
            </Button>
          </div>

          <div className="flex flex-col divide-y divide-border">
            {apiKeys.length === 0 ? (
              <div className="py-6 text-center text-muted-foreground text-xs">
                {t("newUi.sidebar.userProfile.noApiKeys")}
              </div>
            ) : (
              apiKeys.map((key) => (
                <div
                  key={key.id}
                  className="flex items-start justify-between py-2.5 gap-2"
                >
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-semibold truncate">
                        {key.name}
                      </span>
                      {key.isActive && (
                        <span className="text-[9px] font-bold px-1 py-px border border-accent-brand/40 bg-accent-brand/10 text-accent-brand uppercase shrink-0">
                          {t("newUi.sidebar.userProfile.apiKeyActive")}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground truncate">
                      {key.tokenPrefix}…
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {t("newUi.sidebar.userProfile.apiKeyUser")}:{" "}
                      {key.username}
                    </span>
                    {key.expiresAt && (
                      <span className="text-[10px] text-muted-foreground">
                        {t("newUi.sidebar.userProfile.apiKeyExpires")}:{" "}
                        {new Date(key.expiresAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-muted-foreground hover:text-destructive"
                      onClick={async () => {
                        const ok = await confirm({
                          title: t("admin.revokeKeyConfirm", {
                            name: key.name,
                          }),
                          confirmLabel: t("admin.revokeKey"),
                        });
                        if (!ok) return;
                        try {
                          await deleteApiKey(key.id);
                          setApiKeys((prev) =>
                            prev.filter((k) => k.id !== key.id),
                          );
                          toast.success(
                            t("newUi.sidebar.userProfile.apiKeyRevoked", {
                              name: key.name,
                            }),
                          );
                        } catch {
                          toast.error(
                            t("newUi.sidebar.userProfile.apiKeyRevokeFailed"),
                          );
                        }
                      }}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="border-t border-border pt-2 text-[10px] text-muted-foreground flex flex-col gap-1">
            <p>
              {t("newUi.sidebar.userProfile.apiKeyUsageHint")}{" "}
              <code className="font-mono text-accent-brand bg-accent-brand/10 px-1">
                Authorization: Bearer
              </code>{" "}
              {t("newUi.sidebar.userProfile.apiKeyUsageHintHeader")}
            </p>
            <p>{t("newUi.sidebar.userProfile.apiKeyPermissionsHint")}</p>
          </div>
        </div>
      </AccordionSection>

      <AccordionSection
        id="data"
        label={t("newUi.sidebar.userProfile.sectionData")}
        icon={<Database className="size-3.5" />}
        open={isOpen("data")}
        onToggle={() => toggle("data")}
      >
        <div className="flex flex-col gap-3 pt-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">
              {t("newUi.sidebar.userProfile.exportData")}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {t("newUi.sidebar.userProfile.exportDataDesc")}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="self-start text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand mt-1"
              onClick={handleExportData}
              disabled={exportLoading}
            >
              {exportLoading
                ? t("newUi.sidebar.userProfile.exporting")
                : t("newUi.sidebar.userProfile.export")}
            </Button>
          </div>
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <span className="text-xs font-medium">
              {t("newUi.sidebar.userProfile.importData")}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {importFile
                ? t("newUi.sidebar.userProfile.importDataSelected", {
                    name: importFile.name,
                  })
                : t("newUi.sidebar.userProfile.importDataDesc")}
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
                  {importFile
                    ? t("newUi.sidebar.userProfile.changeFile")
                    : t("newUi.sidebar.userProfile.selectFile")}
                </Button>
              </div>
              {importFile && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                  onClick={handleImportData}
                  disabled={importLoading}
                >
                  {importLoading
                    ? t("newUi.sidebar.userProfile.importing")
                    : t("newUi.sidebar.userProfile.import")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </AccordionSection>

      {featureSettings.map((plugin) => (
        <FeatureSettingsSection
          key={plugin.id}
          plugin={plugin}
          scope="user"
          open={isOpen(featureSectionId(plugin.id))}
          onToggle={() => toggle(featureSectionId(plugin.id))}
        />
      ))}

      {/* Delete account dialog */}

      <InlineView
        open={showDeleteConfirm}
        onOpenChange={(open) => {
          setShowDeleteConfirm(open);
          if (!open) setDeletePassword("");
        }}
        title={t("newUi.sidebar.userProfile.deleteAccount")}
      >
        <p className="text-xs text-muted-foreground">
          {t("newUi.sidebar.userProfile.deleteAccountPermanent")}
        </p>
        <div className="flex flex-col gap-3 mt-1">
          <div className="flex items-start gap-2.5 border border-destructive/30 bg-destructive/5 px-3 py-2.5">
            <AlertCircle className="size-4 text-destructive shrink-0 mt-0.5" />
            <span className="text-xs text-destructive">
              {t("newUi.sidebar.userProfile.deleteAccountWarning")}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {t("newUi.sidebar.userProfile.confirmPasswordLabel")}
            </label>
            <Input
              type="password"
              placeholder={t(
                "newUi.sidebar.userProfile.confirmPasswordDeletePlaceholder",
              )}
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleDeleteAccount()}
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 mt-2">
          <Button
            variant="ghost"
            onClick={() => {
              setShowDeleteConfirm(false);
              setDeletePassword("");
            }}
          >
            {t("newUi.sidebar.userProfile.cancel")}
          </Button>
          <Button
            variant="outline"
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={handleDeleteAccount}
            disabled={deleteLoading || !deletePassword.trim()}
          >
            <Trash2 className="size-3.5" />
            {deleteLoading
              ? t("newUi.sidebar.userProfile.deleting")
              : t("newUi.sidebar.userProfile.deleteAccount")}
          </Button>
        </div>
      </InlineView>
    </div>
  );
}
