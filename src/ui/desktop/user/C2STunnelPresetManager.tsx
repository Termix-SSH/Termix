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
} from "@/types/index.js";
import { Download, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

type ClientTunnel = TunnelConnection & {
  bindHost: string;
  sourceHostId?: number;
  sourceHostName?: string;
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

function createClientTunnel(): ClientTunnel {
  return {
    scope: "c2s",
    mode: "local",
    tunnelType: "local",
    bindHost: "127.0.0.1",
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
  const mode = tunnel.mode || tunnel.tunnelType || "local";

  return {
    ...tunnel,
    scope: "c2s",
    mode,
    tunnelType: mode === "dynamic" ? "local" : mode,
    bindHost: tunnel.bindHost || "127.0.0.1",
    sourcePort: Number(tunnel.sourcePort) || 8080,
    endpointPort: Number(tunnel.endpointPort) || 22,
    endpointHost: tunnel.endpointHost || tunnel.sourceHostName || "",
    maxRetries: Number(tunnel.maxRetries) || 3,
    retryInterval: Number(tunnel.retryInterval) || 10,
    autoStart: Boolean(tunnel.autoStart),
  };
}

export function C2STunnelPresetManager(): React.ReactElement {
  const { t } = useTranslation();
  const [localConfig, setLocalConfig] = React.useState<ClientTunnel[]>([]);
  const [savedLocalConfig, setSavedLocalConfig] = React.useState<
    ClientTunnel[]
  >([]);
  const [hosts, setHosts] = React.useState<SSHHost[]>([]);
  const [presets, setPresets] = React.useState<C2STunnelPreset[]>([]);
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
      ? sameConfig(selectedPreset.config, localConfig)
      : false;
  }, [localConfig, selectedPreset]);
  const hasUnsavedLocalChanges = React.useMemo(
    () => !sameConfig(savedLocalConfig, localConfig),
    [savedLocalConfig, localConfig],
  );
  const hasPresets = presets.length > 0;

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

  const validateLocalConfig = (config: ClientTunnel[]) => {
    const autoStartListeners = new Set<string>();

    for (const tunnel of config) {
      if (!isValidIPv4(tunnel.bindHost)) {
        return t("tunnels.invalidBindIp");
      }
      if (!isValidPort(tunnel.sourcePort)) {
        return t("tunnels.invalidLocalPort");
      }
      if (tunnel.mode !== "dynamic" && !isValidPort(tunnel.endpointPort)) {
        return t("tunnels.invalidEndpointPort");
      }
      if (!tunnel.sourceHostId) {
        return t("tunnels.endpointSshHostRequired");
      }
      if (tunnel.autoStart) {
        const listenerKey = `${tunnel.bindHost}:${tunnel.sourcePort}`;
        if (autoStartListeners.has(listenerKey)) {
          return t("tunnels.duplicateAutoStartBind", { bind: listenerKey });
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

  const handleSavePreset = async () => {
    if (!presetName.trim()) return;

    try {
      await saveLocalConfig(localConfig);
      await createC2STunnelPreset({
        name: presetName.trim(),
        config: localConfig,
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
              const modeDescription =
                tunnel.mode === "dynamic"
                  ? t("tunnels.forwardDescriptionClientDynamic", {
                      sourcePort: tunnel.sourcePort,
                    })
                  : tunnel.mode === "local"
                    ? t("tunnels.forwardDescriptionClientLocal", {
                        sourcePort: tunnel.sourcePort,
                        endpointPort: tunnel.endpointPort,
                      })
                    : t("tunnels.forwardDescriptionClientRemote", {
                        sourcePort: tunnel.sourcePort,
                        endpointPort: tunnel.endpointPort,
                      });

              return (
                <div key={index} className="p-4 border rounded-lg bg-muted/50">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h4 className="text-sm font-bold">
                      {t("tunnels.clientTunnel")} {index + 1}
                    </h4>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <TunnelInlineControls
                        onStart={() =>
                          toast.info(t("tunnels.clientManualStartUnavailable"))
                        }
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

                  <div className="grid gap-4 mb-4">
                    <div>
                      <Label>{t("tunnels.type")}</Label>
                      <div className="grid gap-3 lg:grid-cols-3 mt-2">
                        <label className="flex items-start gap-3 rounded-md border bg-background p-3 cursor-pointer">
                          <input
                            type="radio"
                            value="local"
                            checked={tunnel.mode === "local"}
                            onChange={() =>
                              updateTunnel(index, {
                                mode: "local",
                                tunnelType: "local",
                              })
                            }
                            className="mt-0.5 w-4 h-4 text-primary border-input focus:ring-ring"
                          />
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">
                              {t("tunnels.typeLocal")}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {t("tunnels.typeClientLocalDesc")}
                            </span>
                          </div>
                        </label>
                        <label className="flex items-start gap-3 rounded-md border bg-background p-3 cursor-pointer">
                          <input
                            type="radio"
                            value="remote"
                            checked={tunnel.mode === "remote"}
                            onChange={() =>
                              updateTunnel(index, {
                                mode: "remote",
                                tunnelType: "remote",
                              })
                            }
                            className="mt-0.5 w-4 h-4 text-primary border-input focus:ring-ring"
                          />
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">
                              {t("tunnels.typeRemote")}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {t("tunnels.typeClientRemoteDesc")}
                            </span>
                          </div>
                        </label>
                        <label className="flex items-start gap-3 rounded-md border bg-background p-3 cursor-pointer">
                          <input
                            type="radio"
                            value="dynamic"
                            checked={tunnel.mode === "dynamic"}
                            onChange={() =>
                              updateTunnel(index, {
                                mode: "dynamic",
                                tunnelType: "local",
                              })
                            }
                            className="mt-0.5 w-4 h-4 text-primary border-input focus:ring-ring"
                          />
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">
                              {t("tunnels.typeDynamic")}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {t("tunnels.typeClientDynamicDesc")}
                            </span>
                          </div>
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-12 md:col-span-6 space-y-2">
                      <Label>{t("tunnels.endpointSshHost")}</Label>
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
                        <Label>{t("tunnels.endpointPort")}</Label>
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

                    <div className="col-span-12 md:col-span-6 space-y-2">
                      <Label>{t("tunnels.bindIp")}</Label>
                      <Input
                        value={tunnel.bindHost}
                        onChange={(event) =>
                          updateTunnel(index, {
                            bindHost: event.target.value.trim(),
                          })
                        }
                        placeholder="127.0.0.1"
                      />
                    </div>

                    <div className="col-span-12 md:col-span-6 space-y-2">
                      <Label>{t("tunnels.localPort")}</Label>
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
                      <div className="flex items-center justify-between gap-3 rounded-md border bg-background p-3">
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
