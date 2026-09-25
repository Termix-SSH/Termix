import { useCallback, useEffect, useMemo, useState } from "react";
import { enabledHostProtocols } from "@/sidebar/host-protocols";
import { useHostActions } from "@/sidebar/host-contributions";
import { tabTypeForActivity, useTabTypes } from "@/shell/tab-registry";
import {
  getHomepageWidgetType,
  useHomepageWidgetTypes,
} from "./homepage-widget-registry";
import { useTranslation as useI18nTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  __setPluginHost,
  type HomepageWidgetContribution,
  type HostActionContribution,
  type PluginHostBridge,
  type PluginHostRecord,
  type SettingsScope,
  type SettingsState,
} from "@termix/plugin-sdk/frontend";
import { usePermissions } from "@/hooks/use-permissions";
import { useTheme } from "@/components/theme-provider";
import { createPluginApi, pluginApiFor } from "@/lib/plugin-transport";
import {
  getPluginAdminSettings,
  getPluginHostSettings,
  getPluginUserSettings,
  updatePluginAdminSettings,
  updatePluginHostSettings,
  updatePluginUserSettings,
} from "@/api/plugins-api";
import { getCookie, getUserInfo } from "@/main-axios";
import { logActivity } from "@/api/dashboard-api";
import { getHostPassword } from "@/api/credentials-api";
import {
  getUserPreferences,
  parseCustomKeybindings,
  patchOpenTab,
} from "@/api/open-tabs-api";
import { setHostAutoTmux } from "@/api/host-terminal-config-api";
import { usePluginScope } from "./scope";
import { knownPluginIds, usePluginStore } from "./plugin-store";
import { useUiPreferencesContext } from "@/contexts/UiPreferencesContext";
import type { UiPluginPresets } from "@/types/ui-preferences";
import { tabsApi, useShellHosts } from "./shell-bridge";
import { invokeAction } from "@/shell/action-registry";
import { useSshAuthProviders } from "@/hooks/useSshAuthProviders";
import { useActionSlot } from "@/hooks/use-action-slot";
import { usePluginComponent } from "./component-registry";
import { useOptionalHostStatusEntry } from "@/lib/ServerStatusContext";

/**
 * Core permission groups, mirroring RESERVED_PERMISSION_PREFIXES in the SDK
 * manifest module, which is not imported here because it pulls semver into
 * the browser bundle. A group that is itself a plugin id (snippets, once)
 * does not need an entry here: knownPluginIds() below already covers it.
 */
const CORE_PERMISSION_GROUPS = ["hosts", "credentials", "admin"];

/**
 * Resolves a permission the way the backend's ctx.rbac does: a short name
 * belongs to the plugin, while a full id in a core group or another plugin's
 * namespace is taken as given.
 */
export function resolvePluginPermission(
  pluginId: string,
  permission: string,
): string {
  if (permission.startsWith(`${pluginId}.`)) return permission;
  const head = permission.split(".")[0];
  if (
    permission.includes(".") &&
    (CORE_PERMISSION_GROUPS.includes(head) ||
      (head !== pluginId && knownPluginIds().includes(head)))
  ) {
    return permission;
  }
  return `${pluginId}.${permission}`;
}

const apiClients = new Map<string, ReturnType<typeof createPluginApi>>();

/** Test seam: renderWithApp's `api` option stands in for the real client. */
export function setPluginApiForTesting(
  pluginId: string,
  client: ReturnType<typeof createPluginApi> | null,
): void {
  if (client) apiClients.set(pluginId, client);
  else apiClients.delete(pluginId);
}

function getApi(pluginId: string) {
  let client = apiClients.get(pluginId);
  if (!client) {
    client = createPluginApi(pluginId);
    apiClients.set(pluginId, client);
  }
  return client;
}

let currentUser: Promise<{
  userId: string;
  username: string;
  isAdmin: boolean;
} | null> | null = null;

