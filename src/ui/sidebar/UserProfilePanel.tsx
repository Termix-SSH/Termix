import { useState, useRef, useEffect } from "react";
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
  setupTOTP,
  enableTOTP,
  disableTOTP,
  getVersionInfo,
  getUserRoles,
  saveUserPreferences,
  getUserPreferences,
} from "@/main-axios";
import {
  deleteWebAuthnCredential,
  listWebAuthnCredentials,
  registerWebAuthnCredential,
  type WebAuthnCredentialSummary,
  type WebAuthnUserVerification,
} from "@/api/webauthn-api";
import type { UserRole } from "@/main-axios";
import type React from "react";
import { isElectron } from "@/lib/electron";
import { C2STunnelPresetManager } from "@/user/C2STunnelPresetManager";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/dialog";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Eye,
  EyeOff,
  Hammer,
  KeyRound,
  LayoutPanelLeft,
  Network,
  Palette,
  Play,
  Plug,
  Plus,
  RotateCcw,
  ScrollText,
  Server,
  Shield,
  ShieldCheck,
  Trash2,
  Type,
  Usb,
  User,
  X,
  Zap,
} from "lucide-react";
import { SettingRow, FakeSwitch } from "@/components/section-card";
import {
  ACCENT_PRESET_COLORS,
  applyAccentColor,
  applyFontSize,
  FONT_SIZES,
} from "@/lib/theme";
import type { ApiKey } from "@/main-axios";
import { useTheme } from "@/components/theme-provider";
import type { FontSizeId, ThemeId } from "@/types/ui-types";
import { toast } from "sonner";
import i18n from "@/i18n/i18n";

type UserProfileSection =
  | "account"
  | "appearance"
  | "security"
  | "api-keys"
  | "c2s-tunnels";

const THEMES: { id: ThemeId; preview: string }[] = [
  { id: "system", preview: "auto" },
  { id: "light", preview: "#ffffff" },
  { id: "dark", preview: "#1a1c22" },
  { id: "dracula", preview: "#282a36" },
  { id: "catppuccin", preview: "#1e1e2e" },
  { id: "nord", preview: "#2e3440" },
  { id: "solarized", preview: "#002b36" },
  { id: "tokyo-night", preview: "#1a1b26" },
  { id: "one-dark", preview: "#282c34" },
  { id: "gruvbox", preview: "#282828" },
];

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "af", label: "Afrikaans" },
  { code: "ar", label: "العربية" },
  { code: "bn", label: "বাংলা" },
  { code: "bg", label: "Български" },
  { code: "ca", label: "Català" },
  { code: "zh-CN", label: "中文 (简体)" },
  { code: "zh-TW", label: "中文 (繁體)" },
  { code: "cs", label: "Čeština" },
  { code: "da", label: "Dansk" },
  { code: "nl", label: "Nederlands" },
  { code: "fi", label: "Suomi" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "el", label: "Ελληνικά" },
  { code: "he", label: "עברית" },
  { code: "hi", label: "हिन्दी" },
  { code: "hu", label: "Magyar" },
  { code: "id", label: "Indonesia" },
  { code: "it", label: "Italiano" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "no", label: "Norsk" },
  { code: "pl", label: "Polski" },
  { code: "pt-PT", label: "Português (PT)" },
  { code: "pt-BR", label: "Português (BR)" },
  { code: "ro", label: "Română" },
  { code: "ru", label: "Русский" },
  { code: "sr", label: "Српски" },
  { code: "es-ES", label: "Español" },
  { code: "sv-SE", label: "Svenska" },
  { code: "th", label: "ไทย" },
  { code: "tr", label: "Türkçe" },
  { code: "uk", label: "Українська" },
  { code: "vi", label: "Tiếng Việt" },
];

