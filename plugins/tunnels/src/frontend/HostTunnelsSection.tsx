import { useEffect, useState } from "react";
import { Network, Plus } from "lucide-react";
import {
  useHosts,
  useToast,
  useTranslation,
  type HostEditorSectionProps,
} from "@termix/plugin-sdk/frontend";
import {
  Button,
  FakeSwitch,
  Input,
  SectionCard,
  SettingRow,
} from "@termix/plugin-sdk/ui";
import type { TunnelConnection } from "../shared/types";
import { serverTunnelName } from "../shared/tunnel-naming";
import {
  connectTunnel,
  disconnectTunnel,
  subscribeTunnelStatuses,
  type TunnelStatusMap,
} from "./api";
import {
  connectRequestFor,
  parseConnections,
  tunnelMode,
} from "./host-tunnels";

type PluginSettingsForm = Record<string, Record<string, unknown>>;

function newTunnel(): TunnelConnection {
  return {
    scope: "s2s",
    mode: "local",
    sourcePort: 8080,
    endpointHost: "",
    endpointPort: 80,
    bindHost: "127.0.0.1",
    maxRetries: 3,
    retryInterval: 10,
    autoStart: false,
  };
}

const MODE_DESCRIPTION_KEYS = {
  local: "hosts.tunnelModeLocalDesc",
  remote: "hosts.tunnelModeRemoteDesc",
  dynamic: "hosts.tunnelModeDynamicDesc",
} as const;

const numberInputClass =
  "h-7 text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

/**
 * The host editor's Tunnels tab. Writes into the form's pluginSettings for
 * this plugin, which the editor saves through the plugin's host settings
 * route after the host itself.
 */
