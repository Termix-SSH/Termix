import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  usePluginApi,
  useTranslation,
  type SettingsComponentProps,
} from "@termix/plugin-sdk/frontend";
import { Button } from "@termix/plugin-sdk/ui";

export interface AcmeStatus {
  tls: {
    enabled: boolean;
    certificate: {
      issuer: string;
      names: string[];
      notAfter: string;
      selfSigned: boolean;
    } | null;
  };
  state: {
    lastAttemptAt: string | null;
    lastIssuedAt: string | null;
    lastError: string | null;
  };
  autoRenew: boolean;
  missing: string | null;
}

function errorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { error?: string } } })?.response
    ?.data;
  if (data?.error) return data.error;
  return error instanceof Error ? error.message : String(error);
}

export function AcmeStatusSetting({ running }: SettingsComponentProps) {
  const { t } = useTranslation();
  const api = usePluginApi();
  const [status, setStatus] = useState<AcmeStatus | null>(null);
  const [requesting, setRequesting] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<AcmeStatus>("/status");
      setStatus(data);
    } catch {
      setStatus(null);
    }
  }, [api]);

  useEffect(() => {
    if (running) void load();
  }, [running, load]);

  async function request() {
    setRequesting(true);
    try {
      const { data } = await api.post<{ reloadMessage?: string }>("/request");
      toast.success(t("status.issued"));
      if (data.reloadMessage) toast.info(data.reloadMessage);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setRequesting(false);
      await load();
    }
  }

  const cert = status?.tls.certificate;

  return (
    <div className="flex flex-col gap-2 border border-border bg-background/50 p-2">
      <span className="text-xs font-medium">{t("status.title")}</span>
      {cert ? (
        <>
          <span className="text-[10px] text-muted-foreground">
            {t("status.names", { names: cert.names.join(", ") || "-" })}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {t("status.issuer", { issuer: cert.issuer })}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {t("status.expires", {
              date: new Date(cert.notAfter).toLocaleDateString(),
            })}
          </span>
        </>
      ) : (
        <span className="text-[10px] text-muted-foreground">
          {t("status.none")}
        </span>
      )}
      {status?.state.lastIssuedAt && (
        <span className="text-[10px] text-muted-foreground">
          {t("status.lastIssued", {
            date: new Date(status.state.lastIssuedAt).toLocaleString(),
          })}
        </span>
      )}
      {status?.state.lastError && (
        <span className="text-[10px] text-destructive">
          {t("status.lastError", { error: status.state.lastError })}
        </span>
      )}
      {status?.missing && (
        <span className="text-[10px] text-muted-foreground">
          {t("status.missing")}
        </span>
      )}
      <Button
        type="button"
        variant="outline"
        className="rounded-none self-start"
        disabled={!running || requesting || !!status?.missing}
        onClick={request}
      >
        {requesting ? t("status.requesting") : t("status.request")}
      </Button>
    </div>
  );
}
