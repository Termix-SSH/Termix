import { useCallback, useEffect, useMemo, useState } from "react";
import { isElectron } from "@/lib/electron";
import { readStatusColorScheme } from "@/hooks/use-status-color-scheme";
import { enabledHostProtocols } from "@/sidebar/host-protocols";
import { useHostActions } from "@/sidebar/host-contributions";
import { tabTypeForActivity, useTabTypes } from "@/shell/tab-registry";
import { getExtension, useExtensions } from "./extension-registry";
import { useTranslation as useI18nTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  __setPluginHost,
  type ExtensionContribution,
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
import { getCookie, getUserInfo, setCookie } from "@/main-axios";
import { logActivity } from "@/api/dashboard-api";
import { getCredentials, getHostPassword } from "@/api/credentials-api";
import { getSSHHosts } from "@/api/ssh-host-management-api";
import {
  getUserPreferences,
  parseCustomKeybindings,
  patchOpenTab,
} from "@/api/open-tabs-api";
import { runKeybindingAction } from "@/shell/keybinding-registry";
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
 * the browser bundle. A plugin's own namespace is covered by knownPluginIds()
 * below.
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

/** Both host shapes the shell holds: its own list and the API's. */
type ShellHost = Omit<Partial<PluginHostRecord>, "id" | "parentHostId"> & {
  id: string | number;
  parentHostId?: string | number | null;
};

/**
 * The shell's host as the SDK types it. Copied field by field, so a core
 * field reaches plugins only once it is part of PluginHostRecord.
 */
export function toHostRecord(host: ShellHost): PluginHostRecord {
  return {
    id: String(host.id),
    name: host.name ?? "",
    ip: host.ip ?? "",
    port: host.port,
    username: host.username,
    folder: host.folder,
    tags: host.tags,
    pin: host.pin,
    notes: host.notes,
    syncId: host.syncId,
    parentHostId: host.parentHostId == null ? null : String(host.parentHostId),
    authType: host.authType,
    credentialId: host.credentialId,
    overrideCredentialUsername: host.overrideCredentialUsername,
    connectionType: host.connectionType,
    connectionOrigin: host.connectionOrigin,
    enableSsh: host.enableSsh,
    sshPort: host.sshPort,
    jumpHosts: host.jumpHosts?.map((jump) => ({ hostId: jump.hostId })),
    statusCheckEnabled: host.statusCheckEnabled,
    statusCheckInterval: host.statusCheckInterval,
    sshOptions: host.sshOptions,
    pluginSettings: host.pluginSettings,
    protocolAuth: host.protocolAuth,
    quickConnectLogin: host.quickConnectLogin,
    quickConnectSavable: host.quickConnectSavable,
    instanceId: host.instanceId,
    status: host.status,
    online: host.online,
    isShared: host.isShared,
    permissionLevel: host.permissionLevel,
    sharedExpiresAt: host.sharedExpiresAt,
    ownerUsername: host.ownerUsername,
    authOverrides: host.authOverrides,
    sharedCopy: host.sharedCopy,
    localOnly: host.localOnly,
  };
}

/** The host as one plugin sees it: only that plugin's settings. */
export function toPluginHostRecord(
  host: ShellHost,
  pluginId: string | null,
): PluginHostRecord {
  const record = toHostRecord(host);
  const own = pluginId ? host.pluginSettings?.[pluginId] : undefined;
  record.pluginSettings = own && pluginId ? { [pluginId]: own } : {};
  return record;
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
    const pluginId = usePluginScope();
    const { hosts } = useShellHosts();
    return useMemo(() => {
      if (hostId === undefined || hostId === null) return null;
      const found = hosts.find((host) => host.id === String(hostId));
      return found ? toPluginHostRecord(found, pluginId) : null;
    }, [hosts, hostId, pluginId]);
  },

  useHosts() {
    const pluginId = usePluginScope();
    const { hosts, loaded } = useShellHosts();
    return useMemo(
      () => ({
        hosts: hosts.map((host) => toPluginHostRecord(host, pluginId)),
        loaded,
      }),
      [hosts, loaded, pluginId],
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
          quickConnect: option.quickConnect === true,
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

  useExtensions: (pointId) => useExtensions(pointId) as ExtensionContribution[],
  getExtension: (pointId, id) =>
    getExtension(pointId, id) as ExtensionContribution | undefined,

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
    runKeybindingAction: (action, context) =>
      runKeybindingAction(action, context),
    getClientPreference: (name) => getCookie(name),
    setClientPreference: (name, value) => {
      void setCookie(name, value, 365);
    },
    listHosts: async (pluginId) =>
      (await getSSHHosts({ includeStatus: false })).map((host) =>
        toPluginHostRecord(host, pluginId ?? null),
      ),
    notifyHostsChanged: () => {
      window.dispatchEvent(new CustomEvent("termix:hosts-changed"));
    },
    getHostStatusColorScheme: () => readStatusColorScheme(),
    getLocalAuthToken: () => {
      if (!isElectron()) return null;
      try {
        return localStorage.getItem("jwt");
      } catch {
        return null;
      }
    },
    listCredentials: async () => {
      const raw = await getCredentials();
      const list = Array.isArray(raw)
        ? raw
        : ((raw as { credentials?: unknown[] }).credentials ?? []);
      return (list as Record<string, unknown>[]).map((c) => ({
        id: Number(c.id),
        name: String(c.name ?? ""),
        username: typeof c.username === "string" ? c.username : undefined,
        authType: typeof c.authType === "string" ? c.authType : undefined,
      }));
    },
  },
};

/** Installs the bridge. Idempotent. */
export function installPluginHostBridge(): void {
  __setPluginHost(pluginHostBridge);
}
