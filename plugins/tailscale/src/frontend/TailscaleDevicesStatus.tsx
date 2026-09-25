/**
 * The tailnet status shown on the Tailscale settings page.
 *
 * Confirms the saved key actually works, which is the question anyone has just
 * after entering one. Connecting to a device stays in the Tailscale rail panel;
 * a settings page is for configuring, not for operating.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/button";
import type { SettingsComponentProps } from "@termix/plugin-sdk/frontend";
import { getTailscaleDevices } from "./tailscale-api";

type Status =
  | { kind: "loading" }
  | { kind: "no-key" }
  | { kind: "error" }
  | { kind: "ok"; count: number };

export function TailscaleDevicesStatus({ running }: SettingsComponentProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  const load = useCallback(async () => {
    if (!running) {
      setStatus({ kind: "no-key" });
      return;
    }
    setStatus({ kind: "loading" });
    try {
      const result = await getTailscaleDevices();
      if (!result.hasApiKey) {
        setStatus({ kind: "no-key" });
        return;
      }
      if (result.error) {
        setStatus({ kind: "error" });
        return;
      }
      setStatus({ kind: "ok", count: result.devices?.length ?? 0 });
    } catch {
      setStatus({ kind: "error" });
    }
  }, [running]);

  useEffect(() => {
    void load();
  }, [load]);

  const label = (key: string) => t(key);

  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <span className="text-sm font-medium leading-snug">
          {label("settings.devices.label")}
        </span>
        <span className="text-xs text-muted-foreground leading-snug">
          {status.kind === "loading" && label("settings.devices.checking")}
          {status.kind === "no-key" && label("settings.devices.noKey")}
          {status.kind === "error" && label("settings.devices.error")}
          {status.kind === "ok" &&
            t("settings.devices.count", {
              count: status.count,
            })}
        </span>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs shrink-0"
        disabled={!running || status.kind === "loading"}
        onClick={() => void load()}
      >
        {status.kind === "loading" ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <RefreshCw className="size-3" />
        )}
        <span className="ml-1.5">{label("settings.devices.refresh")}</span>
      </Button>
    </div>
  );
}
