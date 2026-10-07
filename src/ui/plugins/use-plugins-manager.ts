import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import semver from "semver";
import {
  DEVELOPER_MODE_CHANGED_EVENT,
  deletePluginData,
  getDeveloperMode,
  getPluginRegistry,
  getPlugins,
  installPlugin,
  installUploadedPlugin,
  previewPluginState,
  retryPlugin,
  setAllPluginChannels,
  setPluginOptions,
  setPluginState,
  uninstallPlugin,
  updateAllPlugins,
  updatePlugin,
  uploadPlugin,
  type DeveloperModeState,
  type PluginChannel,
  type PluginSummary,
  type RegistryListing,
} from "@/api/plugins-api";
import { useConfirm } from "@/components/surface/surface-scope";
import { mergePlugins, uploadEntry, type PluginEntry } from "./plugin-model";
import type { ConsentRequest } from "./PluginConsentPrompt";

interface ApiError {
  message: string;
  code?: string;
  data: Record<string, unknown>;
}

function readError(error: unknown, fallback: string): ApiError {
  const data = (error as { response?: { data?: Record<string, unknown> } })
    ?.response?.data;
  if (data && typeof data === "object") {
    return {
      message: typeof data.error === "string" ? data.error : fallback,
      code: typeof data.code === "string" ? data.code : undefined,
      data,
    };
  }
  return {
    message: error instanceof Error ? error.message : fallback,
    data: {},
  };
}