function loadCurrentUser() {
  if (!currentUser) {
    currentUser = getUserInfo()
      .then((info) => ({
        userId: info.userId,
        username: info.username,
        isAdmin: !!info.is_admin,
      }))
      .catch(() => {
        currentUser = null;
        return null;
      });
  }
  return currentUser;
}

/** Forgets the cached user, on logout. */
export function resetBridgeUser(): void {
  currentUser = null;
}

const SETTINGS_READERS: Record<
  SettingsScope,
  (pluginId: string, hostId?: number) => Promise<Record<string, unknown>>
> = {
  admin: (pluginId) => getPluginAdminSettings(pluginId),
  user: (pluginId) => getPluginUserSettings(pluginId),
  host: (pluginId, hostId) => getPluginHostSettings(pluginId, hostId!),
};

const SETTINGS_WRITERS: Record<
  SettingsScope,
  (
    pluginId: string,
    values: Record<string, unknown>,
    hostId?: number,
  ) => Promise<Record<string, unknown>>
> = {
  admin: (pluginId, values) => updatePluginAdminSettings(pluginId, values),
  user: (pluginId, values) => updatePluginUserSettings(pluginId, values),
  host: (pluginId, values, hostId) =>
    updatePluginHostSettings(pluginId, hostId!, values),
};

function toHostRecord(host: unknown): PluginHostRecord {
  return host as PluginHostRecord;
}

