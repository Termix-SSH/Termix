import { useMemo, useState } from "react";
import { ShieldCheck, RefreshCw, Plus, X, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import { managerPost } from "@/main-axios";
import {
  useManagerData,
  useManagerAction,
  extractError,
} from "./useManagerData";
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

type Challenge = "http-standalone" | "http-webroot" | "dns";

/** Days until the given expiry string, or null if unparseable. */
function daysUntil(expiry: string | null): number | null {
  if (!expiry) return null;
  const ts = Date.parse(expiry);
  if (Number.isNaN(ts)) return null;
  return Math.round((ts - Date.now()) / 86400000);
}

function ExpiryBadge({ expiry }: { expiry: string | null }) {
  const { t } = useTranslation();
  const days = daysUntil(expiry);
  if (days == null)
    return <span className="text-muted-foreground">{expiry ?? "—"}</span>;
  const tone =
    days < 0
      ? "text-destructive"
      : days < 14
        ? "text-yellow-500"
        : "text-accent-brand";
  return (
    <span className={tone} title={expiry ?? undefined}>
      {days < 0
        ? t("hostMetrics.managers.sslExpired")
        : t("hostMetrics.managers.sslInDays", { days })}
    </span>
  );
}

export function SslManagerCard({ hostId }: { hostId: number | null }) {
  const { t } = useTranslation();
  const { data, loading, error, refresh } = useManagerData<SslData>(
    hostId,
    "ssl",
  );
  const { busy, run } = useManagerAction(hostId);
  const [showIssue, setShowIssue] = useState(false);
  const [domains, setDomains] = useState("");
  const [challenge, setChallenge] = useState<Challenge>("http-standalone");
  const [webroot, setWebroot] = useState("");
  const [dnsProvider, setDnsProvider] = useState("");
  const [issuing, setIssuing] = useState(false);

  const clients = data?.clients;
  const activeClient: "certbot" | "acme.sh" | null = clients?.certbot
    ? "certbot"
    : clients?.acmeSh
      ? "acme.sh"
      : null;

  const certs = useMemo(() => data?.certs ?? [], [data?.certs]);

  const renew = (dryRun: boolean) => {
    if (!activeClient) return;
    run(
      "ssl",
      { client: activeClient, dryRun },
      {
        action: "renew",
        toastId: "ssl-op",
        loadingMsg: t("hostMetrics.managers.working"),
        successMsg: t("hostMetrics.managers.actionDone", { name: "renew" }),
        failMsg: t("hostMetrics.managers.actionFailed"),
        onDone: refresh,
      },
    );
  };

  const revoke = (cert: CertInfo) => {
    if (cert.client !== "certbot" && cert.client !== "acme.sh") return;
    if (
      !window.confirm(
        t("hostMetrics.managers.sslRevokeConfirm", { name: cert.name }),
      )
    )
      return;
    run(
      "ssl",
      { client: cert.client, name: cert.name },
      {
        action: "revoke",
        toastId: "ssl-op",
        loadingMsg: t("hostMetrics.managers.working"),
        successMsg: t("hostMetrics.managers.sslRevoked"),
        failMsg: t("hostMetrics.managers.actionFailed"),
        onDone: refresh,
      },
    );
  };

  const issue = async () => {
    if (hostId == null || !activeClient) return;
    const list = domains
      .split(/[\s,]+/)
      .map((d) => d.trim())
      .filter(Boolean);
    if (list.length === 0) {
      const { toast } = await import("sonner");
      toast.error(t("hostMetrics.managers.sslNeedDomain"));
      return;
    }
    setIssuing(true);
    const { toast } = await import("sonner");
    toast.loading(t("hostMetrics.managers.working"), { id: "ssl-issue" });
    try {
      const res = await managerPost<{ success: boolean; output: string }>(
        hostId,
        "ssl",
        {
          client: activeClient,
          domains: list,
          challenge,
          webroot: challenge === "http-webroot" ? webroot : undefined,
          dnsProvider: challenge === "dns" ? dnsProvider : undefined,
        },
        "issue",
      );
      toast[res.success ? "success" : "error"](
        res.success
          ? t("hostMetrics.managers.sslIssued")
          : t("hostMetrics.managers.actionFailed"),
        { id: "ssl-issue", description: res.output?.slice(-200) },
      );
      if (res.success) {
        setShowIssue(false);
        setDomains("");
        refresh();
      }
    } catch (e) {
      toast.error(extractError(e).message, { id: "ssl-issue" });
    } finally {
      setIssuing(false);
    }
  };

  return (
    <ManagerCardShell
      title={t("hostMetrics.managers.ssl")}
      icon={<ShieldCheck className="size-3.5" />}
      loading={loading}
      error={error}
      onRefresh={refresh}
      empty={!loading && certs.length === 0 && !activeClient}
      emptyMessage={t("hostMetrics.managers.noAcmeClient")}
      headerExtra={
        activeClient ? (
          <>
            <Button
              variant="ghost"
              size="xs"
              disabled={busy}
              onClick={() => renew(true)}
            >
              {t("hostMetrics.managers.dryRun")}
            </Button>
            <Button
              variant="outline"
              size="xs"
              disabled={busy}
              onClick={() => renew(false)}
            >
              <RefreshCw className="size-3" />
              {t("hostMetrics.managers.renew")}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>{t("hostMetrics.managers.clients")}:</span>
          <span className={clients?.certbot ? "text-accent-brand" : ""}>
            certbot
          </span>
          <span className={clients?.acmeSh ? "text-accent-brand" : ""}>
            acme.sh
          </span>
        </div>
        {activeClient && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setShowIssue((v) => !v)}
          >
            {showIssue ? <X className="size-3" /> : <Plus className="size-3" />}
            {t("hostMetrics.managers.sslIssueCert")}
          </Button>
        )}
      </div>

      {showIssue && activeClient && (
        <div className="mb-3 flex flex-col gap-2 border border-dashed border-border p-2">
          <input
            value={domains}
            onChange={(e) => setDomains(e.target.value)}
            placeholder={t("hostMetrics.managers.sslDomainsPlaceholder")}
            className="h-7 w-full border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex items-center gap-1.5">
            <select
              value={challenge}
              onChange={(e) => setChallenge(e.target.value as Challenge)}
              className="h-7 flex-1 border border-border bg-background px-1 text-xs"
            >
              <option value="http-standalone">
                {t("hostMetrics.managers.sslHttpStandalone")}
              </option>
              <option value="http-webroot">
                {t("hostMetrics.managers.sslHttpWebroot")}
              </option>
              <option value="dns">{t("hostMetrics.managers.sslDns")}</option>
            </select>
          </div>
          {challenge === "http-webroot" && (
            <input
              value={webroot}
              onChange={(e) => setWebroot(e.target.value)}
              placeholder="/var/www/html"
              className="h-7 w-full border border-border bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
            />
          )}
          {challenge === "dns" && (
            <input
              value={dnsProvider}
              onChange={(e) => setDnsProvider(e.target.value)}
              placeholder={t("hostMetrics.managers.sslDnsProvider")}
              className="h-7 w-full border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={issuing}
            onClick={issue}
            className="self-start"
          >
            {t("hostMetrics.managers.sslIssueCert")}
          </Button>
          <span className="text-[10px] text-muted-foreground/70">
            {t("hostMetrics.managers.sslIssueHint")}
          </span>
        </div>
      )}

      <div className="flex flex-col divide-y divide-border">
        {certs.map((c) => (
          <div
            key={`${c.client}-${c.name}`}
            className="flex items-center justify-between gap-2 py-1.5 text-xs"
          >
            <span
              className="truncate font-semibold"
              title={c.domains.join(", ")}
            >
              {c.name}
            </span>
            <div className="flex shrink-0 items-center gap-2">
              <span className="font-mono text-[11px]">
                <ExpiryBadge expiry={c.expiry} />
              </span>
              {(c.client === "certbot" || c.client === "acme.sh") && (
                <button
                  onClick={() => revoke(c)}
                  disabled={busy}
                  title={t("hostMetrics.managers.sslRevoke")}
                  className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-40"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </ManagerCardShell>
  );
}
