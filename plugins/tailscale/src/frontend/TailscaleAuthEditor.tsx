import { useEffect, useState } from "react";
import {
  useTranslation,
  type SshAuthEditorProps,
} from "@termix/plugin-sdk/frontend";
import { Select2 } from "@termix/plugin-sdk/ui";
import { getTailscaleDevices } from "./tailscale-api";

interface Device {
  id: string;
  name: string;
  hostname: string;
  addresses: string[];
  os: string;
  lastSeen: string;
}

function tailnetAddress(device: Device): string {
  return (
    device.addresses.find((address) => address.startsWith("100.")) ??
    device.addresses[0] ??
    ""
  );
}

/**
 * The host editor's "tailscale" auth method: pick a tailnet device and its
 * address fills the host's IP.
 */
export function TailscaleAuthEditor({ form, setField }: SshAuthEditorProps) {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<Device[]>([]);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    getTailscaleDevices()
      .then((result) => {
        if (cancelled) return;
        setDevices(result?.devices ?? []);
        setHasApiKey(result?.hasApiKey ?? false);
        setFailed(!!result?.error);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ip = String(form.ip ?? "");

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {t("hosts.tailscaleDeviceSelect")}
        </label>
        <a
          href="https://docs.termix.site/features/networking/tailscale"
          target="_blank"
          rel="noreferrer"
          className="text-[10px] text-accent-brand hover:underline"
        >
          {t("hosts.tailscaleDocsLink")}
        </a>
      </div>
      {loading ? (
        <p className="text-[10px] text-muted-foreground">
          {t("hosts.tailscaleLoadingDevices")}
        </p>
      ) : failed ? (
        <p className="text-[10px] text-destructive">
          {t("hosts.tailscaleDeviceLoadFailed")}
        </p>
      ) : !hasApiKey ? (
        <p className="text-[10px] text-muted-foreground">
          {t("hosts.tailscaleNoApiKey")}
        </p>
      ) : devices.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">
          {t("hosts.tailscaleNoDevices")}
        </p>
      ) : (
        <>
          <Select2
            className="w-full border border-border bg-background text-foreground text-xs px-2 py-1.5 focus:outline-none focus:border-accent-brand/50"
            value={
              devices.find((device) => device.addresses.includes(ip))?.id ?? ""
            }
            onChange={(event) => {
              const device = devices.find(
                (item) => item.id === event.target.value,
              );
              if (device) setField("ip", tailnetAddress(device));
            }}
          >
            <option value="" disabled>
              {t("hosts.tailscaleDeviceSelectPlaceholder")}
            </option>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.hostname} ({tailnetAddress(device)})
              </option>
            ))}
          </Select2>
          <p className="text-[10px] text-muted-foreground">
            {t("hosts.tailscaleDeviceAutoFill")}
          </p>
        </>
      )}
    </div>
  );
}
