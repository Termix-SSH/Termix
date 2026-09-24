import { useCallback, useEffect, useState } from "react";
import { useSettings, useTranslation } from "@termix/plugin-sdk/frontend";
import { AiProviderSettings } from "../AiProviderSettings";
import {
  AI_STATUS_CHANGED_EVENT,
  getAiProviders,
  getAiStatus,
  type AiProvider,
} from "../ai-api";

/**
 * The "providers" custom field in the plugin's user settings: a list with
 * per-provider forms, which a schema field cannot express.
 */
export function ProvidersSetting() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<{
    globallyEnabled: boolean;
    enabled: boolean;
  } | null>(null);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  // Re-read when the "enabled" switch above this field is saved.
  const optedIn = useSettings("user").values.enabled;

  const load = useCallback(async () => {
    try {
      const next = await getAiStatus();
      setStatus(next);
      if (next.enabled) setProviders(await getAiProviders());
    } catch {
      setStatus({ globallyEnabled: false, enabled: false });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, optedIn]);

  useEffect(() => {
    window.addEventListener(AI_STATUS_CHANGED_EVENT, load);
    return () => window.removeEventListener(AI_STATUS_CHANGED_EVENT, load);
  }, [load]);

  if (status === null) return null;

  if (!status.enabled) {
    return (
      <p className="text-xs text-muted-foreground">
        {status.globallyEnabled
          ? t("settings.providersNeedOptIn")
          : t("settings.assistantUnavailable")}
      </p>
    );
  }

  return (
    <AiProviderSettings providers={providers} onChanged={() => void load()} />
  );
}
