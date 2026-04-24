import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { TunnelInlineControls } from "@/ui/desktop/apps/features/tunnel/TunnelInlineControls.tsx";
import { useTabs } from "@/ui/desktop/navigation/tabs/TabContext.tsx";
import {
  connectTunnel,
  disconnectTunnel,
  getTunnelStatuses,
} from "@/ui/main-axios.ts";
import type { SSHHost, TunnelConfig, TunnelStatus } from "@/types/index.js";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { HostTunnelTabProps } from "./shared/tab-types";

export function HostTunnelTab({
  form,
  hosts,
  editingHost,
  sshConfigDropdownOpen,
  setSshConfigDropdownOpen,
  sshConfigInputRefs,
  sshConfigDropdownRefs,
  getFilteredSshConfigs,
  handleSshConfigClick,
  t,
}: HostTunnelTabProps) {
  const { tabs, addTab, setCurrentTab, updateTab } = useTabs();
  const [tunnelStatuses, setTunnelStatuses] = useState<
    Record<string, TunnelStatus>
  >({});
  const [tunnelActions, setTunnelActions] = useState<Record<string, boolean>>(
    {},
  );
  const supportsC2S =
    typeof window !== "undefined" && window.electronAPI?.isElectron === true;

  const fetchTunnelStatuses = async () => {
    try {
      setTunnelStatuses(await getTunnelStatuses());
    } catch {
      // The form should stay usable even when the tunnel service is unavailable.
    }
  };

  useEffect(() => {
    fetchTunnelStatuses();
    const interval = window.setInterval(fetchTunnelStatuses, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const openC2SPresets = () => {
    const profileTab = tabs.find((tab) => tab.type === "user_profile");
    if (profileTab) {
      updateTab(profileTab.id, {
        initialTab: "c2s-tunnels",
        _updateTimestamp: Date.now(),
      });
      setCurrentTab(profileTab.id);
      return;
    }

    const id = addTab({
      type: "user_profile",
      title: t("profile.title"),
      initialTab: "c2s-tunnels",
    });
    setCurrentTab(id);
  };

  const getCurrentHost = (): SSHHost | null => {
    if (!editingHost?.id) return null;
    return hosts.find((host) => host.id === editingHost.id) || editingHost;
  };

  const getTunnelName = (host: SSHHost, index: number) => {
    const tunnel = form.getValues(`serverTunnels.${index}`);
    return `${host.id}::${index}::${host.name || `${host.username}@${host.ip}`}::${tunnel.sourcePort}::${tunnel.endpointHost}::${tunnel.endpointPort}`;
  };

  const handleServerTunnelAction = async (
    action: "connect" | "disconnect",
    index: number,
  ) => {
    const host = getCurrentHost();
    if (!host?.id) {
      toast.error(t("tunnels.saveHostBeforeManualControl"));
      return;
    }

    const tunnel = form.getValues(`serverTunnels.${index}`);
    const tunnelName = getTunnelName(host, index);
    setTunnelActions((current) => ({ ...current, [tunnelName]: true }));

    try {
      if (action === "connect") {
        const endpointHost = hosts.find(
          (item) =>
            item.name === tunnel.endpointHost ||
            `${item.username}@${item.ip}` === tunnel.endpointHost,
        );
        const tunnelConfig: TunnelConfig = {
          name: tunnelName,
          scope: "s2s",
          mode: tunnel.mode || tunnel.tunnelType || "remote",
          bindHost: tunnel.bindHost,
          targetHost: tunnel.targetHost,
          tunnelType:
            tunnel.tunnelType ||
            (tunnel.mode === "local" || tunnel.mode === "remote"
              ? tunnel.mode
              : "remote"),
          sourceHostId: host.id,
          tunnelIndex: index,
          hostName: host.name || `${host.username}@${host.ip}`,
          sourceIP: host.ip,
          sourceSSHPort: host.port,
          sourceUsername: host.username,
          sourcePassword:
            host.authType === "password" ? host.password : undefined,
          sourceAuthMethod: host.authType,
          sourceSSHKey: host.authType === "key" ? host.key : undefined,
          sourceKeyPassword:
            host.authType === "key" ? host.keyPassword : undefined,
          sourceKeyType: host.authType === "key" ? host.keyType : undefined,
          sourceCredentialId: host.credentialId,
          sourceUserId: host.userId,
          endpointHost: tunnel.endpointHost,
          endpointIP: endpointHost?.ip,
          endpointSSHPort: endpointHost?.port,
          endpointUsername: endpointHost?.username,
          endpointPassword:
            endpointHost?.authType === "password"
              ? endpointHost.password
              : undefined,
          endpointAuthMethod: endpointHost?.authType,
          endpointSSHKey:
            endpointHost?.authType === "key" ? endpointHost.key : undefined,
          endpointKeyPassword:
            endpointHost?.authType === "key"
              ? endpointHost.keyPassword
              : undefined,
          endpointKeyType:
            endpointHost?.authType === "key" ? endpointHost.keyType : undefined,
          endpointCredentialId: endpointHost?.credentialId,
          endpointUserId: endpointHost?.userId,
          sourcePort: tunnel.sourcePort,
          endpointPort: tunnel.endpointPort,
          maxRetries: tunnel.maxRetries,
          retryInterval: tunnel.retryInterval * 1000,
          autoStart: tunnel.autoStart,
          isPinned: host.pin,
          useSocks5: host.useSocks5,
          socks5Host: host.socks5Host,
          socks5Port: host.socks5Port,
          socks5Username: host.socks5Username,
          socks5Password: host.socks5Password,
          socks5ProxyChain: host.socks5ProxyChain,
        };
        await connectTunnel(tunnelConfig);
      } else {
        await disconnectTunnel(tunnelName);
      }

      await fetchTunnelStatuses();
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

  return (
    <div>
      <FormField
        control={form.control}
        name="enableTunnel"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("hosts.enableTunnel")}</FormLabel>
            <FormControl>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
            <FormDescription>{t("hosts.enableTunnelDesc")}</FormDescription>
          </FormItem>
        )}
      />
      {form.watch("enableTunnel") && (
        <>
          <Alert className="mt-4">
            <AlertDescription>
              <strong>{t("hosts.sshpassRequired")}</strong>
              <div>
                {t("hosts.sshpassRequiredDesc")}{" "}
                <code className="bg-muted px-1 rounded inline">
                  sudo apt install sshpass
                </code>{" "}
                {t("hosts.debianUbuntuEquivalent")}
              </div>
              <div className="mt-2">
                <strong>{t("hosts.otherInstallMethods")}</strong>
                <div>
                  • {t("hosts.centosRhelFedora")}{" "}
                  <code className="bg-muted px-1 rounded inline">
                    sudo yum install sshpass
                  </code>{" "}
                  {t("hosts.or")}{" "}
                  <code className="bg-muted px-1 rounded inline">
                    sudo dnf install sshpass
                  </code>
                </div>
                <div>
                  • {t("hosts.macos")}{" "}
                  <code className="bg-muted px-1 rounded inline">
                    brew install hudochenkov/sshpass/sshpass
                  </code>
                </div>
                <div>
                  • {t("hosts.windows")}{" "}
                  <code className="bg-muted px-1 rounded inline">
                    sudo apt install sshpass
                  </code>
                </div>
              </div>
            </AlertDescription>
          </Alert>

          <Alert className="mt-4">
            <AlertDescription>
              <strong>{t("hosts.sshServerConfigRequired")}</strong>
              <div>{t("hosts.sshServerConfigDesc")}</div>
              <div>
                •{" "}
                <code className="bg-muted px-1 rounded inline">
                  GatewayPorts yes
                </code>{" "}
                {t("hosts.gatewayPortsYes")}
              </div>
              <div>
                •{" "}
                <code className="bg-muted px-1 rounded inline">
                  AllowTcpForwarding yes
                </code>{" "}
                {t("hosts.allowTcpForwardingYes")}
              </div>
              <div>
                •{" "}
                <code className="bg-muted px-1 rounded inline">
                  PermitRootLogin yes
                </code>{" "}
                {t("hosts.permitRootLoginYes")}
              </div>
              <div className="mt-2">
                {t("hosts.editSshConfig")}{" "}
                <code className="bg-muted px-1 rounded inline">
                  {t("hosts.sshConfigPath")}
                </code>
              </div>
              <div className="mt-2">
                {t("hosts.restartSshService")}{" "}
                <code className="bg-muted px-1 rounded inline">
                  {t("hosts.restartSshCommand")}
                </code>
              </div>
            </AlertDescription>
          </Alert>
          <div className="mt-3 flex flex-wrap items-center gap-2 justify-between">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={() =>
                window.open("https://docs.termix.site/tunnels", "_blank")
              }
            >
              {t("common.documentation")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={openC2SPresets}
              disabled={!supportsC2S}
              title={
                supportsC2S ? undefined : t("tunnels.clientTunnelsUnavailable")
              }
            >
              {t("tunnels.manageClientTunnels")}
            </Button>
          </div>
          {!supportsC2S && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("tunnels.clientTunnelsUnavailable")}
            </p>
          )}
          {(() => {
            type TunnelFieldName = "serverTunnels";

            const removeTunnel = (
              fieldName: TunnelFieldName,
              tunnels: unknown[],
              index: number,
            ) => {
              form.setValue(
                fieldName,
                tunnels.filter((_, i) => i !== index),
                { shouldDirty: true, shouldValidate: true },
              );
            };

            const addServerTunnel = (tunnels: unknown[]) => {
              form.setValue(
                "serverTunnels",
                [
                  ...tunnels,
                  {
                    scope: "s2s",
                    mode: "remote",
                    tunnelType: "remote",
                    sourcePort: 22,
                    endpointPort: 224,
                    endpointHost: "",
                    maxRetries: 3,
                    retryInterval: 10,
                    autoStart: false,
                  },
                ],
                { shouldDirty: true, shouldValidate: true },
              );
            };

            const renderTunnelCard = (
              fieldName: TunnelFieldName,
              index: number,
              displayIndex: number,
              tunnels: unknown[],
            ) => {
              const scope = form.watch(`${fieldName}.${index}.scope`) || "s2s";
              const mode = form.watch(`${fieldName}.${index}.mode`) || "remote";
              const isC2S = scope === "c2s";
              const currentHost = getCurrentHost();
              const tunnelName = currentHost
                ? getTunnelName(currentHost, index)
                : "";
              const tunnelStatus = tunnelName
                ? tunnelStatuses[tunnelName]
                : undefined;
              const isTunnelActionLoading = tunnelName
                ? Boolean(tunnelActions[tunnelName])
                : false;
              const sourcePortLabel = isC2S
                ? mode === "remote"
                  ? t("tunnels.remotePort")
                  : t("tunnels.localPort")
                : mode === "remote"
                  ? t("tunnels.endpointPort")
                  : t("tunnels.currentHostPort");
              const endpointPortLabel = isC2S
                ? mode === "remote"
                  ? t("tunnels.localPort")
                  : t("tunnels.remotePort")
                : mode === "remote"
                  ? t("tunnels.currentHostPort")
                  : t("tunnels.endpointPort");
              const modeDescription =
                mode === "dynamic"
                  ? isC2S
                    ? t("tunnels.forwardDescriptionClientDynamic", {
                        sourcePort:
                          form.watch(`${fieldName}.${index}.sourcePort`) ||
                          "1080",
                      })
                    : t("tunnels.forwardDescriptionServerDynamic", {
                        sourcePort:
                          form.watch(`${fieldName}.${index}.sourcePort`) ||
                          "1080",
                      })
                  : mode === "local"
                    ? isC2S
                      ? t("tunnels.forwardDescriptionClientLocal", {
                          sourcePort:
                            form.watch(`${fieldName}.${index}.sourcePort`) ||
                            "22",
                          endpointPort:
                            form.watch(`${fieldName}.${index}.endpointPort`) ||
                            "22",
                        })
                      : t("tunnels.forwardDescriptionServerLocal", {
                          sourcePort:
                            form.watch(`${fieldName}.${index}.sourcePort`) ||
                            "22",
                          endpointPort:
                            form.watch(`${fieldName}.${index}.endpointPort`) ||
                            "224",
                        })
                    : isC2S
                      ? t("tunnels.forwardDescriptionClientRemote", {
                          sourcePort:
                            form.watch(`${fieldName}.${index}.sourcePort`) ||
                            "22",
                          endpointPort:
                            form.watch(`${fieldName}.${index}.endpointPort`) ||
                            "22",
                        })
                      : t("tunnels.forwardDescriptionServerRemote", {
                          sourcePort:
                            form.watch(`${fieldName}.${index}.sourcePort`) ||
                            "22",
                          endpointPort:
                            form.watch(`${fieldName}.${index}.endpointPort`) ||
                            "224",
                        });

              return (
                <div key={index} className="p-4 border rounded-lg bg-muted/50">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-bold">
                      {isC2S
                        ? t("tunnels.clientTunnel")
                        : t("tunnels.serverTunnel")}{" "}
                      {displayIndex + 1}
                    </h4>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <TunnelInlineControls
                        status={tunnelStatus}
                        loading={isTunnelActionLoading}
                        onStart={() =>
                          handleServerTunnelAction("connect", index)
                        }
                        onStop={() =>
                          handleServerTunnelAction("disconnect", index)
                        }
                        startDisabled={!currentHost}
                        startDisabledReason={t(
                          "tunnels.saveHostBeforeManualControl",
                        )}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeTunnel(fieldName, tunnels, index)}
                      >
                        {t("common.delete")}
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-4 mb-4">
                    <FormField
                      control={form.control}
                      name={`${fieldName}.${index}.mode`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("tunnels.type")}</FormLabel>
                          <FormControl>
                            <div className="grid gap-3 lg:grid-cols-3">
                              <label className="flex items-start gap-3 rounded-md border bg-background p-3 cursor-pointer">
                                <input
                                  type="radio"
                                  value="local"
                                  checked={field.value === "local"}
                                  onChange={() => field.onChange("local")}
                                  className="mt-0.5 w-4 h-4 text-primary border-input focus:ring-ring"
                                />
                                <div className="flex flex-col">
                                  <span className="text-sm font-medium">
                                    {t("tunnels.typeLocal")}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {isC2S
                                      ? t("tunnels.typeClientLocalDesc")
                                      : t("tunnels.typeServerLocalDesc")}
                                  </span>
                                </div>
                              </label>
                              <label className="flex items-start gap-3 rounded-md border bg-background p-3 cursor-pointer">
                                <input
                                  type="radio"
                                  value="remote"
                                  checked={field.value === "remote"}
                                  onChange={() => field.onChange("remote")}
                                  className="mt-0.5 w-4 h-4 text-primary border-input focus:ring-ring"
                                />
                                <div className="flex flex-col">
                                  <span className="text-sm font-medium">
                                    {t("tunnels.typeRemote")}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {isC2S
                                      ? t("tunnels.typeClientRemoteDesc")
                                      : t("tunnels.typeServerRemoteDesc")}
                                  </span>
                                </div>
                              </label>
                              <label className="flex items-start gap-3 rounded-md border bg-background p-3 cursor-pointer">
                                <input
                                  type="radio"
                                  value="dynamic"
                                  checked={field.value === "dynamic"}
                                  onChange={() => field.onChange("dynamic")}
                                  className="mt-0.5 w-4 h-4 text-primary border-input focus:ring-ring"
                                />
                                <div className="flex flex-col">
                                  <span className="text-sm font-medium">
                                    {t("tunnels.typeDynamic", "Dynamic (-D)")}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {t(
                                      "tunnels.typeDynamicDesc",
                                      "Forward SOCKS5 CONNECT traffic through SSH",
                                    )}
                                  </span>
                                </div>
                              </label>
                            </div>
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-12 gap-4">
                    {!isC2S && (
                      <FormField
                        control={form.control}
                        name={`${fieldName}.${index}.endpointHost`}
                        render={({ field: endpointHostField }) => (
                          <FormItem className="col-span-12 md:col-span-6 relative">
                            <FormLabel>
                              {t("tunnels.endpointSshConfig")}
                            </FormLabel>
                            <FormControl>
                              <Input
                                ref={(el) => {
                                  sshConfigInputRefs.current[index] = el;
                                }}
                                placeholder={t("placeholders.sshConfig")}
                                className="min-h-[40px]"
                                autoComplete="off"
                                value={endpointHostField.value || ""}
                                onFocus={() =>
                                  setSshConfigDropdownOpen((prev) => ({
                                    ...prev,
                                    [index]: true,
                                  }))
                                }
                                onChange={(e) => {
                                  endpointHostField.onChange(e);
                                  setSshConfigDropdownOpen((prev) => ({
                                    ...prev,
                                    [index]: true,
                                  }));
                                }}
                                onBlur={(e) => {
                                  endpointHostField.onChange(
                                    e.target.value.trim(),
                                  );
                                  endpointHostField.onBlur();
                                }}
                              />
                            </FormControl>
                            {sshConfigDropdownOpen[index] &&
                              getFilteredSshConfigs(index).length > 0 && (
                                <div
                                  ref={(el) => {
                                    sshConfigDropdownRefs.current[index] = el;
                                  }}
                                  className="absolute top-full left-0 z-50 mt-1 w-full bg-canvas border border-input rounded-md shadow-lg max-h-40 overflow-y-auto thin-scrollbar p-1"
                                >
                                  <div className="grid grid-cols-1 gap-1 p-0">
                                    {getFilteredSshConfigs(index).map(
                                      (config) => (
                                        <Button
                                          key={config}
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          className="w-full justify-start text-left rounded px-2 py-1.5 hover:bg-surface-hover focus:bg-surface-hover focus:outline-none"
                                          onClick={() =>
                                            handleSshConfigClick(config, index)
                                          }
                                        >
                                          {config}
                                        </Button>
                                      ),
                                    )}
                                  </div>
                                </div>
                              )}
                          </FormItem>
                        )}
                      />
                    )}
                    {mode !== "dynamic" && (
                      <FormField
                        control={form.control}
                        name={`${fieldName}.${index}.endpointPort`}
                        render={({ field: endpointPortField }) => (
                          <FormItem className="col-span-12 md:col-span-6">
                            <FormLabel>{endpointPortLabel}</FormLabel>
                            <FormControl>
                              <Input
                                placeholder={t(
                                  "placeholders.defaultEndpointPort",
                                )}
                                {...endpointPortField}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    )}
                    <FormField
                      control={form.control}
                      name={`${fieldName}.${index}.sourcePort`}
                      render={({ field: sourcePortField }) => (
                        <FormItem className="col-span-12 md:col-span-6">
                          <FormLabel>{sourcePortLabel}</FormLabel>
                          <FormControl>
                            <Input
                              placeholder={t("placeholders.defaultPort")}
                              {...sourcePortField}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>

                  <p className="text-sm text-muted-foreground mt-2">
                    {modeDescription}
                  </p>

                  <div className="grid grid-cols-12 gap-4 mt-4">
                    <FormField
                      control={form.control}
                      name={`${fieldName}.${index}.maxRetries`}
                      render={({ field: maxRetriesField }) => (
                        <FormItem className="col-span-12 md:col-span-6">
                          <FormLabel>{t("tunnels.maxRetries")}</FormLabel>
                          <FormControl>
                            <Input
                              placeholder={t("placeholders.maxRetries")}
                              {...maxRetriesField}
                            />
                          </FormControl>
                          <FormDescription>
                            {t("tunnels.maxRetriesDescription")}
                          </FormDescription>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`${fieldName}.${index}.retryInterval`}
                      render={({ field: retryIntervalField }) => (
                        <FormItem className="col-span-12 md:col-span-6">
                          <FormLabel>{t("tunnels.retryInterval")}</FormLabel>
                          <FormControl>
                            <Input
                              placeholder={t("placeholders.retryInterval")}
                              {...retryIntervalField}
                            />
                          </FormControl>
                          <FormDescription>
                            {t("tunnels.retryIntervalDescription")}
                          </FormDescription>
                        </FormItem>
                      )}
                    />
                    {!isC2S && (
                      <FormField
                        control={form.control}
                        name={`${fieldName}.${index}.autoStart`}
                        render={({ field }) => (
                          <FormItem className="col-span-12">
                            <FormControl>
                              <div className="flex items-center justify-between gap-3 rounded-md border bg-background p-3">
                                <FormLabel>
                                  {t("tunnels.autoStartContainer")}
                                </FormLabel>
                                <Switch
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                />
                              </div>
                            </FormControl>
                            <FormDescription>
                              {t("tunnels.autoStartContainerDesc")}
                            </FormDescription>
                          </FormItem>
                        )}
                      />
                    )}
                  </div>
                </div>
              );
            };

            return (
              <div className="mt-4 space-y-6">
                <FormField
                  control={form.control}
                  name="serverTunnels"
                  render={({ field }) => {
                    const serverTunnels = field.value || [];

                    return (
                      <FormItem>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <FormLabel className="text-sm">
                              {t("tunnels.serverTunnels")}
                            </FormLabel>
                            <p className="text-xs text-muted-foreground">
                              {t("tunnels.serverTunnelsDesc")}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => addServerTunnel(serverTunnels)}
                          >
                            {t("tunnels.addServerTunnel")}
                          </Button>
                        </div>
                        <FormControl>
                          <div>
                            {serverTunnels.length > 0 ? (
                              <div className="space-y-4">
                                {serverTunnels.map((_, index) =>
                                  renderTunnelCard(
                                    "serverTunnels",
                                    index,
                                    index,
                                    serverTunnels,
                                  ),
                                )}
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground rounded-md border border-dashed p-3">
                                {t("tunnels.noServerTunnels")}
                              </p>
                            )}
                          </div>
                        </FormControl>
                      </FormItem>
                    );
                  }}
                />
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
