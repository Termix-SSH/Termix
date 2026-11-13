/**
 * Mirrors the shell's state into frame-state, from which every plugin frame
 * gets its copy. Renders nothing. Mounted once inside the shell.
 */

import { useEffect, useMemo, useState } from "react";
import i18n from "@/i18n/i18n";
import { useTheme } from "@/components/theme-provider";
import { getTheme, themeMode, useThemes } from "@/look/theme-registry";
import { usePermissions } from "@/hooks/use-permissions";
import { useServerStatus } from "@/lib/ServerStatusContext";
import { readStatusColorScheme } from "@/hooks/use-status-color-scheme";
import { useUiPreferencesContext } from "@/contexts/UiPreferencesContext";
import type { UiPluginPresets } from "@/types/ui-preferences";
import { useSshAuthProviders } from "@/hooks/useSshAuthProviders";
import { useTabTypes } from "@/shell/tab-registry";
import { useCompanionDefs } from "@/shell/companions";
import { useHostActions } from "@/sidebar/host-contributions";
import { enabledHostProtocols } from "@/sidebar/host-protocols";
import { useOptionalShellController } from "@/shell/controller/ShellControllerProvider";
import { useIsMobile } from "@/hooks/use-mobile";
import { isElectron } from "@/lib/electron";
import { getUserInfo } from "@/main-axios";
import { PLUGIN_SETTINGS_CHANGED_EVENT } from "@/api/plugins-api";
import { iconToWire } from "@/plugin-frame/wire";
import { usePluginStore } from "../plugin-store";
import { useShellHosts, tabsApi } from "../shell-bridge";
import { onRemoteServerChange, remoteServerUrl } from "../desktop";
import { setSharedState } from "./frame-state";
import { broadcastToFrames } from "./frame-connection";
import { setUiPreferenceSetter } from "./frame-ui-preferences";

const themeCssCache = new Map<string, string>();

async function themeCss(href: string | undefined): Promise<string[]> {
  if (!href) return [];
  const cached = themeCssCache.get(href);
  if (cached !== undefined) return [cached];
  try {
    const response = await fetch(href);
    const text = response.ok ? await response.text() : "";
    themeCssCache.set(href, text);
    return [text];
  } catch {
    return [];
  }
}

function useDocumentLook(): { className: string; style: string } {
  const read = () => ({
    className: document.documentElement.className,
    style: document.documentElement.getAttribute("style") ?? "",
  });
  const [look, setLook] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setLook(read()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    return () => observer.disconnect();
  }, []);
  return look;
}