export const pluginHostBridge: PluginHostBridge = {
  usePluginId() {
    const pluginId = usePluginScope();
    if (!pluginId) {
      throw new Error(
        "SDK hooks can only be used inside a component a plugin registered",
      );
    }
    return pluginId;
  },

  useTranslation(pluginId) {
    const { t, i18n } = useI18nTranslation(pluginId);
    return {
      t: t as unknown as (
        key: string,
        options?: Record<string, unknown> | string,
      ) => string,
      language: i18n.language,
    };
  },

  usePermission(pluginId, permission) {
    const { has, loaded } = usePermissions();
    return loaded && has(resolvePluginPermission(pluginId, permission));
  },

  useSettings(pluginId, scope, hostId) {
    const numericHostId =
      hostId === undefined ? undefined : Number.parseInt(String(hostId), 10);
    const [state, setState] = useState<{
      values: Record<string, unknown>;
      loaded: boolean;
    }>({ values: {}, loaded: false });

    useEffect(() => {
      let cancelled = false;
      if (scope === "host" && !Number.isFinite(numericHostId)) return;
      SETTINGS_READERS[scope](pluginId, numericHostId)
        .then((values) => {
          if (!cancelled) setState({ values, loaded: true });
        })
        .catch(() => {
          if (!cancelled) setState((prev) => ({ ...prev, loaded: true }));
        });
      return () => {
        cancelled = true;
      };
    }, [pluginId, scope, numericHostId]);

    const save = useCallback(
      async (values: Record<string, unknown>) => {
        const saved = await SETTINGS_WRITERS[scope](
          pluginId,
          values,
          numericHostId,
        );
        setState({ values: saved, loaded: true });
      },
      [pluginId, scope, numericHostId],
    );

    return useMemo<SettingsState>(() => ({ ...state, save }), [state, save]);
  },

  useHost(hostId) {
    const { hosts } = useShellHosts();
    return useMemo(() => {
      if (hostId === undefined || hostId === null) return null;
      const found = hosts.find((host) => host.id === String(hostId));
      return found ? toHostRecord(found) : null;
    }, [hosts, hostId]);
  },

  useHosts() {
    const { hosts, loaded } = useShellHosts();
    return useMemo(
      () => ({ hosts: hosts.map(toHostRecord), loaded }),
      [hosts, loaded],
    );
  },

  useCurrentUser() {
    const [user, setUser] = useState<{
      userId: string;
      username: string;
      isAdmin: boolean;
    } | null>(null);
    useEffect(() => {
      let cancelled = false;
      loadCurrentUser().then((next) => {
        if (!cancelled) setUser(next);
      });
      return () => {
        cancelled = true;
      };
    }, []);
    return user;
  },

  useTheme() {
    const { theme } = useTheme();
    if (theme === "light") return { theme: "light" };
    if ((theme as string) === "system" && typeof window !== "undefined") {
      return {
        theme: window.matchMedia?.("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark",
      };
    }
    return { theme: "dark" };
  },

  toast: {
    success: (message) => toast.success(message),
    error: (message) => toast.error(message),
    info: (message) => toast.info(message),
    warning: (message) => toast.warning(message),
  },

  getApi: (pluginId) => getApi(pluginId),
  getApiFor: (pluginId, origin) =>
    pluginApiFor(
      pluginId,
      origin as "local" | "remote" | undefined,
      getApi(pluginId) as never,
    ) as never,

  useTabs: () => tabsApi,

  invokeAction: (id, ...args) => invokeAction(id, ...args),

  useSshAuthTypes: () => {
    const { providers, loaded } = useSshAuthProviders();
    return {
      loaded,
      types: providers
        .filter((option) => option.available)
        .map((option) => ({
          type: option.type,
          labelKey: option.editorTitleKey ?? option.labelKey,
          pluginId: option.pluginId,
          credentialType: option.credentialType,
          supportsBackground: option.supportsBackground,
        })),
    };
  },

  useSlotContributions: (slotId, context) => useActionSlot(slotId, context),

  hostProtocols: (record) => [
    ...(record.enableSsh !== false ? ["ssh"] : []),
    ...enabledHostProtocols(
      record as { pluginSettings?: Record<string, Record<string, unknown>> },
    ).map((protocol) => protocol.id),
  ],

  usePluginComponent: (id) => usePluginComponent(id),

  useHostStatus: (hostId) => {
    const entry = useOptionalHostStatusEntry(hostId);
    if (!entry) return null;
    return {
      status: entry.status === "degraded" ? "unknown" : entry.status,
      ...(entry.reason ? { reason: entry.reason } : {}),
    };
  },

  useHostActions: () => useHostActions() as unknown as HostActionContribution[],

  useActivityTypes: () => {
    const defs = useTabTypes();
    const types = new Set<string>();
    for (const def of defs) {
      for (const type of def.activityTypes ?? []) types.add(type);
    }
    return [...types];
  },

  activityTarget: (type) => {
    const def = tabTypeForActivity(type);
    if (!def) return undefined;
    return { icon: def.icon, tab: def.id, titleKey: def.titleKey };
  },

  useHomepageWidgetTypes: () =>
    useHomepageWidgetTypes() as unknown as HomepageWidgetContribution[],
  homepageWidgetType: (id) =>
    getHomepageWidgetType(id) as unknown as
      HomepageWidgetContribution | undefined,

  usePluginUiPreferences: (pluginId) => {
    const ctx = useUiPreferencesContext();
    const store = usePluginStore();
    const presets = store.records.get(pluginId)?.summary.contributes
      ?.uiPresets as UiPluginPresets | undefined;
    const values = ctx
      ? ctx.resolvePlugin(pluginId, presets)
      : { ...(presets?.balanced ?? {}) };
    return {
      values,
      set: (key, value) => ctx?.setPluginOverride(pluginId, key, value),
    };
  },

  core: {
    logActivity: async (type, hostId, hostName) => {
      await logActivity(type, hostId, hostName);
    },
    getHostPassword: async (hostId, field) =>
      (await getHostPassword(hostId, field)) ?? null,
    patchOpenTab: (instanceId, updates) => patchOpenTab(instanceId, updates),
    getCustomKeybindings: async () =>
      parseCustomKeybindings((await getUserPreferences()).customKeybindings),
    setHostAutoTmux: (hostId, autoTmux) => setHostAutoTmux(hostId, autoTmux),
    getClientPreference: (name) => getCookie(name),
  },
};

/** Installs the bridge. Idempotent. */
export function installPluginHostBridge(): void {
  __setPluginHost(pluginHostBridge);
}