function AccordionSection({
  id,
  label,
  icon,
  open,
  onToggle,
  children,
}: {
  id: string;
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

function NewApiKeyDialog({
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

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error(t("newUi.sidebar.userProfile.apiKeyNameRequired"));
      return;
    }
    try {
      const created = await createApiKey(
        name.trim(),
        userId,
        expiry ? new Date(expiry).toISOString() : undefined,
      );
      onAdd(created);
      onOpenChange(false);
      setName("");
      setExpiry("");
      toast.success(t("newUi.sidebar.userProfile.apiKeyCreated", { name }));
    } catch {
      toast.error(t("newUi.sidebar.userProfile.apiKeyCreateFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-none border-border bg-card p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="size-8 border border-border bg-muted flex items-center justify-center shrink-0">
              <Network className="size-3.5 text-accent-brand" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold leading-none">
                {t("newUi.sidebar.userProfile.createApiKeyTitle")}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                {t("newUi.sidebar.userProfile.createApiKeyDescription")}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

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

        <DialogFooter className="px-5 py-3 border-t border-border bg-muted/20">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="rounded-none text-[10px] font-bold uppercase tracking-widest"
          >
            {t("newUi.sidebar.userProfile.cancel")}
          </Button>
          <Button
            variant="outline"
            className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 rounded-none text-[10px] font-bold uppercase tracking-widest gap-1.5"
            onClick={handleCreate}
          >
            <KeyRound className="size-3" />{" "}
            {t("newUi.sidebar.userProfile.createKey")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  onChangeServer,
  userPrefs,
  onPrefsChange,
}: {
  username?: string;
  onLogout?: () => void;
  onChangeServer?: () => void;
  userPrefs?: {
    reopenTabsOnLogin: boolean;
    storageMode?: string | null;
    commandAutocomplete?: boolean | null;
    commandPaletteEnabled?: boolean | null;
    showHostTags?: boolean | null;
    hostTrayOnClick?: boolean | null;
    compactHostView?: boolean | null;
    pinAppRail?: boolean | null;
    expandAppRailOnHover?: boolean | null;
    foldersCollapsed?: boolean | null;
    confirmSnippetExecution?: boolean | null;
    disableUpdateCheck?: boolean | null;
    confirmTabClose?: boolean | null;
    hiddenRailTabs?: string | null;
    statusColorScheme?: string | null;
  };
  onPrefsChange?: (prefs: { reopenTabsOnLogin: boolean }) => void;
}) {
  const { t } = useTranslation();
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
  const [openSection, setOpenSection] = useState<UserProfileSection | null>(
    "account",
  );

  // User info
  const [userId, setUserId] = useState("");
  const [userRole, setUserRole] = useState("");
  const [authMethod, setAuthMethod] = useState("");
  const [version, setVersion] = useState("");
  const [versionStatus, setVersionStatus] = useState<
    "up_to_date" | "requires_update" | "beta"
  >("up_to_date");
  const [isOidc, setIsOidc] = useState(false);
  const [isDualAuth, setIsDualAuth] = useState(false);

  // TOTP
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpStep, setTotpStep] = useState<
    "idle" | "setup" | "verify" | "backup"
  >("idle");
  const [totpQrCode, setTotpQrCode] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpBackupCodes, setTotpBackupCodes] = useState<string[]>([]);
  const [totpLoading, setTotpLoading] = useState(false);
  const [showDisableTotp, setShowDisableTotp] = useState(false);
  const [disableTotpInput, setDisableTotpInput] = useState("");
  const [passkeys, setPasskeys] = useState<WebAuthnCredentialSummary[]>([]);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeyName, setPasskeyName] = useState("");
  const [passkeyUserVerification, setPasskeyUserVerification] =
    useState<WebAuthnUserVerification>("preferred");

  // Delete account
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  // UI state
  const [showPassword, setShowPassword] = useState(false);
  const [newKeyOpen, setNewKeyOpen] = useState(false);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const { theme, setTheme } = useTheme();
  const localSnapshot = useRef<Record<string, string | null>>({});

  // Appearance state — initialized from localStorage
  const [accentColor, setAccentColor] = useState(
    () => localStorage.getItem("termix-accent") ?? "#f59145",
  );
  const [customColorInput, setCustomColorInput] = useState(
    () => localStorage.getItem("termix-accent") ?? "#f59145",
  );
  const [fontSize, setFontSize] = useState<FontSizeId>(
    () => (localStorage.getItem("termix-font-size") as FontSizeId) ?? "md",
  );
  const [language, setLanguage] = useState(
    () => localStorage.getItem("i18nextLng") ?? "en",
  );
  const [storageMode, setStorageMode] = useState<"local" | "cloud">(() =>
    userPrefs?.storageMode === "cloud" ? "cloud" : "local",
  );

  // Settings toggles — all backed by localStorage
  const [commandAutocomplete, setCommandAutocomplete] = useState(
    () => localStorage.getItem("commandAutocomplete") === "true",
  );
  const [terminalLinkClickBehavior, setTerminalLinkClickBehavior] = useState(
    () => localStorage.getItem("terminalLinkClickBehavior") ?? "confirm",
  );
  const [commandPaletteEnabled, setCommandPaletteEnabled] = useState(() => {
    const v = localStorage.getItem("commandPaletteShortcutEnabled");
    return v !== null ? v === "true" : true;
  });
  const [showHostTags, setShowHostTags] = useState(() => {
    const v = localStorage.getItem("showHostTags");
    return v !== null ? v === "true" : true;
  });
  const [hostTrayOnClick, setHostTrayOnClick] = useState(
    () => localStorage.getItem("hostTrayOnClick") === "true",
  );
  const [compactHostView, setCompactHostView] = useState(
    () => localStorage.getItem("compactHostView") === "true",
  );
  const [statusColorScheme, setStatusColorScheme] = useState(
    () => localStorage.getItem("statusColorScheme") ?? "accent",
  );
  const [pinAppRail, setPinAppRail] = useState(
    () => localStorage.getItem("pinAppRail") === "true",
  );
  const [expandAppRailOnHover, setExpandAppRailOnHover] = useState(
    () => localStorage.getItem("expandAppRailOnHover") !== "false",
  );
  const [foldersCollapsed, setFoldersCollapsed] = useState(
    () => localStorage.getItem("defaultSnippetFoldersCollapsed") !== "false",
  );
  const [confirmSnippetExecution, setConfirmSnippetExecution] = useState(
    () => localStorage.getItem("confirmSnippetExecution") === "true",
  );
  const [disableUpdateCheck, setDisableUpdateCheck] = useState(
    () => localStorage.getItem("disableUpdateCheck") === "true",
  );
  const [confirmTabClose, setConfirmTabClose] = useState(
    () => localStorage.getItem("confirmTabClose") === "true",
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
        setTotpEnabled(info.totp_enabled ?? false);
        setIsOidc(info.is_oidc ?? false);
        setIsDualAuth(info.is_dual_auth ?? false);
        setUserRole(
          info.is_admin
            ? t("newUi.sidebar.userProfile.roleAdministrator")
            : t("newUi.sidebar.userProfile.roleUser"),
        );
        if (info.is_dual_auth) {
          setAuthMethod(t("newUi.sidebar.userProfile.authMethodDual"));
        } else if (info.is_oidc) {
          setAuthMethod(t("newUi.sidebar.userProfile.authMethodOidc"));
        } else {
          setAuthMethod(t("newUi.sidebar.userProfile.authMethodLocal"));
        }
        getUserRoles(info.userId)
          .then(({ roles }) => setUserRoles(roles ?? []))
          .catch(() => {});
      })
      .catch(() => {});
    getApiKeys()
      .then(({ apiKeys: keys }) => setApiKeys(keys))
      .catch(() => {});
    listWebAuthnCredentials()
      .then(({ credentials }) => setPasskeys(credentials ?? []))
      .catch(() => {});
    getVersionInfo()
      .then((info) => {
        setVersion(info.localVersion);
        setVersionStatus(info.status ?? "up_to_date");
      })
      .catch(() => {});
  }, [t]);

  function saveToCloud(prefs: Parameters<typeof saveUserPreferences>[0]) {
    void saveUserPreferences(prefs).catch(() => {});
  }

  async function handleStorageModeChange(mode: "local" | "cloud") {
    setStorageMode(mode);
    if (mode === "cloud") {
      // Snapshot current browser localStorage values so any tab can restore them later
      const SNAPSHOT_KEYS = [
        "termix-accent",
        "termix-font-size",
        "i18nextLng",
        "commandAutocomplete",
        "commandPaletteShortcutEnabled",
        "showHostTags",
        "hostTrayOnClick",
        "compactHostView",
        "pinAppRail",
        "expandAppRailOnHover",
        "defaultSnippetFoldersCollapsed",
        "confirmSnippetExecution",
        "disableUpdateCheck",
        "confirmTabClose",
        "hiddenRailTabs",
        "statusColorScheme",
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
          setLanguage(prefs.language);
          localStorage.setItem("i18nextLng", prefs.language);
          void i18n.changeLanguage(prefs.language);
        }
        if (prefs.commandAutocomplete != null) {
          setCommandAutocomplete(prefs.commandAutocomplete);
          localStorage.setItem(
            "commandAutocomplete",
            String(prefs.commandAutocomplete),
          );
        }
        if (prefs.commandPaletteEnabled != null) {
          setCommandPaletteEnabled(prefs.commandPaletteEnabled);
          localStorage.setItem(
            "commandPaletteShortcutEnabled",
            String(prefs.commandPaletteEnabled),
          );
        }
        if (prefs.showHostTags != null) {
          setShowHostTags(prefs.showHostTags);
          localStorage.setItem("showHostTags", String(prefs.showHostTags));
          window.dispatchEvent(new CustomEvent("showHostTagsChanged"));
        }
        if (prefs.hostTrayOnClick != null) {
          setHostTrayOnClick(prefs.hostTrayOnClick);
          localStorage.setItem(
            "hostTrayOnClick",
            String(prefs.hostTrayOnClick),
          );
        }
        if (prefs.compactHostView != null) {
          setCompactHostView(prefs.compactHostView);
          localStorage.setItem(
            "compactHostView",
            String(prefs.compactHostView),
          );
          window.dispatchEvent(new CustomEvent("compactHostViewChanged"));
        }
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
        if (prefs.foldersCollapsed != null) {
          setFoldersCollapsed(prefs.foldersCollapsed);
          localStorage.setItem(
            "defaultSnippetFoldersCollapsed",
            String(prefs.foldersCollapsed),
          );
        }
        if (prefs.confirmSnippetExecution != null) {
          setConfirmSnippetExecution(prefs.confirmSnippetExecution);
          localStorage.setItem(
            "confirmSnippetExecution",
            String(prefs.confirmSnippetExecution),
          );
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
        if (prefs.statusColorScheme != null) {
          setStatusColorScheme(prefs.statusColorScheme);
          localStorage.setItem("statusColorScheme", prefs.statusColorScheme);
          window.dispatchEvent(new CustomEvent("statusColorSchemeChanged"));
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
    const DEFAULT_ACCENT = "#f59145";
    setTheme("system");
    setFontSize("md");
    applyFontSize("md");
    setAccentColor(DEFAULT_ACCENT);
    setCustomColorInput(DEFAULT_ACCENT);
    localStorage.setItem("termix-accent", DEFAULT_ACCENT);
    applyAccentColor(DEFAULT_ACCENT);
    setLanguage("en");
    localStorage.setItem("i18nextLng", "en");
    void i18n.changeLanguage("en");
    setCommandAutocomplete(false);
    localStorage.setItem("commandAutocomplete", "false");
    setCommandPaletteEnabled(true);
    localStorage.setItem("commandPaletteShortcutEnabled", "true");
    setShowHostTags(true);
    localStorage.setItem("showHostTags", "true");
    window.dispatchEvent(new CustomEvent("showHostTagsChanged"));
    setHostTrayOnClick(false);
    localStorage.setItem("hostTrayOnClick", "false");
    setCompactHostView(false);
    localStorage.setItem("compactHostView", "false");
    window.dispatchEvent(new CustomEvent("compactHostViewChanged"));
    setPinAppRail(false);
    localStorage.setItem("pinAppRail", "false");
    window.dispatchEvent(new Event("pinAppRailChanged"));
    setExpandAppRailOnHover(true);
    localStorage.setItem("expandAppRailOnHover", "true");
    window.dispatchEvent(new Event("expandAppRailOnHoverChanged"));
    setFoldersCollapsed(true);
    localStorage.removeItem("defaultSnippetFoldersCollapsed");
    setConfirmSnippetExecution(false);
    localStorage.setItem("confirmSnippetExecution", "false");
    setDisableUpdateCheck(false);
    localStorage.setItem("disableUpdateCheck", "false");
    setConfirmTabClose(false);
    localStorage.setItem("confirmTabClose", "false");
    setHiddenRailTabs(new Set());
    localStorage.removeItem("hiddenRailTabs");
    window.dispatchEvent(new CustomEvent("hiddenRailTabsChanged"));
    setStatusColorScheme("accent");
    localStorage.setItem("statusColorScheme", "accent");
    window.dispatchEvent(new CustomEvent("statusColorSchemeChanged"));
    if (storageMode === "cloud") {
      saveToCloud({
        theme: "system",
        fontSize: "md",
        accentColor: DEFAULT_ACCENT,
        language: "en",
        commandAutocomplete: false,
        commandPaletteEnabled: true,
        showHostTags: true,
        hostTrayOnClick: false,
        compactHostView: false,
        pinAppRail: false,
        expandAppRailOnHover: true,
        foldersCollapsed: true,
        confirmSnippetExecution: false,
        disableUpdateCheck: false,
        confirmTabClose: false,
        hiddenRailTabs: "[]",
        statusColorScheme: "accent",
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

    const restoredAccent = restore("termix-accent", "#f59145") ?? "#f59145";
    setAccentColor(restoredAccent);
    setCustomColorInput(restoredAccent);
    localStorage.setItem("termix-accent", restoredAccent);
    applyAccentColor(restoredAccent);

    const restoredLang = restore("i18nextLng", "en") ?? "en";
    setLanguage(restoredLang);
    localStorage.setItem("i18nextLng", restoredLang);
    void i18n.changeLanguage(restoredLang);

    const restoredAutocomplete =
      restore("commandAutocomplete", "false") === "true";
    setCommandAutocomplete(restoredAutocomplete);
    localStorage.setItem("commandAutocomplete", String(restoredAutocomplete));

    const restoredPalette =
      restore("commandPaletteShortcutEnabled", "true") !== "false";
    setCommandPaletteEnabled(restoredPalette);
    localStorage.setItem(
      "commandPaletteShortcutEnabled",
      String(restoredPalette),
    );

    const restoredHostTags = restore("showHostTags", "true") !== "false";
    setShowHostTags(restoredHostTags);
    localStorage.setItem("showHostTags", String(restoredHostTags));
    window.dispatchEvent(new CustomEvent("showHostTagsChanged"));

    const restoredTrayOnClick = restore("hostTrayOnClick", "false") === "true";
    setHostTrayOnClick(restoredTrayOnClick);
    localStorage.setItem("hostTrayOnClick", String(restoredTrayOnClick));

    const restoredCompactHostView =
      restore("compactHostView", "false") === "true";
    setCompactHostView(restoredCompactHostView);
    localStorage.setItem("compactHostView", String(restoredCompactHostView));
    window.dispatchEvent(new CustomEvent("compactHostViewChanged"));

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

    const restoredFolders =
      restore("defaultSnippetFoldersCollapsed", null) !== "false";
    setFoldersCollapsed(restoredFolders);
    const snapFolders = hasSnap
      ? snap["defaultSnippetFoldersCollapsed"]
      : localStorage.getItem("defaultSnippetFoldersCollapsed");
    if (snapFolders == null) {
      localStorage.removeItem("defaultSnippetFoldersCollapsed");
    } else {
      localStorage.setItem("defaultSnippetFoldersCollapsed", snapFolders);
    }

    const restoredConfirmSnippet =
      restore("confirmSnippetExecution", "false") === "true";
    setConfirmSnippetExecution(restoredConfirmSnippet);
    localStorage.setItem(
      "confirmSnippetExecution",
      String(restoredConfirmSnippet),
    );

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

    const restoredStatusScheme =
      restore("statusColorScheme", "accent") ?? "accent";
    setStatusColorScheme(restoredStatusScheme);
    localStorage.setItem("statusColorScheme", restoredStatusScheme);
    window.dispatchEvent(new CustomEvent("statusColorSchemeChanged"));

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

  function handleLanguageChange(code: string) {
    setLanguage(code);
    localStorage.setItem("i18nextLng", code);
    i18n.changeLanguage(code);
    if (storageMode === "cloud") saveToCloud({ language: code });
  }

  function toggle(id: UserProfileSection) {
    setOpenSection((prev) => (prev === id ? null : id));
  }

  async function handleStartTotpSetup() {
    setTotpLoading(true);
    try {
      const result = await setupTOTP();
      setTotpQrCode(result.qr_code);
      setTotpSecret(result.secret);
      setTotpCode("");
      setTotpStep("setup");
    } catch {
      toast.error(t("newUi.sidebar.userProfile.totpSetupFailed"));
    } finally {
      setTotpLoading(false);
    }
  }

  async function handleVerifyTotp() {
    if (!totpCode || totpCode.length !== 6) {
      toast.error(t("newUi.sidebar.userProfile.totpEnter6Digits"));
      return;
    }
    setTotpLoading(true);
    try {
      const result = await enableTOTP(totpCode);
      setTotpBackupCodes(result.backup_codes ?? []);
      setTotpEnabled(true);
      setTotpStep("backup");
      toast.success(t("newUi.sidebar.userProfile.totpEnabledSuccess"));
    } catch (e: unknown) {
      toast.error(
        apiErrorMessage(e, t("newUi.sidebar.userProfile.totpInvalidCode")),
      );
    } finally {
      setTotpLoading(false);
    }
  }

  async function handleDisableTotp() {
    if (!disableTotpInput) {
      toast.error(t("newUi.sidebar.userProfile.totpDisableInputRequired"));
      return;
    }
    setTotpLoading(true);
    try {
      await disableTOTP(disableTotpInput);
      setTotpEnabled(false);
      setShowDisableTotp(false);
      setDisableTotpInput("");
      toast.success(t("newUi.sidebar.userProfile.totpDisabledSuccess"));
    } catch (e: unknown) {
      toast.error(
        apiErrorMessage(e, t("newUi.sidebar.userProfile.totpDisableFailed")),
      );
    } finally {
      setTotpLoading(false);
    }
  }

  async function handleRegisterPasskey() {
    setPasskeyLoading(true);
    try {
      await registerWebAuthnCredential(
        passkeyName || "Passkey",
        passkeyUserVerification,
      );
      const { credentials } = await listWebAuthnCredentials();
      setPasskeys(credentials ?? []);
      setPasskeyName("");
      toast.success(t("newUi.sidebar.userProfile.passkeyAdded"));
    } catch (e: unknown) {
      toast.error(
        apiErrorMessage(e, t("newUi.sidebar.userProfile.passkeyAddFailed")),
      );
    } finally {
      setPasskeyLoading(false);
    }
  }

  async function handleDeletePasskey(credentialId: string) {
    setPasskeyLoading(true);
    try {
      await deleteWebAuthnCredential(credentialId);
      setPasskeys((prev) => prev.filter((item) => item.id !== credentialId));
      toast.success(t("newUi.sidebar.userProfile.passkeyDeleted"));
    } catch (e: unknown) {
      toast.error(
        apiErrorMessage(e, t("newUi.sidebar.userProfile.passkeyDeleteFailed")),
      );
    } finally {
      setPasskeyLoading(false);
    }
  }

  function downloadBackupCodes() {
    const blob = new Blob([totpBackupCodes.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "termix-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
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

  const canChangePasword = !isOidc || isDualAuth;

  return (
    <div className="flex flex-col gap-2 p-3">
      <NewApiKeyDialog
        open={newKeyOpen}
        onOpenChange={setNewKeyOpen}
        onAdd={(key) => setApiKeys((prev) => [key, ...prev])}
        userId={userId}
      />

      {/* Storage mode toggle */}
      <div className="border border-border bg-card px-3 py-2.5 flex flex-col gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {t("newUi.sidebar.userProfile.storageModeSwitch")}
        </span>
        <div className="flex border border-border overflow-hidden w-full">
          <button
            onClick={() => handleStorageModeChange("local")}
            className={`flex-1 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${
              storageMode === "local"
                ? "bg-accent-brand text-white"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
            }`}
          >
            {t("newUi.sidebar.userProfile.storageModeLocal")}
          </button>
          <button
            onClick={() => handleStorageModeChange("cloud")}
            className={`flex-1 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${
              storageMode === "cloud"
                ? "bg-accent-brand text-white"
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

      {/* Account */}
      <AccordionSection
        id="account"
        label={t("newUi.sidebar.userProfile.sectionAccount")}
        icon={<User className="size-3.5" />}
        open={openSection === "account"}
        onToggle={() => toggle("account")}
      >
        <div className="flex flex-col gap-0 pt-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-0">
            <div className="flex flex-col py-2">
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
                {t("newUi.sidebar.userProfile.usernameLabel")}
              </span>
              <span className="text-sm font-semibold mt-0.5">
                {username ?? "—"}
              </span>
            </div>
            <div className="flex flex-col py-2">
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
                {t("newUi.sidebar.userProfile.roleLabel")}
              </span>
              <div className="flex flex-wrap gap-1 mt-0.5">
                <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold border border-accent-brand/40 bg-accent-brand/10 text-accent-brand w-fit">
                  {userRole || "—"}
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
            <div className="flex flex-col py-2">
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
                {t("newUi.sidebar.userProfile.authMethodLabel")}
              </span>
              <span className="text-sm font-semibold mt-0.5">
                {authMethod || "—"}
              </span>
            </div>
            <div className="flex flex-col py-2">
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
                {t("newUi.sidebar.userProfile.twoFaLabel")}
              </span>
              <span className="flex items-center gap-1 mt-0.5">
                {totpEnabled ? (
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
          </div>

          <div className="border-t border-border pt-3 mt-1">
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
              {t("newUi.sidebar.userProfile.versionLabel")}
            </span>
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-sm font-bold text-accent-brand">
                {version ? `v${version}` : "—"}
              </span>
              <span
                className={`text-[10px] px-1.5 py-0.5 font-semibold leading-none ${
                  versionStatus === "beta"
                    ? "bg-blue-500/20 text-blue-400"
                    : versionStatus === "requires_update"
                      ? "bg-yellow-500/20 text-yellow-400"
                      : "bg-accent-brand/20 text-accent-brand"
                }`}
              >
                {versionStatus === "beta"
                  ? t("dashboard.beta").toUpperCase()
                  : versionStatus === "requires_update"
                    ? t("dashboard.updateAvailable").toUpperCase()
                    : t("dashboardTab.stable")}
              </span>
            </div>
          </div>

          {isElectron() && onChangeServer && (
            <div className="border-t border-border pt-3 mt-3">
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium">
                    {t("serverConfig.changeServer")}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {t("newUi.sidebar.userProfile.changeServerDescription")}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 ml-3 text-[10px] h-7"
                  onClick={onChangeServer}
                >
                  <Server className="size-3" />
                  {t("serverConfig.changeServer")}
                </Button>
              </div>
            </div>
          )}

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
        </div>
      </AccordionSection>

      {/* Appearance */}
      <AccordionSection
        id="appearance"
        label={t("newUi.sidebar.userProfile.sectionAppearance")}
        icon={<Palette className="size-3.5" />}
        open={openSection === "appearance"}
        onToggle={() => toggle("appearance")}
      >
        <div className="flex flex-col gap-4 pt-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("newUi.sidebar.userProfile.languageLabel")}
            </span>
            <select
              value={language}
              onChange={(e) => handleLanguageChange(e.target.value)}
              className="px-2.5 py-1.5 text-xs bg-background border border-border text-foreground outline-none focus:ring-1 focus:ring-ring w-full"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("newUi.sidebar.userProfile.themeLabel")}
            </span>
            <div className="relative">
              <select
                value={theme}
                onChange={(e) => handleThemeChange(e.target.value as ThemeId)}
                className="w-full px-2.5 py-1.5 text-xs bg-background border border-border text-foreground outline-none focus:ring-1 focus:ring-ring appearance-none pr-7"
              >
                {THEMES.map((th) => (
                  <option key={th.id} value={th.id}>
                    {themeLabel[th.id]}
                  </option>
                ))}
              </select>
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
              {t("newUi.sidebar.userProfile.settingsTerminal")}
            </span>
            <SettingRow
              label={t("newUi.sidebar.userProfile.commandAutocomplete")}
              description={t(
                "newUi.sidebar.userProfile.commandAutocompleteDesc",
              )}
            >
              <FakeSwitch
                checked={commandAutocomplete}
                onChange={(v) => {
                  setCommandAutocomplete(v);
                  localStorage.setItem("commandAutocomplete", v.toString());
                  if (storageMode === "cloud")
                    saveToCloud({ commandAutocomplete: v });
                }}
              />
            </SettingRow>
            <div className="flex flex-col gap-1.5 py-3 border-b border-border">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium leading-snug">
                  {t("newUi.sidebar.userProfile.terminalLinkBehavior")}
                </span>
                <span className="text-xs text-muted-foreground leading-snug">
                  {t("newUi.sidebar.userProfile.terminalLinkBehaviorDesc")}
                </span>
              </div>
              <select
                value={terminalLinkClickBehavior}
                onChange={(e) => {
                  setTerminalLinkClickBehavior(e.target.value);
                  localStorage.setItem(
                    "terminalLinkClickBehavior",
                    e.target.value,
                  );
                }}
                className="h-7 border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="confirm">
                  {t("hosts.linkClickBehaviorConfirm")}
                </option>
                <option value="direct">
                  {t("hosts.linkClickBehaviorDirect")}
                </option>
              </select>
            </div>
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
          </div>

          <div className="flex flex-col gap-1 border-t border-border pt-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
              {t("newUi.sidebar.userProfile.settingsSidebar")}
            </span>
            <SettingRow
              label={t("newUi.sidebar.userProfile.showHostTags")}
              description={t("newUi.sidebar.userProfile.showHostTagsDesc")}
            >
              <FakeSwitch
                checked={showHostTags}
                onChange={(v) => {
                  setShowHostTags(v);
                  localStorage.setItem("showHostTags", v.toString());
                  window.dispatchEvent(new Event("showHostTagsChanged"));
                  if (storageMode === "cloud") saveToCloud({ showHostTags: v });
                }}
              />
            </SettingRow>
            <SettingRow
              label={t("newUi.sidebar.userProfile.hostTrayOnClick")}
              description={t("newUi.sidebar.userProfile.hostTrayOnClickDesc")}
            >
              <FakeSwitch
                checked={hostTrayOnClick}
                onChange={(v) => {
                  setHostTrayOnClick(v);
                  localStorage.setItem("hostTrayOnClick", v.toString());
                  window.dispatchEvent(new Event("hostTrayOnClickChanged"));
                  if (storageMode === "cloud")
                    saveToCloud({ hostTrayOnClick: v });
                }}
              />
            </SettingRow>
            <SettingRow
              label={t("newUi.sidebar.userProfile.compactHostView")}
              description={t("newUi.sidebar.userProfile.compactHostViewDesc")}
            >
              <FakeSwitch
                checked={compactHostView}
                onChange={(v) => {
                  setCompactHostView(v);
                  localStorage.setItem("compactHostView", v.toString());
                  window.dispatchEvent(new Event("compactHostViewChanged"));
                  if (storageMode === "cloud")
                    saveToCloud({ compactHostView: v });
                }}
              />
            </SettingRow>
            <SettingRow
              label={t("newUi.sidebar.userProfile.statusColors")}
              description={t("newUi.sidebar.userProfile.statusColorsDesc")}
            >
              <FakeSwitch
                checked={statusColorScheme === "status"}
                onChange={(v) => {
                  const scheme = v ? "status" : "accent";
                  setStatusColorScheme(scheme);
                  localStorage.setItem("statusColorScheme", scheme);
                  window.dispatchEvent(new Event("statusColorSchemeChanged"));
                  if (storageMode === "cloud")
                    saveToCloud({ statusColorScheme: scheme });
                }}
              />
            </SettingRow>
            <SettingRow
              label={t("newUi.sidebar.userProfile.pinAppRail")}
              description={t("newUi.sidebar.userProfile.pinAppRailDesc")}
            >
              <FakeSwitch
                checked={pinAppRail}
                onChange={(v) => {
                  setPinAppRail(v);
                  localStorage.setItem("pinAppRail", v.toString());
                  window.dispatchEvent(new Event("pinAppRailChanged"));
                  if (storageMode === "cloud") saveToCloud({ pinAppRail: v });
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
                  localStorage.setItem("expandAppRailOnHover", v.toString());
                  window.dispatchEvent(
                    new Event("expandAppRailOnHoverChanged"),
                  );
                  if (storageMode === "cloud")
                    saveToCloud({ expandAppRailOnHover: v });
                }}
              />
            </SettingRow>
          </div>

          <div className="flex flex-col gap-1 border-t border-border pt-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
              {t("newUi.sidebar.userProfile.settingsNavigation")}
            </span>
            <p className="text-[10px] text-muted-foreground mb-2">
              {t("newUi.sidebar.userProfile.navigationTabsDesc")}
            </p>
            {(
              [
                {
                  id: "hosts",
                  icon: <Server size={12} />,
                  label: t("nav.hosts"),
                },
                {
                  id: "credentials",
                  icon: <KeyRound size={12} />,
                  label: t("nav.credentials"),
                },
                {
                  id: "connections",
                  icon: <Plug size={12} />,
                  label: t("nav.connections"),
                },
                {
                  id: "quick-connect",
                  icon: <Zap size={12} />,
                  label: t("nav.quickConnect"),
                },
                {
                  id: "serial",
                  icon: <Usb size={12} />,
                  label: t("nav.serial"),
                },
                {
                  id: "ssh-tools",
                  icon: <Hammer size={12} />,
                  label: t("nav.sshTools"),
                },
                {
                  id: "snippets",
                  icon: <Play size={12} />,
                  label: t("nav.snippets"),
                },
                {
                  id: "history",
                  icon: <Clock size={12} />,
                  label: t("nav.history"),
                },
                {
                  id: "session-logs",
                  icon: <ScrollText size={12} />,
                  label: t("nav.sessionLogs"),
                },
                {
                  id: "split-screen",
                  icon: <LayoutPanelLeft size={12} />,
                  label: t("nav.splitScreen"),
                },
                {
                  id: "network_graph",
                  icon: <Network size={12} />,
                  label: t("nav.networkGraph"),
                },
              ] as { id: string; icon: React.ReactNode; label: string }[]
            ).map((tab) => (
              <div
                key={tab.id}
                className="flex items-center justify-between py-1.5"
              >
                <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <span className="text-muted-foreground">{tab.icon}</span>
                  {tab.label}
                </span>
                <FakeSwitch
                  checked={!hiddenRailTabs.has(tab.id)}
                  onChange={(visible) => {
                    const next = new Set(hiddenRailTabs);
                    if (visible) next.delete(tab.id);
                    else next.add(tab.id);
                    setHiddenRailTabs(next);
                    const serialized = JSON.stringify([...next]);
                    localStorage.setItem("hiddenRailTabs", serialized);
                    window.dispatchEvent(new Event("hiddenRailTabsChanged"));
                    if (storageMode === "cloud")
                      saveToCloud({ hiddenRailTabs: serialized });
                  }}
                />
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1 border-t border-border pt-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
              {t("newUi.sidebar.userProfile.settingsSnippets")}
            </span>
            <SettingRow
              label={t("newUi.sidebar.userProfile.foldersCollapsed")}
              description={t("newUi.sidebar.userProfile.foldersCollapsedDesc")}
            >
              <FakeSwitch
                checked={foldersCollapsed}
                onChange={(v) => {
                  setFoldersCollapsed(v);
                  localStorage.setItem(
                    "defaultSnippetFoldersCollapsed",
                    v.toString(),
                  );
                  window.dispatchEvent(
                    new Event("defaultSnippetFoldersCollapsedChanged"),
                  );
                  if (storageMode === "cloud")
                    saveToCloud({ foldersCollapsed: v });
                }}
              />
            </SettingRow>
            <SettingRow
              label={t("newUi.sidebar.userProfile.confirmExecution")}
              description={t("newUi.sidebar.userProfile.confirmExecutionDesc")}
            >
              <FakeSwitch
                checked={confirmSnippetExecution}
                onChange={(v) => {
                  setConfirmSnippetExecution(v);
                  localStorage.setItem("confirmSnippetExecution", v.toString());
                  if (storageMode === "cloud")
                    saveToCloud({ confirmSnippetExecution: v });
                }}
              />
            </SettingRow>
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

      {/* Security */}
      <AccordionSection
        id="security"
        label={t("newUi.sidebar.userProfile.sectionSecurity")}
        icon={<Shield className="size-3.5" />}
        open={openSection === "security"}
        onToggle={() => toggle("security")}
      >
        <div className="flex flex-col gap-4 pt-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">
                    {t("newUi.sidebar.userProfile.totpAuthenticator")}
                  </span>
                  <a
                    href="https://docs.termix.site/features/authentication/totp"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] text-accent-brand hover:underline"
                  >
                    {t("hosts.docsLink")}
                  </a>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {totpEnabled
                    ? t("newUi.sidebar.userProfile.totpEnabled")
                    : t("newUi.sidebar.userProfile.totpDisabled")}
                </span>
              </div>
              {totpEnabled ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 ml-3 text-[10px] h-7 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setShowDisableTotp((o) => !o)}
                >
                  {t("newUi.sidebar.userProfile.disable")}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 ml-3 text-[10px] h-7 border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                  onClick={handleStartTotpSetup}
                  disabled={totpLoading || totpStep !== "idle"}
                >
                  {t("newUi.sidebar.userProfile.enable")}
                </Button>
              )}
            </div>

            {/* Disable TOTP form */}
            {totpEnabled && showDisableTotp && (
              <div className="border border-border bg-muted/20 p-3 flex flex-col gap-3">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {t("newUi.sidebar.userProfile.totpDisableTitle")}
                </span>
                <Input
                  placeholder={t(
                    "newUi.sidebar.userProfile.totpDisablePlaceholder",
                  )}
                  value={disableTotpInput}
                  onChange={(e) => setDisableTotpInput(e.target.value)}
                  className="text-sm"
                />
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1 text-xs"
                    onClick={() => {
                      setShowDisableTotp(false);
                      setDisableTotpInput("");
                    }}
                  >
                    {t("newUi.sidebar.userProfile.cancel")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={handleDisableTotp}
                    disabled={totpLoading}
                  >
                    {t("newUi.sidebar.userProfile.totpDisableConfirm")}
                  </Button>
                </div>
              </div>
            )}

            {/* TOTP setup: scan QR */}
            {!totpEnabled && totpStep === "setup" && (
              <div className="border border-border bg-muted/20 p-3 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    {t("newUi.sidebar.userProfile.setupTotp")}
                  </span>
                  <button
                    onClick={() => setTotpStep("idle")}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
                {totpQrCode ? (
                  <div className="flex items-center justify-center p-3 bg-background border border-border">
                    <img
                      src={totpQrCode}
                      alt={t("newUi.sidebar.userProfile.qrCode")}
                      className="size-32"
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-center p-3 bg-background border border-border">
                    <div className="size-24 bg-muted flex items-center justify-center text-[10px] text-muted-foreground">
                      {t("newUi.sidebar.userProfile.qrCode")}
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2 bg-muted/30 border border-border px-2 py-1.5">
                  <span className="text-[10px] font-mono flex-1 tracking-widest select-all truncate">
                    {totpSecret}
                  </span>
                  <button
                    onClick={() => {
                      copyToClipboard(totpSecret);
                      toast.info(t("newUi.sidebar.userProfile.secretCopied"));
                    }}
                    className="text-muted-foreground hover:text-accent-brand shrink-0"
                  >
                    <Copy className="size-3.5" />
                  </button>
                </div>
                <span className="text-[10px] text-muted-foreground text-center">
                  {t("newUi.sidebar.userProfile.totpInstructions")}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                  onClick={() => setTotpStep("verify")}
                >
                  {t("newUi.sidebar.userProfile.totpContinueVerify")}
                </Button>
              </div>
            )}

            {/* TOTP setup: verify code */}
            {!totpEnabled && totpStep === "verify" && (
              <div className="border border-border bg-muted/20 p-3 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    {t("newUi.sidebar.userProfile.totpVerifyTitle")}
                  </span>
                  <button
                    onClick={() => setTotpStep("setup")}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
                <Input
                  placeholder={t(
                    "newUi.sidebar.userProfile.totpCodePlaceholder",
                  )}
                  value={totpCode}
                  onChange={(e) =>
                    setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  onKeyDown={(e) => e.key === "Enter" && handleVerifyTotp()}
                  className="text-center font-mono tracking-widest text-lg h-10"
                  maxLength={6}
                />
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1 text-xs"
                    onClick={() => setTotpStep("setup")}
                  >
                    {t("newUi.sidebar.userProfile.cancel")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                    onClick={handleVerifyTotp}
                    disabled={totpLoading || totpCode.length !== 6}
                  >
                    <CheckCircle2 className="size-3.5" />
                    {t("newUi.sidebar.userProfile.verify")}
                  </Button>
                </div>
              </div>
            )}

            {/* TOTP setup: backup codes */}
            {totpStep === "backup" && totpBackupCodes.length > 0 && (
              <div className="border border-border bg-muted/20 p-3 flex flex-col gap-3">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {t("newUi.sidebar.userProfile.totpBackupTitle")}
                </span>
                <div className="grid grid-cols-2 gap-1">
                  {totpBackupCodes.map((code) => (
                    <span
                      key={code}
                      className="text-[10px] font-mono bg-muted border border-border px-2 py-1 text-center"
                    >
                      {code}
                    </span>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                  onClick={downloadBackupCodes}
                >
                  {t("newUi.sidebar.userProfile.totpDownloadBackup")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => setTotpStep("idle")}
                >
                  {t("newUi.sidebar.userProfile.done")}
                </Button>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium">
                  {t("newUi.sidebar.userProfile.passkeys")}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {t("newUi.sidebar.userProfile.passkeysDesc")}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Input
                placeholder={t("newUi.sidebar.userProfile.passkeyName")}
                value={passkeyName}
                onChange={(e) => setPasskeyName(e.target.value)}
                className="h-8 text-xs"
                disabled={passkeyLoading}
              />
              <select
                value={passkeyUserVerification}
                onChange={(e) =>
                  setPasskeyUserVerification(
                    e.target.value as WebAuthnUserVerification,
                  )
                }
                className="h-8 w-28 text-xs border border-border bg-background px-2 outline-none focus:ring-1 focus:ring-ring"
                disabled={passkeyLoading}
              >
                <option value="preferred">
                  {t("newUi.sidebar.userProfile.passkeyUvPreferred")}
                </option>
                <option value="required">
                  {t("newUi.sidebar.userProfile.passkeyUvRequired")}
                </option>
                <option value="discouraged">
                  {t("newUi.sidebar.userProfile.passkeyUvDiscouraged")}
                </option>
              </select>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[10px] border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
              onClick={handleRegisterPasskey}
              disabled={passkeyLoading}
            >
              <KeyRound className="size-3" />
              {t("newUi.sidebar.userProfile.addPasskey")}
            </Button>

            <div className="flex flex-col divide-y divide-border border border-border">
              {passkeys.length === 0 ? (
                <div className="py-4 text-center text-[10px] text-muted-foreground">
                  {t("newUi.sidebar.userProfile.noPasskeys")}
                </div>
              ) : (
                passkeys.map((passkey) => (
                  <div
                    key={passkey.id}
                    className="flex items-center justify-between gap-2 px-2 py-2"
                  >
                    <div className="min-w-0 flex flex-col">
                      <span className="text-xs font-medium truncate">
                        {passkey.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground truncate">
                        {passkey.deviceType || "unknown"}
                        {passkey.backedUp ? " / synced" : ""}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDeletePasskey(passkey.id)}
                      disabled={passkeyLoading}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>

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
        open={openSection === "api-keys"}
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

      {isElectron() && (
        <AccordionSection
          id="c2s-tunnels"
          label={t("newUi.sidebar.userProfile.sectionC2sTunnels")}
          icon={<Activity className="size-3.5" />}
          open={openSection === "c2s-tunnels"}
          onToggle={() => toggle("c2s-tunnels")}
        >
          <C2STunnelPresetManager />
        </AccordionSection>
      )}

      {/* Delete account dialog */}
      <Dialog
        open={showDeleteConfirm}
        onOpenChange={(open) => {
          setShowDeleteConfirm(open);
          if (!open) setDeletePassword("");
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-destructive">
              {t("newUi.sidebar.userProfile.deleteAccount")}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("newUi.sidebar.userProfile.deleteAccountPermanent")}
            </DialogDescription>
          </DialogHeader>
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
        </DialogContent>
      </Dialog>
    </div>
  );
}
