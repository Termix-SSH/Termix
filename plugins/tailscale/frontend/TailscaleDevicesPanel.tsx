import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, RefreshCw, Terminal } from "lucide-react";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import type { Host } from "@/types/ui-types";
import { getTailscaleDevices } from "./tailscale-api";
import { createQuickConnectHost } from "../../../src/ui/sidebar/quick-connect-host";

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
}: TailscaleDevicesPanelProps) {
  const { t } = useTranslation();
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

  function connect(device: TailscaleDevice) {
    const ip = deviceIp(device);
    if (!ip) return;
    const username = usernames[device.id]?.trim() || "root";
    const host = createQuickConnectHost({
      ip,
      port: 22,
      username,
      authType: "tailscale",
    });
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
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-semibold">
                    {device.hostname || device.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {ip} {device.os ? `· ${device.os}` : ""}
                  </span>
                </div>
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
                <Button
                  onClick={() => connect(device)}
                  disabled={!ip}
                  className="flex items-center justify-center gap-1.5 h-7 w-full border border-accent-brand/40 bg-accent-brand/10 text-accent-brand text-xs font-semibold hover:bg-accent-brand/20 transition-colors"
                  variant="outline"
                >
                  <Terminal className="size-3.5" />
                  {t("newUi.sidebar.quickConnect.connectToTerminal")}
                </Button>
              </div>
            );
          })}
      </div>
    </div>
  );
}

export default TailscaleDevicesPanel;
