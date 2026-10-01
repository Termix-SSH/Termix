import { toast } from "sonner";
import type {
  PluginApiClient,
  PluginHostRecord,
  TermixApp,
} from "@termix/plugin-sdk/frontend";

export function macAddressOf(
  host: Pick<PluginHostRecord, "pluginSettings"> | null | undefined,
): string | null {
  const macAddress = host?.pluginSettings?.["wake-on-lan"]?.macAddress;
  return typeof macAddress === "string" && macAddress.trim()
    ? macAddress.trim()
    : null;
}

export function hasMacAddress(
  host: Pick<PluginHostRecord, "pluginSettings">,
): boolean {
  return macAddressOf(host) !== null;
}

function errorMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { error?: string } } })
    ?.response?.data?.error;
  return message ?? fallback;
}

export function wakeHost(
  api: PluginApiClient,
  t: TermixApp["t"],
  hostId: string,
): void {
  void api
    .post(`/host/${hostId}/wake`)
    .then(() => toast.success(t("hostAction.sent")))
    .catch((error: unknown) => {
      toast.error(errorMessage(error, t("hostAction.failed")));
    });
}
