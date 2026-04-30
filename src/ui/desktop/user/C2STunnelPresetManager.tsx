import React from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { TunnelInlineControls } from "@/ui/desktop/apps/features/tunnel/TunnelInlineControls.tsx";
import { TunnelModeSelector } from "@/ui/desktop/apps/features/tunnel/TunnelModeSelector.tsx";
import {
  getTunnelModeDescription,
  getTunnelPortLabels,
  getTunnelTypeForMode,
} from "@/ui/desktop/apps/features/tunnel/tunnel-form-utils.ts";
import {
  createC2STunnelPreset,
  deleteC2STunnelPreset,
  getC2STunnelPresets,
  getSSHHosts,
  updateC2STunnelPreset,
} from "@/ui/main-axios.ts";
import type {
  C2STunnelPreset,
  SSHHost,
  TunnelConnection,
  TunnelStatus,
} from "@/types/index.js";
import { Activity, Download, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

type ClientTunnel = TunnelConnection & {
  bindHost: string;
  sourceHostId?: number;
  sourceHostName?: string;
  displayName?: string;
  lastStartedAt?: string;
  lastTestedAt?: string;
  lastError?: string;
};

function sortPresets(presets: C2STunnelPreset[]) {
  return [...presets].sort((a, b) => a.name.localeCompare(b.name));
}

function sameConfig(a: TunnelConnection[], b: TunnelConnection[]) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isValidIPv4(value: string) {
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => {
      if (!/^\d+$/.test(part)) return false;
      const value = Number(part);
      return value >= 0 && value <= 255;
    })
  );
}

function isValidPort(value: unknown) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function getEffectiveBindHost(bindHost?: string) {
  const trimmedBindHost = bindHost?.trim();
  return trimmedBindHost || "127.0.0.1";
}

function getTunnelMode(tunnel: Partial<TunnelConnection>) {
  return tunnel.mode || tunnel.tunnelType || "local";
}

function formatDateTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function createClientTunnel(): ClientTunnel {
  return {
    scope: "c2s",
    mode: "local",
    tunnelType: "local",
    bindHost: "",
    sourcePort: 8080,
    endpointPort: 22,
    endpointHost: "",
    maxRetries: 3,
    retryInterval: 10,
    autoStart: false,
  };
}

function normalizeClientTunnel(
  tunnel: Partial<TunnelConnection>,
): ClientTunnel {
  const mode = getTunnelMode(tunnel);
  const metadata = tunnel as Partial<ClientTunnel>;

  return {
    ...tunnel,
    scope: "c2s",
    mode,
    tunnelType: mode === "dynamic" ? "local" : mode,
    bindHost: tunnel.bindHost?.trim() || "",
    sourcePort: Number(tunnel.sourcePort) || 8080,
    endpointPort: Number(tunnel.endpointPort) || 22,
    endpointHost: tunnel.endpointHost || tunnel.sourceHostName || "",
    maxRetries: Number(tunnel.maxRetries) || 3,
    retryInterval: Number(tunnel.retryInterval) || 10,
    autoStart: Boolean(tunnel.autoStart),
    displayName: metadata.displayName?.trim() || "",
    lastStartedAt: metadata.lastStartedAt,
    lastTestedAt: metadata.lastTestedAt,
    lastError: metadata.lastError,
  };
}

function stripClientTunnelDiagnostics(tunnel: ClientTunnel): TunnelConnection {
  const presetTunnel = normalizeClientTunnel(tunnel);
  delete presetTunnel.lastStartedAt;
  delete presetTunnel.lastTestedAt;
  delete presetTunnel.lastError;

  return presetTunnel;
}

