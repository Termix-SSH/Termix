import { useEffect, useState } from "react";
import { useToast, useTranslation } from "@termix/plugin-sdk/frontend";
import { FakeSwitch, Input, SettingRow } from "@termix/plugin-sdk/ui";
import {
  getAiGloballyEnabled,
  getAiPrivateEndpoints,
  setAiGloballyEnabled,
  setAiPrivateEndpoints,
} from "../ai-api";
import { notifyAiStatusChanged } from "../use-ai-availability";

/**
 * The instance-wide switch and the private address allowlist. Stored in the
 * assistant's own backend rather than plugin settings, so this saves on
 * change instead of through the page's Save.
 */
export function AiAccessSettings() {
  const { t } = useTranslation();
  const toast = useToast();
  const [enabled, setEnabled] = useState(false);
  const [endpoints, setEndpoints] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([
      getAiGloballyEnabled(),
      getAiPrivateEndpoints(),
    ]).then(([enabledResult, endpointsResult]) => {
      if (cancelled) return;
      if (enabledResult.status === "fulfilled") setEnabled(enabledResult.value);
      setEndpoints(
        endpointsResult.status === "fulfilled" ? endpointsResult.value : [],
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (next: boolean) => {
    setEnabled(next);
    try {
      await setAiGloballyEnabled(next);
      notifyAiStatusChanged();
    } catch {
      setEnabled(!next);
      toast.error(t("admin.updateAiEnabledFailed"));
    }
  };

  const saveEndpoints = async (hosts: string[]) => {
    const previous = endpoints ?? [];
    setEndpoints(hosts);
    try {
      setEndpoints(await setAiPrivateEndpoints(hosts));
    } catch {
      setEndpoints(previous);
      toast.error(t("admin.updateAiEndpointsFailed"));
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <SettingRow
        label={t("admin.aiGloballyEnabled")}
        description={t("admin.aiGloballyEnabledDesc")}
      >
        <FakeSwitch checked={enabled} onChange={(next) => void toggle(next)} />
      </SettingRow>
      {enabled && endpoints !== null && (
        <div className="flex flex-col gap-1.5 py-2">
          <span className="text-xs font-medium">
            {t("admin.aiPrivateEndpoints")}
          </span>
          <span className="text-[11px] leading-snug text-muted-foreground">
            {t("admin.aiPrivateEndpointsDesc")}
          </span>
          <Input
            className="rounded-none"
            defaultValue={endpoints.join(", ")}
            placeholder="localhost, 127.0.0.1"
            onBlur={(event) =>
              void saveEndpoints(
                event.target.value
                  .split(",")
                  .map((entry) => entry.trim())
                  .filter(Boolean),
              )
            }
          />
        </div>
      )}
    </div>
  );
}
