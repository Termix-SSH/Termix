import { useState } from "react";
import { ShieldCheck, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { managerPost } from "@/main-axios";
import type { FirewallChain } from "@/main-axios";
import { useManagerData, extractError } from "./useManagerData";
import { ManagerCardShell } from "./ManagerCardShell";

interface FirewallData {
  type: "iptables" | "nftables" | "none";
  status: string;
  chains: FirewallChain[];
}

export function FirewallManagerCard({ hostId }: { hostId: number | null }) {
  const { t } = useTranslation();
  const { data, loading, error, refresh } = useManagerData<FirewallData>(
    hostId,
    "firewall",
  );
  const [proto, setProto] = useState<"tcp" | "udp">("tcp");
  const [port, setPort] = useState("");
  const [target, setTarget] = useState<"ACCEPT" | "DROP" | "REJECT">("ACCEPT");
  const [busy, setBusy] = useState(false);

  const rule = async (op: "add" | "delete") => {
    if (hostId == null) return;
    const portNum = Number(port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      toast.error(t("hostMetrics.managers.invalidPort"));
      return;
    }
    setBusy(true);
    try {
      const res = await managerPost<{ success: boolean; output: string }>(
        hostId,
        "firewall",
        { op, protocol: proto, port: portNum, target },
        "rule",
      );
      if (res.success) {
        toast.success(t("hostMetrics.managers.ruleApplied"));
        refresh();
      } else {
        toast.error(res.output || t("hostMetrics.managers.actionFailed"));
      }
    } catch (e) {
      toast.error(extractError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const inputChain = data?.chains?.find((c) => c.name === "INPUT");

  return (
    <ManagerCardShell
      title={t("hostMetrics.managers.firewall")}
      icon={<ShieldCheck className="size-3.5" />}
      loading={loading}
      error={error}
      onRefresh={refresh}
    >
      <div className="mb-3 flex flex-col gap-2 border border-dashed border-border p-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {t("hostMetrics.managers.addInputRule")}
        </span>
        <div className="flex items-center gap-1.5">
          <select
            value={proto}
            onChange={(e) => setProto(e.target.value as "tcp" | "udp")}
            className="h-7 border border-border bg-background px-1 text-xs"
          >
            <option value="tcp">tcp</option>
            <option value="udp">udp</option>
          </select>
          <input
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder={t("hostMetrics.ports.port")}
            className="h-7 w-16 border border-border bg-background px-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
          <select
            value={target}
            onChange={(e) =>
              setTarget(e.target.value as "ACCEPT" | "DROP" | "REJECT")
            }
            className="h-7 border border-border bg-background px-1 text-xs"
          >
            <option>ACCEPT</option>
            <option>DROP</option>
            <option>REJECT</option>
          </select>
          <Button
            variant="outline"
            size="xs"
            disabled={busy}
            onClick={() => rule("add")}
          >
            <Plus className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={() => rule("delete")}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
        <span className="text-[10px] text-yellow-500">
          {t("hostMetrics.managers.firewallWarning")}
        </span>
      </div>
      {inputChain && inputChain.rules.length > 0 ? (
        <div className="flex flex-col">
          <div className="grid grid-cols-4 gap-2 border-b border-border pb-1 text-[10px] font-bold uppercase text-muted-foreground">
            <span>{t("hostMetrics.firewall.action")}</span>
            <span>{t("hostMetrics.firewall.protocol")}</span>
            <span>{t("hostMetrics.firewall.port")}</span>
            <span>{t("hostMetrics.firewall.source")}</span>
          </div>
          {inputChain.rules.map((r, i) => (
            <div
              key={i}
              className="grid grid-cols-4 gap-2 border-b border-border/50 py-1 font-mono text-xs last:border-0"
            >
              <span className="font-bold">{r.target}</span>
              <span className="text-muted-foreground">
                {r.protocol.toUpperCase()}
              </span>
              <span>{r.dport ?? "—"}</span>
              <span className="truncate text-muted-foreground">{r.source}</span>
            </div>
          ))}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">
          {t("hostMetrics.firewall.noData")}
        </span>
      )}
    </ManagerCardShell>
  );
}
