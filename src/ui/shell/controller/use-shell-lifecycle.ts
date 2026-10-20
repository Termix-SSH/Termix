/* eslint-disable react-hooks/exhaustive-deps */
import { useCallback, useEffect, useState, type MutableRefObject } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { FontSizeId, ThemeId } from "@/types/ui-types";
import { resetPermissionsCache } from "@/hooks/use-permissions";
import { applyAccentColor, applyFontSize } from "@/lib/theme";
import { useTheme } from "@/components/theme-provider";
import {
  getUserInfo,
  getUserPreferences,
  saveUserPreferences,
  type UserPreferences,
} from "@/main-axios";
import { dbHealthMonitor } from "@/lib/db-health-monitor";
import { changeAppLanguage, consumeLoginLanguage } from "@/i18n/i18n";
import {
  MANAGE_REQUEST_EVENT,
  requestFromLegacyEvent,
  requestManage,
} from "@/manage/manage-requests";
import type { TabType } from "@/types/ui-types";

/** Keys a cloud-synced profile overwrites, snapshotted first so they can come back. */
const SNAPSHOT_KEYS = [
  "termix-accent",
  "termix-font-size",
  "termix-ui-font",
  "i18nextLng",
  "commandPaletteShortcutEnabled",
  "showHostTags",
  "hostTrayOnClick",
  "pinAppRail",
  "expandAppRailOnHover",
  "disableUpdateCheck",
  "confirmTabClose",
  "hiddenRailTabs",
];

/** Applies a cloud-synced profile to this browser. */
function applyCloudPreferences(
  prefs: UserPreferences,
  setTheme: (theme: ThemeId) => void,
  currentLanguage: string,
  loginLanguage: string | null,
) {
  // Persist the current browser values before overwriting, so any tab can restore them
  if (!localStorage.getItem("termix-local-snapshot")) {
    const snap: Record<string, string | null> = {
      __theme: localStorage.getItem("termix-theme"),
    };
    for (const key of SNAPSHOT_KEYS) snap[key] = localStorage.getItem(key);
    localStorage.setItem("termix-local-snapshot", JSON.stringify(snap));
  }
  // The account's own pick wins over the older profile field.
  const cloudTheme = prefs.themeId ?? prefs.theme;
  if (cloudTheme) setTheme(cloudTheme as ThemeId);
  if (prefs.fontSize) applyFontSize(prefs.fontSize as FontSizeId);
  if (prefs.accentColor) {
    localStorage.setItem("termix-accent", prefs.accentColor);
    applyAccentColor(prefs.accentColor);
  }
  const preferredLanguage = loginLanguage ?? prefs.language;
  if (preferredLanguage && preferredLanguage !== currentLanguage) {
    void changeAppLanguage(preferredLanguage);
  }
  if (loginLanguage && loginLanguage !== prefs.language) {
    void saveUserPreferences({ language: loginLanguage });
  }
  if (
    prefs.commandPaletteEnabled !== null &&
    prefs.commandPaletteEnabled !== undefined
  )
    localStorage.setItem(
      "commandPaletteShortcutEnabled",
      String(prefs.commandPaletteEnabled),
    );
  if (prefs.showHostTags !== null && prefs.showHostTags !== undefined) {
    localStorage.setItem("showHostTags", String(prefs.showHostTags));
    window.dispatchEvent(new CustomEvent("showHostTagsChanged"));
  }
  if (prefs.hostTrayOnClick !== null && prefs.hostTrayOnClick !== undefined)
    localStorage.setItem("hostTrayOnClick", String(prefs.hostTrayOnClick));
  if (prefs.pinAppRail !== null && prefs.pinAppRail !== undefined) {
    localStorage.setItem("pinAppRail", String(prefs.pinAppRail));
    window.dispatchEvent(new Event("pinAppRailChanged"));
  }
  if (
    prefs.expandAppRailOnHover !== null &&
    prefs.expandAppRailOnHover !== undefined
  ) {
    localStorage.setItem(
      "expandAppRailOnHover",
      String(prefs.expandAppRailOnHover),
    );
    window.dispatchEvent(new Event("expandAppRailOnHoverChanged"));
  }
  if (
    prefs.disableUpdateCheck !== null &&
    prefs.disableUpdateCheck !== undefined
  )
    localStorage.setItem(
      "disableUpdateCheck",
      String(prefs.disableUpdateCheck),
    );
  if (prefs.confirmTabClose !== null && prefs.confirmTabClose !== undefined)
    localStorage.setItem("confirmTabClose", String(prefs.confirmTabClose));
  if (prefs.hiddenRailTabs !== null && prefs.hiddenRailTabs !== undefined) {
    localStorage.setItem("hiddenRailTabs", prefs.hiddenRailTabs);
    window.dispatchEvent(new CustomEvent("hiddenRailTabsChanged"));
  }
}

