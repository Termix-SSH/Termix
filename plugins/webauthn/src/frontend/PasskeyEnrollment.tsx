import { useEffect, useMemo, useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Input, Select2 } from "@termix/plugin-sdk/ui";
import { usePluginApi, useTranslation } from "@termix/plugin-sdk/frontend";
import {
  createWebAuthnApi,
  type WebAuthnCredentialSummary,
  type WebAuthnUserVerification,
} from "./webauthn-api";

function apiErrorMessage(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: { error?: unknown } } })
    ?.response?.data;
  return typeof data?.error === "string" && data.error ? data.error : fallback;
}

/** Settings > Security: register and remove passkeys. */
export function PasskeyEnrollment() {
  const { t } = useTranslation();
  const pluginApi = usePluginApi();
  const api = useMemo(() => createWebAuthnApi(pluginApi), [pluginApi]);
  const [passkeys, setPasskeys] = useState<WebAuthnCredentialSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [userVerification, setUserVerification] =
    useState<WebAuthnUserVerification>("preferred");

  useEffect(() => {
    api
      .list()
      .then(setPasskeys)
      .catch(() => {});
  }, [api]);

  async function add() {
    setLoading(true);
    try {
      await api.register(name || t("defaultName"), userVerification);
      setPasskeys(await api.list());
      setName("");
      toast.success(t("added"));
    } catch (e) {
      toast.error(apiErrorMessage(e, t("addFailed")));
    } finally {
      setLoading(false);
    }
  }

  async function remove(id: string) {
    setLoading(true);
    try {
      await api.remove(id);
      setPasskeys((prev) => prev.filter((item) => item.id !== id));
      toast.success(t("deleted"));
    } catch (e) {
      toast.error(apiErrorMessage(e, t("deleteFailed")));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="text-[10px] text-muted-foreground">
        {t("description")}
      </span>

      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Input
          placeholder={t("namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-8 text-xs"
          disabled={loading}
        />
        <Select2
          value={userVerification}
          onChange={(e) =>
            setUserVerification(e.target.value as WebAuthnUserVerification)
          }
          className="h-8 w-28 text-xs border border-border bg-background px-2 outline-none focus:ring-1 focus:ring-ring"
          disabled={loading}
        >
          <option value="preferred">{t("uv.preferred")}</option>
          <option value="required">{t("uv.required")}</option>
          <option value="discouraged">{t("uv.discouraged")}</option>
        </Select2>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-[10px] border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
        onClick={add}
        disabled={loading}
      >
        <KeyRound className="size-3" />
        {t("add")}
      </Button>

      <div className="flex flex-col divide-y divide-border border border-border">
        {passkeys.length === 0 ? (
          <div className="py-4 text-center text-[10px] text-muted-foreground">
            {t("none")}
          </div>
        ) : (
          passkeys.map((passkey) => (
            <div
              key={passkey.id}
              className="flex items-center justify-between gap-2 px-2 py-2"
            >
              <div className="min-w-0 flex flex-col">
                <span className="text-xs font-medium truncate">
                  {passkey.name}
                </span>
                <span className="text-[10px] text-muted-foreground truncate">
                  {passkey.deviceType || t("unknownDevice")}
                  {passkey.backedUp ? ` / ${t("synced")}` : ""}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground hover:text-destructive"
                onClick={() => remove(passkey.id)}
                disabled={loading}
                aria-label={t("delete")}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
