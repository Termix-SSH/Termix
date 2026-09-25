import { toast } from "sonner";
import {
  useTranslation,
  type SettingsComponentProps,
} from "@termix/plugin-sdk/frontend";
import { Button, Input, copyToClipboard } from "@termix/plugin-sdk/ui";

const CALLBACK_PATH = "plugin-api/opkssh/callback";
const LEGACY_CALLBACK_PATH = "host/opkssh-callback";

/** The public callback URI to register with the identity provider. */
export function redirectUri(
  legacy: boolean,
  baseUri = document.baseURI,
): string {
  return new URL(
    legacy ? LEGACY_CALLBACK_PATH : CALLBACK_PATH,
    baseUri,
  ).toString();
}

export function RedirectUriSetting({ values }: SettingsComponentProps) {
  const { t } = useTranslation();
  const uri = redirectUri(values.legacyCallback === true);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium">
        {t("settings.redirectUri.label")}
      </span>
      <div className="flex gap-2">
        <Input
          value={uri}
          readOnly
          className="min-w-0 flex-1 rounded-none font-mono text-xs"
        />
        <Button
          type="button"
          variant="outline"
          className="rounded-none"
          onClick={async () => {
            if (await copyToClipboard(uri)) toast.success(t("common.copied"));
            else toast.error(t("common.copyFailed"));
          }}
        >
          {t("common.copy")}
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        {t("settings.redirectUri.description")}
      </p>
    </div>
  );
}