export function HostTunnelsSection({
  form,
  updateForm,
  host,
}: HostEditorSectionProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const { hosts } = useHosts();
  const [statuses, setStatuses] = useState<TunnelStatusMap>({});
  const [busyIndex, setBusyIndex] = useState<number | null>(null);

  useEffect(() => subscribeTunnelStatuses(setStatuses), []);

  const settings = ((form?.pluginSettings as PluginSettingsForm | undefined)
    ?.tunnels ?? {}) as Record<string, unknown>;
  const enabled = settings.enableTunnel === true;
  const tunnels = parseConnections(settings.tunnelConnections);

  const setSettings = (patch: Record<string, unknown>) =>
    updateForm((current) => {
      const all = (current.pluginSettings ?? {}) as PluginSettingsForm;
      return {
        ...current,
        pluginSettings: {
          ...all,
          tunnels: { ...(all.tunnels ?? {}), ...patch },
        },
      };
    });

  const setTunnels = (next: TunnelConnection[]) =>
    setSettings({ tunnelConnections: next });

  const updateTunnel = (index: number, patch: Partial<TunnelConnection>) =>
    setTunnels(
      tunnels.map((tunnel, i) =>
        i === index ? { ...tunnel, ...patch } : tunnel,
      ),
    );

  const sourceHost = host
    ? {
        id: host.id,
        name: (form?.name as string) || host.name,
        username: (form?.username as string) || host.username,
        ip: (form?.ip as string) || host.ip,
      }
    : null;

  const toggle = async (index: number, connected: boolean) => {
    if (!sourceHost) return;
    const tunnel = tunnels[index];
    setBusyIndex(index);
    try {
      if (connected) {
        await disconnectTunnel(serverTunnelName(sourceHost, index, tunnel));
        toast.success(t("hosts.tunnelDisconnected"));
      } else {
        await connectTunnel(connectRequestFor(sourceHost, index, tunnel));
        toast.success(t("hosts.tunnelConnecting"));
      }
    } catch {
      toast.error(
        connected
          ? t("hosts.failedToDisconnectTunnel")
          : t("hosts.failedToConnectTunnel"),
      );
    } finally {
      setBusyIndex(null);
    }
  };

  return (
    <>
      <SectionCard
        title={t("hosts.tunnelSettings")}
        icon={<Network className="size-3.5" />}
      >
        <div className="flex flex-col gap-4 py-3">
          <SettingRow
            label={t("hosts.enableTunneling")}
            description={
              <>
                {t("hosts.enableTunnelingDesc")}{" "}
                <a
                  href="https://docs.termix.site/features/networking/tunnels"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent-brand hover:underline"
                >
                  {t("hosts.docsLink")}
                </a>
              </>
            }
          >
            <FakeSwitch
              checked={enabled}
              onChange={(value) => setSettings({ enableTunnel: value })}
            />
          </SettingRow>
          <div className="text-xs text-muted-foreground p-3 bg-muted/30 border border-border space-y-1">
            <p>{t("hosts.tunnelRequirementsText")}</p>
          </div>
        </div>
      </SectionCard>
      <SectionCard
        title={t("hosts.serverTunnelsSection")}
        icon={<Network className="size-3.5" />}
        action={
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[10px] px-2 border-accent-brand/40 text-accent-brand"
            onClick={() => setTunnels([...tunnels, newTunnel()])}
          >
            <Plus className="size-3 mr-1" /> {t("hosts.addTunnelBtn")}
          </Button>
        }
      >
        <div className="flex flex-col gap-3 py-3">
          {tunnels.length === 0 && (
            <p className="text-[10px] text-muted-foreground/50 px-1">
              {t("hosts.noTunnelsConfigured")}
            </p>
          )}
          {tunnels.map((tunnel, i) => {
            const mode = tunnelMode(tunnel);
            const endpointInputId = `server-tunnel-endpoint-${host?.id ?? "new"}-${i}`;
            const status = sourceHost
              ? statuses[serverTunnelName(sourceHost, i, tunnel)]?.status
              : undefined;
            const isConnected = status === "connected";
            return (
              <div
                key={i}
                className="flex flex-col gap-3 p-3 border border-border bg-muted/20 relative group"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-muted-foreground">
                      {t("hosts.tunnelLabel", { number: i + 1 })}
                    </span>
                    <div
                      className={`size-1.5 rounded-full shrink-0 ${
                        isConnected
                          ? "bg-accent-brand shadow-[0_0_4px_rgba(251,146,60,0.4)]"
                          : status === "failed"
                            ? "bg-red-400"
                            : "bg-muted-foreground/25"
                      }`}
                      title={status ?? t("tunnels.disconnected")}
                    />
                    {sourceHost && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyIndex === i}
                        className={`h-6 text-[10px] px-2 ${isConnected ? "border-destructive/40 text-destructive hover:bg-destructive/10" : "border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10"}`}
                        onClick={() => toggle(i, isConnected)}
                      >
                        {busyIndex === i
                          ? "..."
                          : isConnected
                            ? t("hosts.disconnectBtn")
                            : t("hosts.connectBtn")}
                      </Button>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] px-2 text-destructive"
                    onClick={() =>
                      setTunnels(tunnels.filter((_, idx) => idx !== i))
                    }
                  >
                    {t("common.delete")}
                  </Button>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold text-muted-foreground">
                    {t("hosts.tunnelType")}
                  </label>
                  <div className="flex gap-2">
                    {(["remote", "local", "dynamic"] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => updateTunnel(i, { mode: m })}
                        className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border transition-colors ${mode === m ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand" : "border-border text-muted-foreground hover:text-foreground"}`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                    {t(MODE_DESCRIPTION_KEYS[mode])}
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {mode !== "dynamic" && (
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-muted-foreground">
                        {t("hosts.endpointHost")}
                      </label>
                      <Input
                        className="h-7 text-xs border border-border bg-background px-2 outline-none focus:ring-1 focus:ring-ring"
                        list={endpointInputId}
                        placeholder={t("hosts.endpointHostPlaceholder")}
                        value={tunnel.endpointHost ?? ""}
                        onChange={(e) =>
                          updateTunnel(i, { endpointHost: e.target.value })
                        }
                      />
                      <datalist id={endpointInputId}>
                        {hosts
                          .filter((h) => h.enableSsh !== false)
                          .map((h) => (
                            <option key={h.id} value={h.ip}>
                              {h.name || h.ip} ({h.ip})
                            </option>
                          ))}
                      </datalist>
                    </div>
                  )}
                  {mode !== "dynamic" && (
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-muted-foreground">
                        {t("hosts.endpointPort")}
                      </label>
                      <Input
                        className={numberInputClass}
                        type="number"
                        value={tunnel.endpointPort}
                        onChange={(e) =>
                          updateTunnel(i, {
                            endpointPort: Number(e.target.value),
                          })
                        }
                      />
                    </div>
                  )}
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-muted-foreground">
                      {t("hosts.bindHost")}
                    </label>
                    <Input
                      className="h-7 text-xs"
                      placeholder="127.0.0.1"
                      value={tunnel.bindHost ?? ""}
                      onChange={(e) =>
                        updateTunnel(i, { bindHost: e.target.value })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-muted-foreground">
                      {t("hosts.sourcePort")}
                    </label>
                    <Input
                      className={numberInputClass}
                      type="number"
                      value={tunnel.sourcePort}
                      onChange={(e) =>
                        updateTunnel(i, { sourcePort: Number(e.target.value) })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-muted-foreground">
                      {t("hosts.maxRetries")}
                    </label>
                    <Input
                      className={numberInputClass}
                      type="number"
                      value={tunnel.maxRetries}
                      onChange={(e) =>
                        updateTunnel(i, { maxRetries: Number(e.target.value) })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-muted-foreground">
                      {t("hosts.retryIntervalS")}
                    </label>
                    <Input
                      className={numberInputClass}
                      type="number"
                      value={tunnel.retryInterval}
                      onChange={(e) =>
                        updateTunnel(i, {
                          retryInterval: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                </div>
                <SettingRow
                  label={t("hosts.autoStartLabel")}
                  description={t("hosts.autoStartDesc")}
                >
                  <FakeSwitch
                    checked={tunnel.autoStart}
                    onChange={(value) => updateTunnel(i, { autoStart: value })}
                  />
                </SettingRow>
              </div>
            );
          })}
        </div>
      </SectionCard>
    </>
  );
}