/** Who is signed in and what the shell does around the tabs: prefs, health, logout. */
export function useShellLifecycle({
  onLogout,
  openSingletonTabRef,
}: {
  onLogout: (options?: { manual?: boolean }) => void;
  openSingletonTabRef: MutableRefObject<(type: TabType) => string | undefined>;
}) {
  const { t, i18n } = useTranslation();
  const { setTheme } = useTheme();
  const [userPrefs, setUserPrefs] = useState<UserPreferences>({
    reopenTabsOnLogin: false,
  });
  const [userPrefsLoaded, setUserPrefsLoaded] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAppFullscreen, setIsAppFullscreen] = useState(
    () => !!document.fullscreenElement,
  );

  // Anything that asks to add or edit a host, a credential or host defaults
  // ends up in the Manage tab, whichever event it still speaks.
  useEffect(() => {
    const names = [
      "host-manager:add-host",
      "host-manager:edit-host",
      "host-manager:add-credential",
      "host-manager:show-credentials",
      "host-manager:edit-defaults",
      "termix:open-host-defaults",
    ];
    const handler = (e: Event) => {
      const request = requestFromLegacyEvent(e.type, (e as CustomEvent).detail);
      if (request) requestManage(request);
    };
    const open = () => openSingletonTabRef.current("host-manager");
    for (const name of names) window.addEventListener(name, handler);
    window.addEventListener(MANAGE_REQUEST_EVENT, open);
    return () => {
      for (const name of names) window.removeEventListener(name, handler);
      window.removeEventListener(MANAGE_REQUEST_EVENT, open);
    };
  }, []);

  useEffect(() => {
    getUserInfo()
      .then((info) => setIsAdmin(info.is_admin))
      .catch(() => setIsAdmin(false));
  }, []);

  const toggleAppFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }

      if (!document.fullscreenEnabled) {
        toast.error(t("nav.fullscreenUnsupported"));
        return;
      }

      await document.documentElement.requestFullscreen();
    } catch {
      toast.error(t("nav.fullscreenFailed"));
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsAppFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    const handle = (event: Event) => {
      const manual =
        event instanceof CustomEvent &&
        (event.detail as { manual?: boolean } | undefined)?.manual === true;
      // Drop the cached grants so the next user never inherits them.
      resetPermissionsCache();
      onLogout(manual ? { manual: true } : undefined);
    };
    window.addEventListener("termix:logout", handle);
    return () => window.removeEventListener("termix:logout", handle);
  }, [onLogout]);

  useEffect(() => {
    const handleSessionExpired = () => onLogout();
    dbHealthMonitor.on("session-expired", handleSessionExpired);
    return () => dbHealthMonitor.off("session-expired", handleSessionExpired);
  }, [onLogout]);

  useEffect(() => {
    const handleDegraded = () => {
      toast.loading(t("common.connectionDegraded"), {
        id: "db-connection-degraded",
        duration: Infinity,
        dismissible: false,
        action: {
          label: t("common.reload"),
          onClick: () => window.location.reload(),
        },
      });
    };

    const handleRestored = () => {
      toast.dismiss("db-connection-degraded");
      toast.success(t("common.backendReconnected"), { duration: 3000 });
    };

    dbHealthMonitor.on("database-connection-degraded", handleDegraded);
    dbHealthMonitor.on("database-connection-degraded-cleared", handleRestored);

    return () => {
      dbHealthMonitor.off("database-connection-degraded", handleDegraded);
      dbHealthMonitor.off(
        "database-connection-degraded-cleared",
        handleRestored,
      );
    };
  }, [t]);

  useEffect(() => {
    getUserPreferences()
      .then((prefs) => {
        const loginLanguage = consumeLoginLanguage();
        setUserPrefs(prefs);
        if (prefs.storageMode === "cloud") {
          applyCloudPreferences(prefs, setTheme, i18n.language, loginLanguage);
        }
      })
      .catch(() => {})
      .finally(() => setUserPrefsLoaded(true));
  }, []);

  return {
    isAdmin,
    userPrefs,
    setUserPrefs,
    userPrefsLoaded,
    isAppFullscreen,
    toggleAppFullscreen,
  };
}
