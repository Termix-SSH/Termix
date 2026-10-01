import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/input";
import { PasswordInput } from "@/components/password-input";
import { Switch } from "@/components/switch";
import type { SyncBasicAuth, SyncProxyHeader } from "@/api/sync-api";

interface ProxySettingsFieldsProps {
  customHeaders: SyncProxyHeader[];
  basicAuth: SyncBasicAuth | null;
  onChange: (next: {
    customHeaders?: SyncProxyHeader[];
    basicAuth?: SyncBasicAuth | null;
  }) => void;
}

/**
 * What a reverse proxy in front of the server wants: extra headers (a
 * Cloudflare Access service token, a gateway key) and basic auth.
 */
export function ProxySettingsFields({
  customHeaders,
  basicAuth,
  onChange,
}: ProxySettingsFieldsProps) {
  const { t } = useTranslation();

  const setHeader = (index: number, patch: Partial<SyncProxyHeader>) => {
    onChange({
      customHeaders: customHeaders.map((header, i) =>
        i === index ? { ...header, ...patch } : header,
      ),
    });
  };

  return (
    <div className="flex flex-col gap-4 border border-border p-3">
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold">
            {t("sync.proxy.headersTitle")}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {t("sync.proxy.headersHint")}
          </span>
        </div>
        {customHeaders.map((header, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              className="rounded-none h-8 text-xs"
              placeholder={t("sync.proxy.headerName")}
              value={header.name}
              onChange={(event) =>
                setHeader(index, { name: event.target.value })
              }
            />
            <PasswordInput
              className="rounded-none h-8 text-xs"
              placeholder={
                header.set
                  ? t("sync.proxy.savedValue")
                  : t("sync.proxy.headerValue")
              }
              value={header.value}
              onChange={(event) =>
                setHeader(index, { value: event.target.value })
              }
            />
            <button
              type="button"
              aria-label={t("sync.proxy.removeHeader")}
              className="p-1.5 text-muted-foreground hover:text-destructive"
              onClick={() =>
                onChange({
                  customHeaders: customHeaders.filter((_, i) => i !== index),
                })
              }
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="self-start flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground"
          onClick={() =>
            onChange({
              customHeaders: [...customHeaders, { name: "", value: "" }],
            })
          }
        >
          <Plus className="size-3" />
          {t("sync.proxy.addHeader")}
        </button>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-semibold">
              {t("sync.proxy.basicAuthTitle")}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {t("sync.proxy.basicAuthHint")}
            </span>
          </div>
          <Switch
            checked={!!basicAuth}
            onCheckedChange={(checked) =>
              onChange({
                basicAuth: checked ? { username: "", password: "" } : null,
              })
            }
          />
        </div>
        {basicAuth && (
          <div className="flex items-center gap-2">
            <Input
              className="rounded-none h-8 text-xs"
              placeholder={t("sync.proxy.username")}
              value={basicAuth.username}
              onChange={(event) =>
                onChange({
                  basicAuth: { ...basicAuth, username: event.target.value },
                })
              }
            />
            <PasswordInput
              className="rounded-none h-8 text-xs"
              placeholder={
                basicAuth.set
                  ? t("sync.proxy.savedValue")
                  : t("sync.proxy.password")
              }
              value={basicAuth.password}
              onChange={(event) =>
                onChange({
                  basicAuth: { ...basicAuth, password: event.target.value },
                })
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
