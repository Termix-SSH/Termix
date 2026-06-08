import { useState } from "react";
import { ShieldCheck, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { StatRow } from "@/components/charts";
import { managerPost } from "@/main-axios";
import { useManagerData, extractError } from "./useManagerData";
import { ManagerCardShell } from "./ManagerCardShell";

interface CertInfo {
  client: string;
  name: string;
  domains: string[];
  expiry: string | null;
}
interface SslData {
  clients: { certbot: boolean; acmeSh: boolean };
  certs: CertInfo[];
}

export function SslManagerCard({ hostId }: { hostId: number | null }) {
  const { t } = useTranslation();
  const { data, loading, error, refresh } = useManagerData<SslData>(
    hostId,
    "ssl",
  );
  const [busy, setBusy] = useState(false);

  const renew = async (client: "certbot" | "acme.sh", dryRun: boolean) => {
    if (hostId == null) return;
    setBusy(true);
    toast.loading(t("hostMetrics.managers.working"), { id: "ssl-op" });
    try {
      const res = await managerPost<{ success: boolean; output: string }>(
        hostId,
        "ssl",
        { client, dryRun },
        "renew",
      );
      toast[res.success ? "success" : "error"](
        res.success
          ? t("hostMetrics.managers.actionDone", { name: "renew" })
          : t("hostMetrics.managers.actionFailed"),
        { id: "ssl-op", description: res.output?.slice(-200) },
      );
      if (res.success) refresh();
    } catch (e) {
      toast.error(extractError(e).message, { id: "ssl-op" });
    } finally {
      setBusy(false);
    }
  };

  const clients = data?.clients;
  const activeClient: "certbot" | "acme.sh" | null = clients?.certbot
    ? "certbot"
    : clients?.acmeSh
      ? "acme.sh"
      : null;

  return (
    <ManagerCardShell
      title={t("hostMetrics.managers.ssl")}
      icon={<ShieldCheck className="size-3.5" />}
      loading={loading}
      error={error}
      onRefresh={refresh}
      empty={!loading && (data?.certs?.length ?? 0) === 0 && !activeClient}
      emptyMessage={t("hostMetrics.managers.noAcmeClient")}
      headerExtra={
        activeClient ? (
          <>
            <Button
              variant="ghost"
              size="xs"
              disabled={busy}
              onClick={() => renew(activeClient, true)}
            >
              {t("hostMetrics.managers.dryRun")}
            </Button>
            <Button
              variant="outline"
              size="xs"
              disabled={busy}
              onClick={() => renew(activeClient, false)}
            >
              <RefreshCw className="size-3" />
              {t("hostMetrics.managers.renew")}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
        <span>{t("hostMetrics.managers.clients")}:</span>
        <span className={clients?.certbot ? "text-accent-brand" : ""}>
          certbot
        </span>
        <span className={clients?.acmeSh ? "text-accent-brand" : ""}>
          acme.sh
        </span>
      </div>
      <div className="flex flex-col divide-y divide-border">
        {(data?.certs ?? []).map((c) => (
          <StatRow
            key={`${c.client}-${c.name}`}
            label={
              <span className="truncate" title={c.domains.join(", ")}>
                {c.name}
              </span>
            }
            value={c.expiry ?? "—"}
            mono
          />
        ))}
      </div>
    </ManagerCardShell>
  );
}
