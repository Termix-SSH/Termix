import { useState } from "react";
import { toast } from "sonner";
import { Button, Input } from "@termix/plugin-sdk/ui";
import {
  usePluginApi,
  useTranslation,
  type SettingsComponentProps,
} from "@termix/plugin-sdk/frontend";

interface TestResult {
  mode: string;
  connected: boolean;
  remoteSftpAvailable: boolean;
  localHostVisible: boolean | null;
  selectedMode: "local" | "remote-sftp" | "unavailable";
  localMappingConfigured: boolean;
}

const SELECTED_MODE_LABEL_KEYS: Record<TestResult["selectedMode"], string> = {
  local: "settings.admin.imageStorageMode.local",
  "remote-sftp": "settings.admin.imageStorageMode.remoteSftp",
  unavailable: "imageStorage.selectedModeUnavailable",
};

/**
 * Checks which storage an image upload would use for one of the admin's own
 * connected terminals, against the saved settings.
 */
export function ImageStorageTest(_props: SettingsComponentProps) {
  const { t } = useTranslation();
  const api = usePluginApi();
  const [instanceId, setInstanceId] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const { data } = await api.post<TestResult>("/image-storage/test", {
        instanceId: instanceId.trim(),
      });
      setResult(data);
    } catch {
      toast.error(t("imageStorage.testFailed"));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium leading-snug">
          {t("imageStorage.instanceId")}
        </span>
        <span className="text-xs text-muted-foreground leading-snug">
          {t("imageStorage.instanceIdDesc")}
        </span>
      </div>
      <Input
        aria-label={t("imageStorage.instanceId")}
        value={instanceId}
        onChange={(event) => setInstanceId(event.target.value)}
        className="h-8 w-full @md:w-64 text-xs"
      />
      {result && (
        <div className="text-xs text-muted-foreground">
          <div>
            {result.connected
              ? t("imageStorage.testConnected")
              : t("imageStorage.testNotConnected")}
          </div>
          <div>
            {t("imageStorage.testSelectedMode", {
              mode: t(SELECTED_MODE_LABEL_KEYS[result.selectedMode]),
            })}
          </div>
          {result.localHostVisible !== null && (
            <div>
              {result.localHostVisible
                ? t("imageStorage.testLocalVisible")
                : t("imageStorage.testLocalNotVisible")}
            </div>
          )}
        </div>
      )}
      <div>
        <Button
          size="sm"
          variant="outline"
          disabled={testing || !instanceId.trim()}
          onClick={() => void runTest()}
        >
          {testing ? t("imageStorage.testing") : t("imageStorage.test")}
        </Button>
      </div>
    </div>
  );
}