export function usePluginsManager() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [installed, setInstalled] = useState<PluginSummary[]>([]);
  const [registry, setRegistry] = useState<RegistryListing | null>(null);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [consent, setConsent] = useState<ConsentRequest | null>(null);
  const [developer, setDeveloper] = useState<DeveloperModeState>({
    enabled: false,
    signedOnly: false,
  });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    const [plugins, listing, devMode] = await Promise.allSettled([
      getPlugins(),
      getPluginRegistry(refresh),
      getDeveloperMode(),
    ]);
    if (!mounted.current) return;
    if (plugins.status === "fulfilled") setInstalled(plugins.value);
    if (devMode.status === "fulfilled") setDeveloper(devMode.value);
    if (listing.status === "fulfilled") {
      setRegistry(listing.value);
      setRegistryError(listing.value.registry.error);
    } else {
      setRegistryError(readError(listing.reason, "").message || "unreachable");
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The switch lives in admin settings, which may change while this is open.
  useEffect(() => {
    const onChange = (event: Event) => {
      const enabled = (event as CustomEvent<boolean>).detail;
      if (typeof enabled !== "boolean") return;
      setDeveloper((current) => ({ ...current, enabled }));
    };
    window.addEventListener(DEVELOPER_MODE_CHANGED_EVENT, onChange);
    return () =>
      window.removeEventListener(DEVELOPER_MODE_CHANGED_EVENT, onChange);
  }, []);

  const plugins = useMemo(
    () => mergePlugins(installed, registry?.plugins ?? null),
    [installed, registry],
  );

  const run = useCallback(
    async (id: string, action: () => Promise<void>) => {
      setBusy((current) => new Set(current).add(id));
      try {
        await action();
      } finally {
        if (mounted.current) {
          setBusy((current) => {
            const next = new Set(current);
            next.delete(id);
            return next;
          });
        }
        await load();
      }
    },
    [load],
  );

  const failToast = useCallback(
    (error: unknown, key: string, name: string) => {
      const info = readError(error, t("plugins.manager.errors.generic"));
      if (info.code === "MANAGED_BY_SERVER") {
        toast.error(t("plugins.manager.errors.managedByServer"));
      } else if (info.code === "HAS_DEPENDENTS") {
        toast.error(
          t("plugins.manager.errors.hasDependents", {
            name,
            list: ((info.data.dependents as string[]) ?? []).join(", "),
          }),
        );
      } else if (info.code === "MISSING_DEPENDENCIES") {
        toast.error(
          t("plugins.manager.errors.missingDependencies", {
            name,
            list: ((info.data.missing as string[]) ?? []).join(", "),
          }),
        );
      } else {
        toast.error(t(key, { name, error: info.message }));
      }
    },
    [t],
  );

  const versionCapabilities = (plugin: PluginEntry, version: string) =>
    plugin.versions.find((v) => v.version === version)?.capabilities ?? [];

  const requestInstall = useCallback(
    (plugin: PluginEntry, version?: string) => {
      const target = version ?? plugin.latestVersion;
      if (!target) return;
      setConsent({
        plugin,
        mode: "install",
        version: target,
        capabilities: versionCapabilities(plugin, target),
      });
    },
    [],
  );

  const doInstall = useCallback(
    (plugin: PluginEntry, version: string, capabilities: string[]) =>
      run(plugin.id, async () => {
        try {
          const result = await installPlugin(plugin.id, {
            version: version === plugin.latestVersion ? undefined : version,
            capabilities,
          });
          if (result.state === "failed" || result.state === "blocked") {
            toast.error(
              t("plugins.manager.toast.installedNotRunning", {
                name: plugin.name,
              }),
            );
          } else {
            toast.success(
              t("plugins.manager.toast.installed", { name: plugin.name }),
            );
          }
        } catch (error) {
          const info = readError(error, "");
          if (info.code === "CONSENT_MISMATCH") {
            toast.error(t("plugins.manager.errors.consentChanged"));
            setConsent({
              plugin,
              mode: "install",
              version,
              capabilities: (info.data.capabilities as string[]) ?? [],
            });
            return;
          }
          failToast(error, "plugins.manager.errors.install", plugin.name);
        }
      }),
    [run, t, failToast],
  );

  const doUpdate = useCallback(
    (plugin: PluginEntry, version: string, accepted: string[] | null) =>
      run(plugin.id, async () => {
        try {
          await updatePlugin(plugin.id, {
            version: version === plugin.latestVersion ? undefined : version,
            acceptCapabilities: accepted !== null,
            capabilities: accepted ?? undefined,
          });
          toast.success(
            t("plugins.manager.toast.updated", {
              name: plugin.name,
              version,
            }),
          );
        } catch (error) {
          const info = readError(error, "");
          if (
            info.code === "CAPABILITIES_ADDED" ||
            info.code === "CONSENT_MISMATCH"
          ) {
            if (info.code === "CONSENT_MISMATCH") {
              toast.error(t("plugins.manager.errors.consentChanged"));
            }
            setConsent({
              plugin,
              mode: "update",
              version,
              capabilities: (info.data.capabilities as string[]) ?? [],
            });
            return;
          }
          failToast(error, "plugins.manager.errors.update", plugin.name);
        }
      }),
    [run, t, failToast],
  );

  /** Updates, or changes to another version. New capabilities ask first. */
  const requestUpdate = useCallback(
    async (plugin: PluginEntry, version?: string) => {
      const target = version ?? plugin.latestVersion;
      if (!target || !plugin.version) return;
      if (
        semver.valid(target) &&
        semver.valid(plugin.version) &&
        semver.lt(target, plugin.version)
      ) {
        const ok = await confirm({
          title: t("plugins.manager.confirm.downgradeTitle", {
            name: plugin.name,
            version: target,
          }),
          description: t("plugins.manager.confirm.downgradeBody"),
          confirmLabel: t("plugins.manager.confirm.downgradeConfirm"),
          destructive: false,
        });
        if (!ok) return;
      }
      const have = new Set(plugin.capabilities);
      const added = versionCapabilities(plugin, target).filter(
        (c) => !have.has(c),
      );
      if (added.length > 0) {
        setConsent({
          plugin,
          mode: "update",
          version: target,
          capabilities: added,
        });
        return;
      }
      await doUpdate(plugin, target, null);
    },
    [confirm, t, doUpdate],
  );

  const doInstallUpload = useCallback(
    (request: ConsentRequest) =>
      run(request.plugin.id, async () => {
        try {
          const result = await installUploadedPlugin(
            request.uploadToken!,
            request.capabilities,
          );
          if (result.state === "failed" || result.state === "blocked") {
            toast.error(
              t("plugins.manager.toast.installedNotRunning", {
                name: request.plugin.name,
              }),
            );
          } else {
            toast.success(
              t("plugins.manager.toast.installed", {
                name: request.plugin.name,
              }),
            );
          }
        } catch (error) {
          failToast(
            error,
            "plugins.manager.errors.install",
            request.plugin.name,
          );
        }
      }),
    [run, t, failToast],
  );

  /** Reads a picked .tmxplug and asks for consent before anything loads. */
  const requestUpload = useCallback(
    async (file: File) => {
      try {
        const preview = await uploadPlugin(file);
        setConsent({
          plugin: uploadEntry(preview),
          mode: "upload",
          version: preview.version,
          capabilities: preview.capabilities,
          uploadToken: preview.token,
        });
      } catch (error) {
        failToast(error, "plugins.manager.errors.upload", file.name);
      }
    },
    [failToast],
  );

  const confirmConsent = useCallback(async () => {
    if (!consent) return;
    const request = consent;
    setConsent(null);
    if (request.mode === "upload" && request.uploadToken) {
      await doInstallUpload(request);
    } else if (request.mode === "install") {
      await doInstall(request.plugin, request.version, request.capabilities);
    } else {
      await doUpdate(request.plugin, request.version, request.capabilities);
    }
  }, [consent, doInstall, doUpdate, doInstallUpload]);

  const nameOf = useCallback(
    (id: string) => plugins.find((p) => p.id === id)?.name ?? id,
    [plugins],
  );

  const toggle = useCallback(
    async (plugin: PluginEntry) => {
      const enable = !plugin.enabled;
      try {
        const preview = await previewPluginState(plugin.id, enable);
        if (enable && preview.missing.length > 0) {
          toast.error(
            t("plugins.manager.errors.missingDependencies", {
              name: plugin.name,
              list: preview.missing.join(", "),
            }),
          );
          return;
        }
        const others = enable ? preview.enable : preview.disable;
        if (others.length > 0) {
          const ok = await confirm({
            title: enable
              ? t("plugins.manager.confirm.enableAlsoTitle", {
                  name: plugin.name,
                })
              : t("plugins.manager.confirm.disableAlsoTitle", {
                  name: plugin.name,
                }),
            description: enable
              ? t("plugins.manager.confirm.enableAlsoBody", {
                  list: others.map(nameOf).join(", "),
                })
              : t("plugins.manager.confirm.disableAlsoBody", {
                  list: others.map(nameOf).join(", "),
                }),
            confirmLabel: enable
              ? t("plugins.manager.enable")
              : t("plugins.manager.disable"),
            destructive: !enable,
          });
          if (!ok) return;
        }
      } catch (error) {
        failToast(error, "plugins.manager.errors.state", plugin.name);
        return;
      }
      await run(plugin.id, async () => {
        try {
          const result = await setPluginState(plugin.id, enable);
          if (result.state === "failed" || result.state === "blocked") {
            toast.error(
              t("plugins.manager.toast.failedToStart", { name: plugin.name }),
            );
          }
        } catch (error) {
          failToast(error, "plugins.manager.errors.state", plugin.name);
        }
      });
    },
    [confirm, t, run, failToast, nameOf],
  );

  const retry = useCallback(
    (plugin: PluginEntry) =>
      run(plugin.id, async () => {
        try {
          await retryPlugin(plugin.id);
        } catch (error) {
          failToast(error, "plugins.manager.errors.retry", plugin.name);
        }
      }),
    [run, failToast],
  );

  const uninstall = useCallback(
    async (plugin: PluginEntry): Promise<boolean> => {
      const ok = await confirm({
        title: t("plugins.manager.confirm.uninstallTitle", {
          name: plugin.name,
        }),
        description: t("plugins.manager.confirm.uninstallBody"),
        confirmLabel: t("plugins.manager.uninstall"),
      });
      if (!ok) return false;
      let done = false;
      await run(plugin.id, async () => {
        try {
          await uninstallPlugin(plugin.id);
          done = true;
          toast.success(
            t("plugins.manager.toast.uninstalled", { name: plugin.name }),
          );
        } catch (error) {
          failToast(error, "plugins.manager.errors.uninstall", plugin.name);
        }
      });
      return done;
    },
    [confirm, t, run, failToast],
  );

  const removeData = useCallback(
    async (plugin: PluginEntry): Promise<boolean> => {
      const ok = await confirm({
        title: t("plugins.manager.confirm.deleteDataTitle", {
          name: plugin.name,
        }),
        description: t("plugins.manager.confirm.deleteDataBody"),
        confirmLabel: t("plugins.manager.data.delete"),
      });
      if (!ok) return false;
      let done = false;
      await run(plugin.id, async () => {
        try {
          await deletePluginData(plugin.id);
          done = true;
          toast.success(
            t("plugins.manager.toast.dataDeleted", { name: plugin.name }),
          );
        } catch (error) {
          failToast(error, "plugins.manager.errors.deleteData", plugin.name);
        }
      });
      return done;
    },
    [confirm, t, run, failToast],
  );

  const setOptions = useCallback(
    (
      plugin: PluginEntry,
      options: {
        autoUpdate?: boolean;
        pinned?: boolean;
        channel?: PluginChannel;
      },
    ) =>
      run(plugin.id, async () => {
        try {
          await setPluginOptions(plugin.id, options);
        } catch (error) {
          failToast(error, "plugins.manager.errors.options", plugin.name);
        }
      }),
    [run, failToast],
  );

  /** Moves a plugin to betas and installs the newest one. */
  const tryBeta = useCallback(
    async (plugin: PluginEntry) => {
      const version = plugin.latestBeta;
      const ok = await confirm({
        title: t("plugins.manager.beta.confirmTitle", { name: plugin.name }),
        description: t("plugins.manager.beta.confirmBody"),
        confirmLabel: version
          ? t("plugins.manager.beta.confirmInstall", { version })
          : t("plugins.manager.beta.confirmSwitch"),
        destructive: false,
      });
      if (!ok) return;
      await setOptions(plugin, { channel: "beta", pinned: false });
      if (version && version !== plugin.version) {
        await requestUpdate({ ...plugin, pinnedVersion: null }, version);
      }
    },
    [confirm, t, setOptions, requestUpdate],
  );

  /** Back to stable. An installed beta stays until stable passes it. */
  const leaveBeta = useCallback(
    async (plugin: PluginEntry) => {
      await setOptions(plugin, { channel: "stable" });
      if (plugin.isBeta) {
        toast.info(
          t("plugins.manager.beta.leftWhileOnBeta", {
            name: plugin.name,
            version: plugin.version,
          }),
        );
      }
    },
    [setOptions, t],
  );

  const setAllChannels = useCallback(
    (channel: PluginChannel) =>
      run("*", async () => {
        try {
          await setAllPluginChannels(channel);
        } catch (error) {
          failToast(error, "plugins.manager.errors.options", "");
        }
      }),
    [run, failToast],
  );

  const updateAll = useCallback(
    () =>
      run("*", async () => {
        try {
          const result = await updateAllPlugins();
          if (result.updated.length > 0) {
            toast.success(
              t("plugins.manager.toast.updatedMany", {
                count: result.updated.length,
              }),
            );
          }
          for (const failed of result.failed) {
            toast.error(
              t("plugins.manager.errors.update", {
                name: nameOf(failed.id),
                error: failed.error,
              }),
            );
          }
        } catch (error) {
          failToast(error, "plugins.manager.errors.updateAll", "");
        }
      }),
    [run, t, failToast, nameOf],
  );

  return {
    plugins,
    loading,
    refreshing,
    registryError,
    managedByServer: registry?.managedByServer ?? false,
    lastCheckedAt: registry?.registry.lastCheckedAt ?? null,
    busy,
    consent,
    setConsent,
    developerMode: developer.enabled,
    signedOnly: developer.signedOnly,
    requestUpload,
    refresh: () => load(true),
    requestInstall,
    requestUpdate,
    confirmConsent,
    toggle,
    retry,
    uninstall,
    removeData,
    setOptions,
    tryBeta,
    leaveBeta,
    setAllChannels,
    updateAll,
  };
}

export type PluginsManager = ReturnType<typeof usePluginsManager>;
