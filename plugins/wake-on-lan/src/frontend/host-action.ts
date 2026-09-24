import { toast } from "sonner";
import type { PluginApiClient, TermixApp } from "@termix/plugin-sdk/frontend";

export function hasMacAddress(host: Record<string, unknown>): boolean {
  const settings = host.pluginSettings as
    Record<string, Record<string, unknown>> | undefined;
  const macAddress = settings?.["wake-on-lan"]?.macAddress;
  return typeof macAddress === "string" && macAddress.trim().length > 0;
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
