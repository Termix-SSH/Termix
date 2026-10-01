import { useEffect, useState } from "react";
import {
  useToast,
  useTranslation,
  type HostDraft,
} from "@termix/plugin-sdk/frontend";
import { Copy, Loader2, Plus, RefreshCw, Terminal } from "lucide-react";
import { Button } from "@termix/plugin-sdk/ui";
import { Input } from "@termix/plugin-sdk/ui";
import type { PluginHostRecord as Host } from "@termix/plugin-sdk/frontend";
import { getTailscaleDevices } from "./tailscale-api";
import { createQuickConnectHost } from "@termix/plugin-sdk/ui";

interface TailscaleDevice {
  id: string;
  name: string;
  hostname: string;
  addresses: string[];
  os: string;
  lastSeen: string;
}

interface TailscaleDevicesPanelProps {
  onConnect: (host: Host, type: "terminal") => void;
  /** Absent when the shell cannot open the host editor. */
  onAddHost?: (draft: HostDraft) => void;
}

function deviceIp(device: TailscaleDevice): string {
  return (
    device.addresses.find((a) => a.startsWith("100.")) ??
    device.addresses[0] ??
    ""
  );
}

export function TailscaleDevicesPanel({
  onConnect,
  onAddHost,
}: TailscaleDevicesPanelProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [devices, setDevices] = useState<TailscaleDevice[]>([]);
  const [hasApiKey, setHasApiKey] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [usernames, setUsernames] = useState<Record<string, string>>({});

  function load() {
    setLoading(true);
    setError(false);
    getTailscaleDevices()
      .then((res) => {
        setDevices(res.devices);
        setHasApiKey(res.hasApiKey);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function usernameFor(device: TailscaleDevice): string {
    return usernames[device.id]?.trim() || "root";
  }

  function copyIp(ip: string) {
    navigator.clipboard
      ?.writeText(ip)
      .then(() => toast.success(t("hosts.tailscaleIpCopied")))
      .catch(() => toast.error(t("hosts.tailscaleIpCopyFailed")));
  }

  function addHost(device: TailscaleDevice) {
    const ip = deviceIp(device);
    if (!ip || !onAddHost) return;
    onAddHost({
      name: device.hostname || device.name,
      ip,
      port: 22,
      username: usernameFor(device),
      authType: "tailscale",
    });
  }

  function connect(device: TailscaleDevice) {
    const ip = deviceIp(device);
    if (!ip) return;
    const username = usernameFor(device);
    const host = createQuickConnectHost({
      ip,
      port: 22,
      username,
      authType: "tailscale",
    }) as unknown as Host;
    onConnect(host, "terminal");
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {t("nav.tailscale")}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:text-foreground"
          onClick={load}
          disabled={loading}
        >
          <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="flex flex-col gap-2 p-3">
        {loading && (
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {t("hosts.tailscaleLoadingDevices")}
          </div>
        )}

        {!loading && !hasApiKey && (
          <p className="text-[10px] text-muted-foreground">
            {t("hosts.tailscaleNoApiKey")}
          </p>
        )}

        {!loading && hasApiKey && error && (
          <p className="text-[10px] text-muted-foreground">
            {t("hosts.tailscaleDeviceLoadFailed")}
          </p>
        )}

        {!loading && hasApiKey && !error && devices.length === 0 && (
          <p className="text-[10px] text-muted-foreground">
            {t("hosts.tailscaleNoDevices")}
          </p>
        )}

        {!loading &&
          hasApiKey &&
          !error &&
          devices.map((device) => {
            const ip = deviceIp(device);
            return (
              <div
                key={device.id}
                className="flex flex-col gap-1.5 border border-border p-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-semibold min-w-0 break-all">
                    {device.hostname || device.name}
                  </span>
                  {device.os && (
                    <span className="shrink-0 border border-border px-1 text-[10px] text-muted-foreground">
                      {device.os}
                    </span>
                  )}
                </div>
                {ip && (
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {ip}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-5 text-muted-foreground hover:text-foreground"
                      title={t("hosts.tailscaleCopyIp")}
                      aria-label={t("hosts.tailscaleCopyIp")}
                      onClick={() => copyIp(ip)}
                    >
                      <Copy className="size-3" />
                    </Button>
                  </div>
                )}
                <Input
                  placeholder={t("newUi.sidebar.quickConnect.usernameLabel")}
                  value={usernames[device.id] ?? "root"}
                  onChange={(e) =>
                    setUsernames((prev) => ({
                      ...prev,
                      [device.id]: e.target.value,
                    }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") connect(device);
                  }}
                  className="h-7 text-xs"
                />
                <div className="flex gap-1.5">
                  <Button
                    onClick={() => connect(device)}
                    disabled={!ip}
                    className="flex flex-1 items-center justify-center gap-1.5 h-7 border border-accent-brand/40 bg-accent-brand/10 text-accent-brand text-xs font-semibold hover:bg-accent-brand/20 transition-colors"
                    variant="outline"
                  >
                    <Terminal className="size-3.5" />
                    {t("newUi.sidebar.quickConnect.connectToTerminal")}
                  </Button>
                  {onAddHost && (
                    <Button
                      onClick={() => addHost(device)}
                      disabled={!ip}
                      variant="outline"
                      className="h-7 gap-1 text-xs shrink-0"
                    >
                      <Plus className="size-3.5" />
                      {t("hosts.tailscaleAddHost")}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

export default TailscaleDevicesPanel;