export function C2STunnelPresetManager(): React.ReactElement {
  const { t } = useTranslation();
  const [localConfig, setLocalConfig] = React.useState<ClientTunnel[]>([]);
  const [savedLocalConfig, setSavedLocalConfig] = React.useState<
    ClientTunnel[]
  >([]);
  const [hosts, setHosts] = React.useState<SSHHost[]>([]);
  const [presets, setPresets] = React.useState<C2STunnelPreset[]>([]);
  const [tunnelStatuses, setTunnelStatuses] = React.useState<
    Record<string, TunnelStatus>
  >({});
  const [tunnelActions, setTunnelActions] = React.useState<
    Record<string, boolean>
  >({});
  const [tunnelTests, setTunnelTests] = React.useState<Record<string, boolean>>(
    {},
  );
  const previousTunnelStatusesRef = React.useRef<Record<string, TunnelStatus>>(
    {},
  );
  const [selectedPresetId, setSelectedPresetId] = React.useState("");
  const [presetName, setPresetName] = React.useState("");
  const isElectron =
    typeof window !== "undefined" && window.electronAPI?.isElectron === true;

  const sshHosts = React.useMemo(
    () =>
      hosts.filter(
        (host) => host.id && (host.connectionType || "ssh") === "ssh",
      ),
    [hosts],
  );

  const selectedPreset = React.useMemo(
    () =>
      presets.find((preset) => String(preset.id) === selectedPresetId) || null,
    [presets, selectedPresetId],
  );
  const selectedMatchesCurrent = React.useMemo(() => {
    return selectedPreset
      ? sameConfig(
          selectedPreset.config.map(normalizeClientTunnel),
          localConfig.map(stripClientTunnelDiagnostics),
        )
      : false;
  }, [localConfig, selectedPreset]);
  const hasUnsavedLocalChanges = React.useMemo(
    () => !sameConfig(savedLocalConfig, localConfig),
    [savedLocalConfig, localConfig],
  );
  const hasPresets = presets.length > 0;

  const getTunnelName = React.useCallback(
    (tunnel: ClientTunnel, index: number) =>
      [
        "c2s",
        index,
        tunnel.sourceHostId || 0,
        tunnel.mode || tunnel.tunnelType || "local",
        getEffectiveBindHost(tunnel.bindHost),
        tunnel.sourcePort,
        tunnel.endpointPort || 0,
      ].join("::"),
    [],
  );

  const getEndpointName = React.useCallback(
    (tunnel: ClientTunnel) => {
      const host = sshHosts.find((item) => item.id === tunnel.sourceHostId);
      return (
        tunnel.sourceHostName ||
        host?.name ||
        tunnel.endpointHost ||
        t("tunnels.endpointSshHost")
      );
    },
    [sshHosts, t],
  );

  const getTunnelDisplayName = React.useCallback(
    (tunnel: ClientTunnel, index: number) => {
      if (tunnel.displayName?.trim()) return tunnel.displayName.trim();

      const mode = getTunnelMode(tunnel);
      const endpointName = getEndpointName(tunnel);
      if (mode === "remote") {
        return t("tunnels.autoNameClientRemote", {
          endpoint: endpointName,
          remotePort: tunnel.sourcePort,
          localPort: tunnel.endpointPort,
        });
      }
      if (mode === "dynamic") {
        return t("tunnels.autoNameClientDynamic", {
          localPort: tunnel.sourcePort,
          endpoint: endpointName,
        });
      }
      return t("tunnels.autoNameClientLocal", {
        localPort: tunnel.sourcePort,
        endpoint: endpointName,
        remotePort: tunnel.endpointPort,
        index: index + 1,
      });
    },
    [getEndpointName, t],
  );

  const getBindPlaceholder = React.useCallback(
    (mode: string) => {
      if (mode === "remote") return t("placeholders.localTargetHost");
      if (mode === "dynamic") return t("placeholders.socksListenerHost");
      return t("placeholders.localListenerHost");
    },
    [t],
  );

  const getTunnelSummary = React.useCallback(
    (tunnel: ClientTunnel) => {
      const mode = getTunnelMode(tunnel);
      const bindHost = getEffectiveBindHost(tunnel.bindHost);
      const endpointName = getEndpointName(tunnel);

      if (mode === "remote") {
        return t("tunnels.summaryClientRemote", {
          endpoint: endpointName,
          remotePort: tunnel.sourcePort,
          localHost: bindHost,
          localPort: tunnel.endpointPort,
        });
      }
      if (mode === "dynamic") {
        return t("tunnels.summaryClientDynamic", {
          localHost: bindHost,
          localPort: tunnel.sourcePort,
          endpoint: endpointName,
        });
      }
      return t("tunnels.summaryClientLocal", {
        localHost: bindHost,
        localPort: tunnel.sourcePort,
        endpoint: endpointName,
        remotePort: tunnel.endpointPort,
      });
    },
    [getEndpointName, t],
  );

  const refreshPresets = React.useCallback(async () => {
    const nextPresets = await getC2STunnelPresets();
    setPresets(sortPresets(nextPresets));
  }, []);

  const refreshLocalConfig = React.useCallback(async () => {
    if (!isElectron) return;

    const [config, defaultName, nextHosts] = await Promise.all([
      window.electronAPI.getC2STunnelConfig(),
      window.electronAPI.getC2STunnelPresetDefaultName(),
      getSSHHosts(),
    ]);
    setHosts(nextHosts);
    const normalizedConfig = Array.isArray(config)
      ? (config as TunnelConnection[])
          .filter((tunnel) => tunnel.scope === "c2s")
          .map(normalizeClientTunnel)
      : [];
    setLocalConfig(normalizedConfig);
    setSavedLocalConfig(normalizedConfig);
    setPresetName((current) => current || defaultName);
  }, [isElectron]);

  React.useEffect(() => {
    if (!isElectron) return;

    Promise.all([refreshLocalConfig(), refreshPresets()]).catch(() => {
      setPresets([]);
    });
  }, [isElectron, refreshLocalConfig, refreshPresets]);

  React.useEffect(() => {
    if (!isElectron) return;

    const refreshStatuses = async () => {
      const statuses = await window.electronAPI.getC2STunnelStatuses();
      setTunnelStatuses(statuses as Record<string, TunnelStatus>);
    };

    refreshStatuses().catch(() => {});
    const unsubscribe = window.electronAPI.onC2STunnelStatuses?.((statuses) => {
      setTunnelStatuses(statuses as Record<string, TunnelStatus>);
    });

    return () => unsubscribe?.();
  }, [isElectron]);

  React.useEffect(() => {
    const previousStatuses = previousTunnelStatusesRef.current;

    for (const [tunnelName, status] of Object.entries(tunnelStatuses)) {
      const previous = previousStatuses[tunnelName];
      const statusChanged =
        previous?.status !== status.status ||
        previous?.reason !== status.reason ||
        previous?.retryCount !== status.retryCount;

      if (!statusChanged) continue;

      console.info("[tunnels] Client tunnel status changed", {
        tunnelName,
        status,
      });

      const statusValue = status.status?.toUpperCase();
      const hasFailureDetail =
        statusValue === "ERROR" ||
        statusValue === "FAILED" ||
        (Boolean(status.errorType) &&
          Boolean(status.reason) &&
          previous?.reason !== status.reason);

      if (hasFailureDetail) {
        const message = status.reason || t("tunnels.manualControlError");
        console.error("[tunnels] Client tunnel failed", {
          tunnelName,
          status,
        });
        toast.error(message, {
          id: `client-tunnel-error-${tunnelName}`,
        });
      }
    }

    previousTunnelStatusesRef.current = tunnelStatuses;
  }, [t, tunnelStatuses]);

  const validateLocalConfig = (config: ClientTunnel[]) => {
    const autoStartListeners = new Set<string>();

    for (const tunnel of config) {
      const bindHost = getEffectiveBindHost(tunnel.bindHost);
      const mode = getTunnelMode(tunnel);

      if (!isValidIPv4(bindHost)) {
        return mode === "remote"
          ? t("tunnels.invalidLocalTargetIp")
          : t("tunnels.invalidBindIp");
      }
      if (!isValidPort(tunnel.sourcePort)) {
        return mode === "remote"
          ? t("tunnels.invalidRemotePort")
          : t("tunnels.invalidLocalPort");
      }
      if (mode !== "dynamic" && !isValidPort(tunnel.endpointPort)) {
        return mode === "remote"
          ? t("tunnels.invalidLocalTargetPort")
          : t("tunnels.invalidEndpointPort");
      }
      if (!tunnel.sourceHostId) {
        return t("tunnels.endpointSshHostRequired");
      }
      if (tunnel.autoStart) {
        const listenerKey =
          mode === "remote"
            ? `${tunnel.sourceHostId}:${tunnel.sourcePort}`
            : `${bindHost}:${tunnel.sourcePort}`;
        if (autoStartListeners.has(listenerKey)) {
          return t("tunnels.duplicateAutoStartBind", {
            bind:
              mode === "remote"
                ? `${tunnel.sourceHostName || tunnel.sourceHostId}:${tunnel.sourcePort}`
                : listenerKey,
          });
        }
        autoStartListeners.add(listenerKey);
      }
    }

    return null;
  };

  const saveLocalConfig = async (config: ClientTunnel[]) => {
    const normalizedConfig = config.map(normalizeClientTunnel);
    const validationError = validateLocalConfig(normalizedConfig);
    if (validationError) {
      throw new Error(validationError);
    }

    const result =
      await window.electronAPI.saveC2STunnelConfig(normalizedConfig);
    if (!result.success) {
      throw new Error(result.error || t("tunnels.localSaveError"));
    }
    setLocalConfig(normalizedConfig);
    setSavedLocalConfig(normalizedConfig);
  };

  const updateTunnel = (
    index: number,
    updates: Partial<ClientTunnel>,
  ): void => {
    setLocalConfig((current) =>
      current.map((tunnel, tunnelIndex) =>
        tunnelIndex === index
          ? normalizeClientTunnel({ ...tunnel, ...updates })
          : tunnel,
      ),
    );
  };

  const handleEndpointChange = (index: number, hostId: string) => {
    const host = sshHosts.find((item) => String(item.id) === hostId);
    if (!host) return;

    updateTunnel(index, {
      sourceHostId: host.id,
      sourceHostName: host.name,
      endpointHost: host.name,
      endpointPort: 22,
    });
  };

  const handleSaveLocal = async () => {
    try {
      await saveLocalConfig(localConfig);
      toast.success(t("tunnels.localSaved"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("tunnels.localSaveError"),
      );
    }
  };

  const setTunnelMetadata = (
    index: number,
    updates: Partial<ClientTunnel>,
  ): void => {
    setLocalConfig((current) =>
      current.map((tunnel, tunnelIndex) =>
        tunnelIndex === index
          ? normalizeClientTunnel({ ...tunnel, ...updates })
          : tunnel,
      ),
    );
  };

  const handleTunnelTest = async (tunnel: ClientTunnel, index: number) => {
    const tunnelName = getTunnelName(tunnel, index);
    const normalizedTunnel = {
      ...normalizeClientTunnel(tunnel),
      name: tunnelName,
    };
    const validationError = validateLocalConfig([normalizedTunnel]);
    if (validationError) {
      toast.error(validationError);
      setTunnelMetadata(index, { lastError: validationError });
      return;
    }

    setTunnelTests((current) => ({ ...current, [tunnelName]: true }));
    console.info("[tunnels] Testing client tunnel", {
      tunnelName,
      tunnel: normalizedTunnel,
    });

    try {
      const result = await window.electronAPI.testC2STunnel(
        normalizedTunnel,
        index,
      );
      if (!result.success) {
        throw new Error(result.error || t("tunnels.tunnelTestFailed"));
      }

      setTunnelMetadata(index, {
        lastTestedAt: new Date().toISOString(),
        lastError: "",
      });
      toast.success(t("tunnels.tunnelTestSucceeded"));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("tunnels.tunnelTestFailed");
      console.error("[tunnels] Client tunnel test failed", {
        tunnelName,
        error,
      });
      setTunnelMetadata(index, { lastError: message });
      toast.error(message);
    } finally {
      setTunnelTests((current) => ({ ...current, [tunnelName]: false }));
    }
  };

  const handleTunnelStart = async (tunnel: ClientTunnel, index: number) => {
    const tunnelName = getTunnelName(tunnel, index);
    const normalizedTunnel = {
      ...normalizeClientTunnel(tunnel),
      name: tunnelName,
    };
    const validationError = validateLocalConfig([normalizedTunnel]);
    if (validationError) {
      toast.error(validationError);
      setTunnelMetadata(index, { lastError: validationError });
      return;
    }

    setTunnelActions((current) => ({ ...current, [tunnelName]: true }));
    console.info("[tunnels] Starting client tunnel", {
      tunnelName,
      tunnel: normalizedTunnel,
    });

    try {
      const result = await window.electronAPI.startC2STunnel(
        normalizedTunnel,
        index,
      );
      if (!result.success) {
        throw new Error(result.error || t("tunnels.manualControlError"));
      }
      const statuses = await window.electronAPI.getC2STunnelStatuses();
      setTunnelStatuses(statuses as Record<string, TunnelStatus>);
      setTunnelMetadata(index, {
        lastStartedAt: new Date().toISOString(),
        lastError: "",
      });
      toast.success(t("tunnels.clientTunnelStarted"));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t("tunnels.manualControlError");
      console.error("[tunnels] Failed to start client tunnel", {
        tunnelName,
        error,
      });
      setTunnelMetadata(index, { lastError: message });
      toast.error(message);
    } finally {
      setTunnelActions((current) => ({ ...current, [tunnelName]: false }));
    }
  };

  const handleTunnelStop = async (tunnel: ClientTunnel, index: number) => {
    const tunnelName = getTunnelName(tunnel, index);
    setTunnelActions((current) => ({ ...current, [tunnelName]: true }));

    try {
      const result = await window.electronAPI.stopC2STunnel(tunnelName);
      if (!result.success) {
        throw new Error(result.error || t("tunnels.manualControlError"));
      }
      const statuses = await window.electronAPI.getC2STunnelStatuses();
      setTunnelStatuses(statuses as Record<string, TunnelStatus>);
      toast.success(t("tunnels.clientTunnelStopped"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tunnels.manualControlError"),
      );
    } finally {
      setTunnelActions((current) => ({ ...current, [tunnelName]: false }));
    }
  };

  const handleSavePreset = async () => {
    if (!presetName.trim()) return;

    try {
      await saveLocalConfig(localConfig);
      await createC2STunnelPreset({
        name: presetName.trim(),
        config: localConfig.map(stripClientTunnelDiagnostics),
      });
      await refreshPresets();
      toast.success(t("profile.c2sPresetSaved"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("tunnels.localSaveError"),
      );
    }
  };

  const handleLoadPreset = async () => {
    if (!selectedPreset || selectedMatchesCurrent) return;

    try {
      await saveLocalConfig(selectedPreset.config.map(normalizeClientTunnel));
      toast.success(t("profile.c2sPresetLoaded"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("profile.c2sPresetLoadError"),
      );
    }
  };

  const handleRenamePreset = async () => {
    if (!selectedPreset || !presetName.trim()) return;

    try {
      await updateC2STunnelPreset(selectedPreset.id, {
        name: presetName.trim(),
      });
      await refreshPresets();
      toast.success(t("profile.c2sPresetRenamed"));
    } catch {
      // API helper already surfaces the error.
    }
  };

  const handleDeletePreset = async () => {
    if (!selectedPreset) return;

    try {
      await deleteC2STunnelPreset(selectedPreset.id);
      setSelectedPresetId("");
      await refreshPresets();
      toast.success(t("profile.c2sPresetDeleted"));
    } catch {
      // API helper already surfaces the error.
    }
  };

  if (!isElectron) {
    return (
      <div className="rounded-lg border-2 border-edge bg-elevated p-4">
        <h3 className="text-lg font-semibold mb-2">
          {t("profile.c2sTunnelPresets")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("profile.c2sTunnelPresetsUnavailable")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border-2 border-edge bg-elevated p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">
              {t("tunnels.clientTunnels")}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              {t("profile.c2sTunnelConfigDesc")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setLocalConfig((current) => [...current, createClientTunnel()])
              }
            >
              <Plus className="w-4 h-4 mr-2" />
              {t("tunnels.addClientTunnel")}
            </Button>
            {hasUnsavedLocalChanges && (
              <span className="self-center text-xs text-muted-foreground">
                {t("common.unsavedChanges")}
              </span>
            )}
            <Button type="button" onClick={handleSaveLocal}>
              <Save className="w-4 h-4 mr-2" />
              {t("common.save")}
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          {localConfig.length > 0 ? (
            localConfig.map((tunnel, index) => {
              const mode = getTunnelMode(tunnel);
              const modeDescription = getTunnelModeDescription(
                "client",
                mode,
                {
                  sourcePort: tunnel.sourcePort,
                  endpointPort: tunnel.endpointPort,
                },
                t,
              );
              const tunnelName = getTunnelName(tunnel, index);
              const tunnelStatus = tunnelStatuses[tunnelName];
              const isTunnelActionLoading = Boolean(tunnelActions[tunnelName]);
              const isTunnelTestLoading = Boolean(tunnelTests[tunnelName]);
              const startDisabled = !tunnel.sourceHostId;
              const startDisabledReason = t("tunnels.endpointSshHostRequired");
              const { sourcePortLabel, endpointPortLabel } =
                getTunnelPortLabels("client", mode, t);
              const tunnelSummary = getTunnelSummary(tunnel);
              const statusError =
                tunnelStatus?.reason ||
                (tunnelStatus?.errorType ? String(tunnelStatus.errorType) : "");
              const lastError = statusError || tunnel.lastError || "";
              const lastStarted = formatDateTime(tunnel.lastStartedAt);
              const lastTested = formatDateTime(tunnel.lastTestedAt);

              return (
                <div key={index} className="p-4 border rounded-lg bg-muted/50">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-[240px] flex-1 space-y-1">
                      <Label className="text-xs text-muted-foreground">
                        {t("tunnels.tunnelName")}
                      </Label>
                      <Input
                        value={tunnel.displayName || ""}
                        onChange={(event) =>
                          updateTunnel(index, {
                            displayName: event.target.value,
                          })
                        }
                        placeholder={getTunnelDisplayName(tunnel, index)}
                        className="h-8 max-w-md bg-background"
                      />
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={startDisabled || isTunnelTestLoading}
                        title={startDisabled ? startDisabledReason : undefined}
                        onClick={() => handleTunnelTest(tunnel, index)}
                        className="h-8 px-3 text-xs"
                      >
                        <Activity
                          className={`h-3 w-3 mr-1 ${
                            isTunnelTestLoading ? "animate-pulse" : ""
                          }`}
                        />
                        {t("tunnels.test")}
                      </Button>
                      <TunnelInlineControls
                        status={tunnelStatus}
                        loading={isTunnelActionLoading}
                        onStart={() => handleTunnelStart(tunnel, index)}
                        onStop={() => handleTunnelStop(tunnel, index)}
                        startDisabled={startDisabled}
                        startDisabledReason={startDisabledReason}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setLocalConfig((current) =>
                            current.filter(
                              (_, tunnelIndex) => tunnelIndex !== index,
                            ),
                          )
                        }
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        {t("common.delete")}
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-4 mb-4 mt-4">
                    <div>
                      <Label>{t("tunnels.type")}</Label>
                      <div className="mt-2">
                        <TunnelModeSelector
                          mode={mode}
                          scope="client"
                          onChange={(mode) =>
                            updateTunnel(index, {
                              mode,
                              tunnelType: getTunnelTypeForMode(mode),
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-12 md:col-span-6 space-y-2">
                      <Label>{t("tunnels.endpointSshConfig")}</Label>
                      <Select
                        value={
                          tunnel.sourceHostId
                            ? String(tunnel.sourceHostId)
                            : undefined
                        }
                        onValueChange={(value) =>
                          handleEndpointChange(index, value)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={t(
                              "tunnels.endpointSshHostPlaceholder",
                            )}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {sshHosts.map((host) => (
                            <SelectItem key={host.id} value={String(host.id)}>
                              {host.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {tunnel.mode !== "dynamic" && (
                      <div className="col-span-12 md:col-span-6 space-y-2">
                        <Label>{endpointPortLabel}</Label>
                        <Input
                          value={tunnel.endpointPort}
                          onChange={(event) =>
                            updateTunnel(index, {
                              endpointPort: Number(event.target.value),
                            })
                          }
                          placeholder={t("placeholders.defaultEndpointPort")}
                        />
                      </div>
                    )}
                    {tunnel.mode === "dynamic" && (
                      <div className="hidden md:block md:col-span-6" />
                    )}

                    <div className="col-span-12 md:col-span-6 space-y-2">
                      <Label>{t("tunnels.bindIp")}</Label>
                      <Input
                        value={tunnel.bindHost}
                        onChange={(event) =>
                          updateTunnel(index, {
                            bindHost: event.target.value.trim(),
                          })
                        }
                        placeholder={getBindPlaceholder(mode)}
                      />
                    </div>

                    <div className="col-span-12 md:col-span-6 space-y-2">
                      <Label>{sourcePortLabel}</Label>
                      <Input
                        value={tunnel.sourcePort}
                        onChange={(event) =>
                          updateTunnel(index, {
                            sourcePort: Number(event.target.value),
                          })
                        }
                        placeholder={t("placeholders.defaultPort")}
                      />
                    </div>
                  </div>

                  <p className="text-sm text-muted-foreground mt-2">
                    {modeDescription}
                  </p>
                  <div
                    className="mt-2 rounded-md border bg-canvasX px-3 py-2 text-xs text-muted-foreground"
                    title={tunnelSummary}
                  >
                    <span className="font-medium text-foreground">
                      {t("tunnels.route")}
                    </span>{" "}
                    {tunnelSummary}
                  </div>
                  {mode === "remote" && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("tunnels.clientRemoteServerNote")}
                    </p>
                  )}
                  {(lastError || lastStarted || lastTested) && (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {lastStarted && (
                        <span>
                          {t("tunnels.lastStarted")}: {lastStarted}
                        </span>
                      )}
                      {lastTested && (
                        <span>
                          {t("tunnels.lastTested")}: {lastTested}
                        </span>
                      )}
                      {lastError && (
                        <span
                          className="text-red-600 dark:text-red-400"
                          title={lastError}
                        >
                          {t("tunnels.lastError")}: {lastError}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-12 gap-4 mt-4">
                    <div className="col-span-12 md:col-span-6 space-y-2">
                      <Label>{t("tunnels.maxRetries")}</Label>
                      <Input
                        value={tunnel.maxRetries}
                        onChange={(event) =>
                          updateTunnel(index, {
                            maxRetries: Number(event.target.value),
                          })
                        }
                        placeholder={t("placeholders.maxRetries")}
                      />
                      <p className="text-xs text-muted-foreground">
                        {t("tunnels.maxRetriesDescription")}
                      </p>
                    </div>

                    <div className="col-span-12 md:col-span-6 space-y-2">
                      <Label>{t("tunnels.retryInterval")}</Label>
                      <Input
                        value={tunnel.retryInterval}
                        onChange={(event) =>
                          updateTunnel(index, {
                            retryInterval: Number(event.target.value),
                          })
                        }
                        placeholder={t("placeholders.retryInterval")}
                      />
                      <p className="text-xs text-muted-foreground">
                        {t("tunnels.retryIntervalDescription")}
                      </p>
                    </div>

                    <div className="col-span-12 space-y-2">
                      <div className="flex items-center justify-between gap-3 rounded-md border bg-canvas p-3">
                        <Label>{t("tunnels.autoStart")}</Label>
                        <Switch
                          checked={tunnel.autoStart}
                          onCheckedChange={(checked) =>
                            updateTunnel(index, { autoStart: checked })
                          }
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t(
                          tunnel.autoStart
                            ? "tunnels.clientAutoStartDesc"
                            : "tunnels.clientManualStartDesc",
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-muted-foreground rounded-md border border-dashed p-3">
              {t("tunnels.noClientTunnels")}
            </p>
          )}
        </div>
      </div>

      <div className="rounded-lg border-2 border-edge bg-elevated p-4">
        <div className="mb-4">
          <h3 className="text-lg font-semibold">
            {t("profile.c2sTunnelPresets")}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {t("profile.c2sTunnelPresetsDesc")}
          </p>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(260px,1fr)_minmax(260px,1fr)]">
          <div className="space-y-2">
            <Label>{t("profile.c2sPresetName")}</Label>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                value={presetName}
                onChange={(event) => setPresetName(event.target.value)}
                placeholder={t("profile.c2sPresetNamePlaceholder")}
              />
              <Button onClick={handleSavePreset} disabled={!presetName.trim()}>
                <Save className="w-4 h-4 mr-2" />
                {t("common.save")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("profile.c2sCurrentLocalConfig", {
                count: localConfig.length,
              })}
            </p>
          </div>

          <div className="space-y-2">
            <Label>{t("profile.c2sPresetToLoad")}</Label>
            <div className="flex flex-col lg:flex-row gap-2">
              <Select
                value={selectedPresetId}
                disabled={!hasPresets}
                onValueChange={(value) => {
                  setSelectedPresetId(value);
                  const preset = presets.find(
                    (item) => String(item.id) === value,
                  );
                  if (preset) setPresetName(preset.name);
                }}
              >
                <SelectTrigger className="min-w-0 lg:w-[260px]">
                  <SelectValue
                    placeholder={
                      hasPresets
                        ? t("profile.c2sNoPresetSelected")
                        : t("profile.c2sNoPresets")
                    }
                  />
                </SelectTrigger>
                {hasPresets && (
                  <SelectContent>
                    {presets.map((preset) => (
                      <SelectItem key={preset.id} value={String(preset.id)}>
                        {preset.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                )}
              </Select>
              <Button
                variant="outline"
                onClick={handleLoadPreset}
                disabled={!selectedPreset || selectedMatchesCurrent}
              >
                <Download className="w-4 h-4 mr-2" />
                {t("profile.c2sLoadPreset")}
              </Button>
              <Button
                variant="outline"
                onClick={handleRenamePreset}
                disabled={!selectedPreset || !presetName.trim()}
              >
                <Pencil className="w-4 h-4 mr-2" />
                {t("common.rename")}
              </Button>
              <Button
                variant="ghost"
                onClick={handleDeletePreset}
                disabled={!selectedPreset}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                {t("common.delete")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("profile.c2sPresetSyncNote")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
