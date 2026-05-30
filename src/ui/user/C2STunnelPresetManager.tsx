import React from "react";
import { Button } from "@/components/button.tsx";
import { Input } from "@/components/input.tsx";
import { FakeSwitch } from "@/components/section-card.tsx";
import {
  getTunnelModeDescription,
  getTunnelPortLabels,
  getTunnelTypeForMode,
} from "@/features/tunnel/tunnel-form-utils.ts";
import {
  createC2STunnelPreset,
  deleteC2STunnelPreset,
  getC2STunnelPresets,
  getSSHHosts,
  updateC2STunnelPreset,
} from "@/main-axios.ts";
import type {
  C2STunnelPreset,
  SSHHost,
  TunnelConnection,
  TunnelMode,
  TunnelStatus,
} from "@/types/index.js";
import {
  Activity,
  ChevronDown,
  Download,
  Loader2,
  Pencil,
  Play,
  Plus,
  Save,
  Square,
  Trash2,
} from "lucide-react";
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

function getStatusKind(status?: TunnelStatus) {
  const value = status?.status?.toUpperCase() || "DISCONNECTED";
  if (value === "CONNECTED") return "connected";
  if (value === "ERROR" || value === "FAILED") return "error";
  if (
    value === "CONNECTING" ||
    value === "DISCONNECTING" ||
    value === "RETRYING" ||
    value === "WAITING"
  ) {
    return "connecting";
  }
  return "disconnected";
}