export function FrameStateSync() {
  const { theme } = useTheme();
  const themes = useThemes();
  const look = useDocumentLook();
  const { hosts, loaded } = useShellHosts();
  const permissions = usePermissions();
  const status = useServerStatus();
  const preferences = useUiPreferencesContext();
  const sshAuth = useSshAuthProviders();
  const tabTypes = useTabTypes();
  const companions = useCompanionDefs();
  const hostActions = useHostActions();
  const controller = useOptionalShellController();
  const isMobile = useIsMobile();
  const store = usePluginStore();

  const framedIds = useMemo(
    () =>
      [...store.records.values()]
        .filter((record) => record.summary.frontendIsolation === "frame")
        .map((record) => record.summary),
    [store],
  );

  useEffect(() => {
    let cancelled = false;
    const applied = theme === "system" ? themeMode(theme) : theme;
    void themeCss(getTheme(applied)?.cssHref).then((css) => {
      if (cancelled) return;
      setSharedState({
        theme: {
          className: look.className,
          style: look.style,
          mode: themeMode(applied),
          themeId: applied,
          css,
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [theme, themes, look]);

  useEffect(() => {
    setSharedState({
      shellHosts: hosts.map((host) => ({
        ...(host as unknown as Record<string, unknown>),
        protocols: [
          ...(host.enableSsh !== false ? ["ssh"] : []),
          ...enabledHostProtocols(
            host as {
              pluginSettings?: Record<string, Record<string, unknown>>;
            },
          ).map((protocol) => protocol.id),
        ],
      })),
      hostsLoaded: loaded,
    });
  }, [hosts, loaded]);

  useEffect(() => {
    setSharedState({
      permissions: permissions.permissions,
      permissionsLoaded: permissions.loaded,
    });
  }, [permissions.permissions, permissions.isAdmin, permissions.loaded]);

  useEffect(() => {
    const out: Record<string, { status: string }> = {};
    for (const [hostId, entry] of status.statuses) {
      out[String(hostId)] = { status: String(entry.status) };
    }
    setSharedState({
      hostStatus: out,
      statusColorScheme: readStatusColorScheme(),
    });
  }, [status.statuses]);

  useEffect(() => {
    let cancelled = false;
    void getUserInfo()
      .then((info) => {
        if (cancelled) return;
        setSharedState({
          user: {
            userId: info.userId,
            username: info.username,
            isAdmin: !!info.is_admin,
          },
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const values: Record<string, unknown> = {};
    for (const summary of framedIds) {
      const presets = summary.contributes?.uiPresets as
        UiPluginPresets | undefined;
      values[summary.id] = preferences
        ? preferences.resolvePlugin(summary.id, presets)
        : { ...(presets?.balanced ?? {}) };
    }
    setSharedState({ uiPreferences: values });
    setUiPreferenceSetter(
      preferences
        ? (pluginId, key, value) =>
            preferences.setPluginOverride(pluginId, key, value)
        : null,
    );
  }, [preferences, framedIds]);

  useEffect(() => {
    setSharedState({
      sshAuthTypes: {
        loaded: sshAuth.loaded,
        types: sshAuth.providers
          .filter((option) => option.available)
          .map((option) => ({
            type: option.type,
            labelKey: option.editorTitleKey ?? option.labelKey,
            pluginId: option.pluginId,
            credentialType: option.credentialType,
            supportsBackground: option.supportsBackground,
            quickConnect: option.quickConnect === true,
          })),
      },
    });
  }, [sshAuth.loaded, sshAuth.providers]);

  useEffect(() => {
    const types = new Set<string>();
    const targets: Record<
      string,
      { icon?: { $icon: string }; tab: string; titleKey?: string }
    > = {};
    for (const def of tabTypes) {
      for (const type of def.activityTypes ?? []) {
        types.add(type);
        targets[type] ??= {
          tab: def.id,
          titleKey: def.titleKey,
          icon: iconToWire(def.icon),
        };
      }
    }
    setSharedState({ activityTypes: [...types], activityTargets: targets });
  }, [tabTypes]);

  useEffect(() => {
    setSharedState({
      companions: companions.map((def) => ({
        id: def.id,
        titleKey: def.titleKey ?? def.id,
        tabTypes: def.tabTypes ?? [],
        icon: iconToWire(def.icon),
      })),
      hostActions: hostActions.map((action) => ({
        id: action.id,
        pluginId: action.pluginId,
        titleKey: action.titleKey,
        kind: action.kind,
        tabType: action.tabType,
        priority: action.priority,
        order: action.order,
        icon: iconToWire(action.icon),
      })),
    });
  }, [companions, hostActions]);

  const tabs = controller?.tabs.list;
  const tabsReady = controller?.tabs.ready ?? false;
  useEffect(() => {
    setSharedState({
      tabs: (tabs ?? []).map((tab) => ({
        id: tab.id,
        instanceId: tab.instanceId,
        type: tab.type,
        label: tab.customLabel ?? tab.label,
        hostId: tab.host ? String(tab.host.id) : null,
      })),
      tabsReady,
      layout: tabsApi.getLayout() as Record<string, unknown> | null,
    });
  }, [tabs, tabsReady]);

  useEffect(() => {
    setSharedState({ isMobile });
  }, [isMobile]);

  useEffect(() => {
    let cancelled = false;
    const read = () =>
      void remoteServerUrl().then((url) => {
        if (!cancelled) {
          setSharedState({
            desktop: { available: isElectron(), remoteServerUrl: url },
          });
        }
      });
    read();
    const stop = onRemoteServerChange(read);
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  useEffect(() => {
    const onLanguage = (language: string) =>
      broadcastToFrames("language", language);
    i18n.on("languageChanged", onLanguage);
    const onSettings = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        pluginId?: string;
        scope?: string;
        hostId?: number;
      } | null;
      if (!detail?.pluginId) return;
      broadcastToFrames(
        "settingsChanged",
        { scope: detail.scope, hostId: detail.hostId },
        detail.pluginId,
      );
    };
    window.addEventListener(PLUGIN_SETTINGS_CHANGED_EVENT, onSettings);
    return () => {
      i18n.off("languageChanged", onLanguage);
      window.removeEventListener(PLUGIN_SETTINGS_CHANGED_EVENT, onSettings);
    };
  }, []);

  useEffect(() => {
    // A drag that starts in the shell (a resize handle, a split) must keep
    // getting pointer events when it passes over a frame. A real drag and
    // drop still reaches the frame once it starts.
    const body = document.body;
    const start = (event: PointerEvent) => {
      if (event.button !== 0) return;
      body.classList.add("termix-frames-inert");
    };
    const end = () => body.classList.remove("termix-frames-inert");
    window.addEventListener("pointerdown", start, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    window.addEventListener("dragstart", end, true);
    window.addEventListener("blur", end);
    return () => {
      window.removeEventListener("pointerdown", start, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      window.removeEventListener("dragstart", end, true);
      window.removeEventListener("blur", end);
      end();
    };
  }, []);

  return null;
}
