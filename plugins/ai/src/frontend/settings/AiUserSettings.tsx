import { useEffect, useState } from "react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import { FakeSwitch, SettingRow } from "@termix/plugin-sdk/ui";
import { saveUserPreferences } from "@/main-axios";
import { readHiddenRailTabs } from "@/sidebar/hidden-rail-tabs";
import { getAiStatus } from "../ai-api";
import { notifyAiStatusChanged } from "../use-ai-availability";

/** The rail id the assistant registers under. */
export const AI_RAIL_ID = "ai";

/**
 * Turns the assistant on or off for one person. Off also hides its rail
 * entry, so declining removes the feature from view rather than leaving an
 * inert button behind. Stored in core user preferences, where it has always
 * lived, so it roams with the rest of a user's settings.
 */
export function setAssistantEnabledForUser(enabled: boolean): void {
  const hidden = readHiddenRailTabs();
  if (enabled) hidden.delete(AI_RAIL_ID);
  else hidden.add(AI_RAIL_ID);

  const serialized = JSON.stringify([...hidden]);
  localStorage.setItem("hiddenRailTabs", serialized);
  window.dispatchEvent(new Event("hiddenRailTabsChanged"));

  saveUserPreferences({
    aiAssistantEnabled: enabled,
    hiddenRailTabs: serialized,
  })
    .catch(() => {
      // The local choice still applies if the write fails.
    })
    .finally(() => notifyAiStatusChanged());
}

export function AiUserSettings() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<{
    globallyEnabled: boolean;
    enabled: boolean;
    readOnly: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAiStatus()
      .then((next) => {
        if (!cancelled) {
          setStatus({
            globallyEnabled: next.globallyEnabled,
            enabled: next.enabled,
            readOnly: next.allowReadOnlyCommands,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus({
            globallyEnabled: false,
            enabled: false,
            readOnly: false,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A user who cannot have the feature is not told about it.
  if (!status?.globallyEnabled) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("settings.assistantUnavailable")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <SettingRow
        label={t("ai.enableTitle")}
        description={t("ai.enableDescription")}
      >
        <FakeSwitch
          checked={status.enabled}
          onChange={(enabled) => {
            setStatus({ ...status, enabled });
            setAssistantEnabledForUser(enabled);
          }}
        />
      </SettingRow>
      {status.enabled && (
        <SettingRow
          label={t("ai.readOnlyCommands")}
          description={t("ai.readOnlyCommandsDescription")}
        >
          <FakeSwitch
            checked={status.readOnly}
            onChange={(readOnly) => {
              setStatus({ ...status, readOnly });
              saveUserPreferences({ aiReadOnlyCommands: readOnly }).catch(
                () => {},
              );
            }}
          />
        </SettingRow>
      )}
    </div>
  );
}