function getStatusTitle(
  status: TunnelStatus | undefined,
  statusText: string,
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (!status) return statusText;
  const details = [];
  if (status.reason) details.push(status.reason);
  if (status.retryCount && status.maxRetries) {
    details.push(
      t("tunnels.attempt", {
        current: status.retryCount,
        max: status.maxRetries,
      }),
    );
  }
  if (status.nextRetryIn) {
    details.push(t("tunnels.nextRetryIn", { seconds: status.nextRetryIn }));
  }
  if (status.errorType && !status.reason) details.push(status.errorType);
  return details.length > 0 ? details.join("\n") : statusText;
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
  const [openTunnels, setOpenTunnels] = React.useState<Set<number>>(new Set());
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

  function toggleTunnel(index: number) {
    setOpenTunnels((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

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
      const statusValue = status.status?.toUpperCase();
      const hasFailureDetail =
        statusValue === "ERROR" ||
        statusValue === "FAILED" ||
        (Boolean(status.errorType) &&
          Boolean(status.reason) &&
          previous?.reason !== status.reason);
      if (hasFailureDetail) {
        const message = status.reason || t("tunnels.manualControlError");
        toast.error(message, { id: `client-tunnel-error-${tunnelName}` });
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
    if (validationError) throw new Error(validationError);
    const result =
      await window.electronAPI.saveC2STunnelConfig(normalizedConfig);
    if (!result.success)
      throw new Error(result.error || t("tunnels.localSaveError"));
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
    try {
      const result = await window.electronAPI.testC2STunnel(
        normalizedTunnel,
        index,
      );
      if (!result.success)
        throw new Error(result.error || t("tunnels.tunnelTestFailed"));
      setTunnelMetadata(index, {
        lastTestedAt: new Date().toISOString(),
        lastError: "",
      });
      toast.success(t("tunnels.tunnelTestSucceeded"));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("tunnels.tunnelTestFailed");
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
    try {
      const result = await window.electronAPI.startC2STunnel(
        normalizedTunnel,
        index,
      );
      if (!result.success)
        throw new Error(result.error || t("tunnels.manualControlError"));
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
      if (!result.success)
        throw new Error(result.error || t("tunnels.manualControlError"));
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
      <div className="pt-2">
        <p className="text-xs text-muted-foreground">
          {t("profile.c2sTunnelPresetsUnavailable")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0 pt-2">
      {/* Tunnel list header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {t("tunnels.clientTunnels")}
        </span>
        <div className="flex items-center gap-1.5">
          {hasUnsavedLocalChanges && (
            <span className="text-[10px] text-muted-foreground">
              {t("common.unsavedChanges")}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-accent-brand hover:bg-accent-brand/10"
            onClick={() => {
              setOpenTunnels(
                (current) => new Set([...current, localConfig.length]),
              );
              setLocalConfig((current) => [...current, createClientTunnel()]);
            }}
          >
            <Plus className="size-3" />
          </Button>
        </div>
      </div>

      {/* Tunnel items */}
      <div className="flex flex-col gap-1.5">
        {localConfig.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            {t("tunnels.noClientTunnels")}
          </div>
        ) : (
          localConfig.map((tunnel, index) => {
            const mode = getTunnelMode(tunnel);
            const tunnelName = getTunnelName(tunnel, index);
            const tunnelStatus = tunnelStatuses[tunnelName];
            const isTunnelActionLoading = Boolean(tunnelActions[tunnelName]);
            const isTunnelTestLoading = Boolean(tunnelTests[tunnelName]);
            const startDisabled = !tunnel.sourceHostId;
            const { sourcePortLabel, endpointPortLabel } = getTunnelPortLabels(
              "client",
              mode,
              t,
            );
            const tunnelSummary = getTunnelSummary(tunnel);
            const modeDescription = getTunnelModeDescription(
              "client",
              mode,
              {
                sourcePort: tunnel.sourcePort,
                endpointPort: tunnel.endpointPort,
              },
              t,
            );
            const statusError =
              tunnelStatus?.reason ||
              (tunnelStatus?.errorType ? String(tunnelStatus.errorType) : "");
            const lastError = statusError || tunnel.lastError || "";
            const lastStarted = formatDateTime(tunnel.lastStartedAt);
            const lastTested = formatDateTime(tunnel.lastTestedAt);
            const isOpen = openTunnels.has(index);

            const kind = getStatusKind(tunnelStatus);
            const isDisconnected = kind === "disconnected";
            const statusText =
              kind === "connected"
                ? t("tunnels.connected")
                : kind === "connecting"
                  ? t("tunnels.connecting")
                  : kind === "error"
                    ? t("tunnels.error")
                    : t("tunnels.disconnected");
            const statusTitle = getStatusTitle(tunnelStatus, statusText, t);
            const statusClass =
              kind === "connected"
                ? "text-accent-brand border-accent-brand/40 bg-accent-brand/10"
                : kind === "connecting"
                  ? "text-blue-400 border-blue-400/40 bg-blue-400/10"
                  : kind === "error"
                    ? "text-destructive border-destructive/40 bg-destructive/10"
                    : "text-muted-foreground border-border bg-muted/30";

            return (
              <div key={index} className="border border-border bg-muted/10">
                {/* Always-visible header */}
                <button
                  className="flex items-center gap-1.5 w-full px-2 py-1.5 text-left hover:bg-muted/30 transition-colors"
                  onClick={() => toggleTunnel(index)}
                >
                  <ChevronDown
                    className={`size-3 text-muted-foreground shrink-0 transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`}
                  />
                  <span className="text-xs font-medium flex-1 min-w-0 truncate">
                    {getTunnelDisplayName(tunnel, index)}
                  </span>
                  <span
                    className={`text-[9px] font-bold px-1 py-px border uppercase shrink-0 ${statusClass}`}
                    title={statusTitle}
                  >
                    {statusText}
                  </span>
                </button>

                {/* Expanded body */}
                {isOpen && (
                  <div className="border-t border-border px-2 pb-2 flex flex-col gap-2 pt-2">
                    {/* Action buttons */}
                    <div className="flex items-center gap-1 flex-wrap">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-[10px] font-bold uppercase tracking-widest border-border text-muted-foreground hover:text-foreground"
                        disabled={startDisabled || isTunnelTestLoading}
                        title={
                          startDisabled
                            ? t("tunnels.endpointSshHostRequired")
                            : undefined
                        }
                        onClick={() => handleTunnelTest(tunnel, index)}
                      >
                        <Activity
                          className={`size-3 ${isTunnelTestLoading ? "animate-pulse" : ""}`}
                        />
                        {t("tunnels.test")}
                      </Button>

                      {isTunnelActionLoading ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-border"
                          disabled
                        >
                          <Loader2 className="size-3 animate-spin" />
                          {isDisconnected
                            ? t("tunnels.start")
                            : t("tunnels.stop")}
                        </Button>
                      ) : isDisconnected ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[10px] font-bold uppercase tracking-widest border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                          disabled={startDisabled}
                          title={
                            startDisabled
                              ? t("tunnels.endpointSshHostRequired")
                              : undefined
                          }
                          onClick={() => handleTunnelStart(tunnel, index)}
                        >
                          <Play className="size-3" />
                          {t("tunnels.start")}
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[10px] font-bold uppercase tracking-widest border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => handleTunnelStop(tunnel, index)}
                        >
                          <Square className="size-3" />
                          {t("tunnels.stop")}
                        </Button>
                      )}

                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 text-muted-foreground hover:text-destructive ml-auto"
                        onClick={() => {
                          setLocalConfig((current) =>
                            current.filter((_, idx) => idx !== index),
                          );
                          setOpenTunnels((current) => {
                            const next = new Set<number>();
                            for (const idx of current) {
                              if (idx < index) next.add(idx);
                              else if (idx > index) next.add(idx - 1);
                            }
                            return next;
                          });
                        }}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>

                    {/* Display name */}
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {t("tunnels.tunnelName")}
                      </label>
                      <Input
                        value={tunnel.displayName || ""}
                        onChange={(e) =>
                          updateTunnel(index, { displayName: e.target.value })
                        }
                        placeholder={getTunnelDisplayName(tunnel, index)}
                        className="h-7 text-xs bg-muted/50 border-border rounded-none"
                      />
                    </div>

                    {/* Mode */}
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {t("tunnels.type")}
                      </label>
                      <select
                        value={mode}
                        onChange={(e) =>
                          updateTunnel(index, {
                            mode: e.target.value as TunnelMode,
                            tunnelType: getTunnelTypeForMode(
                              e.target.value as TunnelMode,
                            ),
                          })
                        }
                        className="px-2 py-1 text-xs bg-background border border-border text-foreground outline-none focus:ring-1 focus:ring-ring w-full h-7"
                      >
                        <option value="local">{t("tunnels.typeLocal")}</option>
                        <option value="remote">
                          {t("tunnels.typeRemote")}
                        </option>
                        <option value="dynamic">
                          {t("tunnels.typeDynamic")}
                        </option>
                      </select>
                      <span className="text-[10px] text-muted-foreground">
                        {modeDescription}
                      </span>
                    </div>

                    {/* SSH host */}
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {t("tunnels.endpointSshConfig")}
                      </label>
                      <select
                        value={
                          tunnel.sourceHostId ? String(tunnel.sourceHostId) : ""
                        }
                        onChange={(e) =>
                          handleEndpointChange(index, e.target.value)
                        }
                        className="px-2 py-1 text-xs bg-background border border-border text-foreground outline-none focus:ring-1 focus:ring-ring w-full h-7"
                      >
                        <option value="">
                          {t("tunnels.endpointSshHostPlaceholder")}
                        </option>
                        {sshHosts.map((host) => (
                          <option key={host.id} value={String(host.id)}>
                            {host.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Ports */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          {sourcePortLabel}
                        </label>
                        <Input
                          type="number"
                          value={tunnel.sourcePort}
                          onChange={(e) =>
                            updateTunnel(index, {
                              sourcePort: Number(e.target.value),
                            })
                          }
                          placeholder={t("placeholders.defaultPort")}
                          className="h-7 text-xs bg-muted/50 border-border rounded-none"
                        />
                      </div>
                      {mode !== "dynamic" && (
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            {endpointPortLabel}
                          </label>
                          <Input
                            type="number"
                            value={tunnel.endpointPort}
                            onChange={(e) =>
                              updateTunnel(index, {
                                endpointPort: Number(e.target.value),
                              })
                            }
                            placeholder={t("placeholders.defaultEndpointPort")}
                            className="h-7 text-xs bg-muted/50 border-border rounded-none"
                          />
                        </div>
                      )}
                    </div>

                    {/* Bind IP */}
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {t("tunnels.bindIp")}
                      </label>
                      <Input
                        value={tunnel.bindHost}
                        onChange={(e) =>
                          updateTunnel(index, {
                            bindHost: e.target.value.trim(),
                          })
                        }
                        placeholder={getBindPlaceholder(mode)}
                        className="h-7 text-xs bg-muted/50 border-border rounded-none"
                      />
                    </div>

                    {/* Route summary */}
                    <div
                      className="border border-border bg-muted/30 px-2 py-1 text-[10px] font-mono text-muted-foreground"
                      title={tunnelSummary}
                    >
                      <span className="font-bold text-foreground">
                        {t("tunnels.route")}
                      </span>{" "}
                      {tunnelSummary}
                    </div>

                    {mode === "remote" && (
                      <p className="text-[10px] text-muted-foreground">
                        {t("tunnels.clientRemoteServerNote")}
                      </p>
                    )}

                    {/* Last activity */}
                    {(lastError || lastStarted || lastTested) && (
                      <div className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
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
                            className="text-destructive truncate"
                            title={lastError}
                          >
                            {t("tunnels.lastError")}: {lastError}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Retries */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          {t("tunnels.maxRetries")}
                        </label>
                        <Input
                          type="number"
                          value={tunnel.maxRetries}
                          onChange={(e) =>
                            updateTunnel(index, {
                              maxRetries: Number(e.target.value),
                            })
                          }
                          placeholder={t("placeholders.maxRetries")}
                          className="h-7 text-xs bg-muted/50 border-border rounded-none"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          {t("tunnels.retryInterval")}
                        </label>
                        <Input
                          type="number"
                          value={tunnel.retryInterval}
                          onChange={(e) =>
                            updateTunnel(index, {
                              retryInterval: Number(e.target.value),
                            })
                          }
                          placeholder={t("placeholders.retryInterval")}
                          className="h-7 text-xs bg-muted/50 border-border rounded-none"
                        />
                      </div>
                    </div>

                    {/* Auto-start */}
                    <div className="flex items-center justify-between border border-border bg-muted/20 px-2 py-1.5">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-medium">
                          {t("tunnels.autoStart")}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {t(
                            tunnel.autoStart
                              ? "tunnels.clientAutoStartDesc"
                              : "tunnels.clientManualStartDesc",
                          )}
                        </span>
                      </div>
                      <FakeSwitch
                        checked={tunnel.autoStart}
                        onChange={(checked) =>
                          updateTunnel(index, { autoStart: checked })
                        }
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Save local config button */}
      <Button
        variant="outline"
        size="sm"
        className={`mt-2 w-full h-7 text-[10px] font-bold uppercase tracking-widest rounded-none ${
          hasUnsavedLocalChanges
            ? "border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10"
            : "border-border text-muted-foreground"
        }`}
        onClick={handleSaveLocal}
      >
        <Save className="size-3" />
        {t("common.save")}
      </Button>

      {/* Presets section */}
      <div className="border-t border-border pt-3 mt-3 flex flex-col gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {t("profile.c2sTunnelPresets")}
        </span>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("profile.c2sPresetName")}
          </label>
          <div className="flex gap-1.5">
            <Input
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder={t("profile.c2sPresetNamePlaceholder")}
              className="h-7 text-xs bg-muted/50 border-border rounded-none flex-1 min-w-0"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0 text-[10px] font-bold uppercase tracking-widest rounded-none border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10"
              disabled={!presetName.trim()}
              onClick={handleSavePreset}
            >
              <Save className="size-3" />
              {t("common.save")}
            </Button>
          </div>
          <span className="text-[10px] text-muted-foreground">
            {t("profile.c2sCurrentLocalConfig", { count: localConfig.length })}
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("profile.c2sPresetToLoad")}
          </label>
          <select
            value={selectedPresetId}
            disabled={!hasPresets}
            onChange={(e) => {
              setSelectedPresetId(e.target.value);
              const preset = presets.find(
                (p) => String(p.id) === e.target.value,
              );
              if (preset) setPresetName(preset.name);
            }}
            className="px-2 py-1 text-xs bg-background border border-border text-foreground outline-none focus:ring-1 focus:ring-ring w-full h-7 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="">
              {hasPresets
                ? t("profile.c2sNoPresetSelected")
                : t("profile.c2sNoPresets")}
            </option>
            {presets.map((preset) => (
              <option key={preset.id} value={String(preset.id)}>
                {preset.name}
              </option>
            ))}
          </select>
          <span className="text-[10px] text-muted-foreground">
            {t("profile.c2sPresetSyncNote")}
          </span>
        </div>

        <div className="flex gap-1 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10px] font-bold uppercase tracking-widest rounded-none border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10"
            disabled={!selectedPreset || selectedMatchesCurrent}
            onClick={handleLoadPreset}
          >
            <Download className="size-3" />
            {t("profile.c2sLoadPreset")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10px] font-bold uppercase tracking-widest rounded-none border-border text-muted-foreground hover:text-foreground"
            disabled={!selectedPreset || !presetName.trim()}
            onClick={handleRenamePreset}
          >
            <Pencil className="size-3" />
            {t("common.rename")}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-destructive ml-auto"
            disabled={!selectedPreset}
            onClick={handleDeletePreset}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
