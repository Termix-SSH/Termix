import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Network,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useManagerData, useManagerAction } from "./useManagerData";
import { ManagerCardShell } from "./ManagerCardShell";

interface WireGuardPeer {
  publicKey: string;
  endpoint: string | null;
  allowedIPs: string[];
  latestHandshake: number | null;
  rxBytes: number;
  txBytes: number;
}

interface WireGuardInterface {
  name: string;
  publicKey: string | null;
  listenPort: number | null;
  up: boolean;
  peers: WireGuardPeer[];
}

interface WireGuardData {
  installed: boolean;
  interfaces: WireGuardInterface[];
}

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024)
    return `${(n / 1024 / 1024 / 1024).toFixed(1)}GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${n}B`;
}

function fmtHandshake(ts: number | null): string {
  if (!ts) return "";
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function truncKey(key: string): string {
  return key.length > 12 ? `${key.slice(0, 12)}...` : key;
}

export function WireGuardManagerCard({ hostId }: { hostId: number | null }) {
  const { t } = useTranslation();
  const { data, loading, error, refresh } = useManagerData<WireGuardData>(
    hostId,
    "wireguard",
  );
  const { busy, run } = useManagerAction(hostId);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleAction = async (iface: WireGuardInterface) => {
    const action = iface.up ? "down" : "up";
    await run(
      "wireguard",
      { interface: iface.name, action },
      {
        action: "action",
        loadingMsg:
          action === "up"
            ? t("hostMetrics.managers.wgBringingUp", { name: iface.name })
            : t("hostMetrics.managers.wgBringingDown", { name: iface.name }),
        successMsg:
          action === "up"
            ? t("hostMetrics.managers.wgInterfaceUpDone", { name: iface.name })
            : t("hostMetrics.managers.wgInterfaceDownDone", {
                name: iface.name,
              }),
        onDone: refresh,
      },
    );
  };

  const isNotInstalled = data && !data.installed;
  const isEmpty = data?.installed && data.interfaces.length === 0;

  return (
    <ManagerCardShell
      title={t("hostMetrics.managers.wireguard")}
      icon={<Network className="size-3.5" />}
      loading={loading}
      error={error}
      onRefresh={refresh}
      empty={isNotInstalled || isEmpty}
      emptyMessage={
        isNotInstalled
          ? t("hostMetrics.managers.wgNotInstalled")
          : t("hostMetrics.managers.wgNoInterfaces")
      }
    >
      <div className="flex flex-col">
        {data?.interfaces.map((iface) => (
          <div
            key={iface.name}
            className="border-b border-border/50 last:border-0"
          >
            <div className="flex items-center justify-between gap-2 py-1.5">
              <button
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() => toggleExpand(iface.name)}
              >
                {expanded.has(iface.name) ? (
                  <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                )}
                <span
                  className={`size-1.5 shrink-0 rounded-full ${iface.up ? "bg-accent-brand" : "bg-muted-foreground/40"}`}
                />
                <div className="flex min-w-0 flex-col">
                  <span className="text-xs font-semibold font-mono">
                    {iface.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {iface.up ? "up" : "down"}
                    {iface.listenPort ? ` · :${iface.listenPort}` : ""}
                    {iface.peers.length > 0 ? ` · ${iface.peers.length}p` : ""}
                  </span>
                </div>
              </button>
              <button
                onClick={() => handleAction(iface)}
                disabled={busy}
                title={
                  iface.up
                    ? t("hostMetrics.managers.wgInterfaceDown")
                    : t("hostMetrics.managers.wgInterfaceUp")
                }
                className="flex size-6 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
              >
                {iface.up ? (
                  <ArrowDown className="size-3" />
                ) : (
                  <ArrowUp className="size-3" />
                )}
              </button>
            </div>

            {expanded.has(iface.name) && (
              <div className="mb-1 ml-5 flex flex-col border-l border-border/50">
                {iface.peers.length === 0 ? (
                  <span className="px-3 py-1 text-[10px] text-muted-foreground/50">
                    No peers
                  </span>
                ) : (
                  iface.peers.map((peer) => (
                    <div
                      key={peer.publicKey}
                      className="flex flex-col gap-0.5 border-b border-border/30 px-3 py-1.5 last:border-0"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {truncKey(peer.publicKey)}
                        </span>
                        {peer.endpoint && (
                          <span className="font-mono text-[10px] text-muted-foreground/60">
                            {peer.endpoint}
                          </span>
                        )}
                      </div>
                      {peer.allowedIPs.length > 0 && (
                        <span className="text-[10px] text-muted-foreground/70">
                          {peer.allowedIPs.join(", ")}
                        </span>
                      )}
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground/50">
                        <span>
                          {t("hostMetrics.managers.wgLastHandshake")}:{" "}
                          {peer.latestHandshake
                            ? fmtHandshake(peer.latestHandshake)
                            : t("hostMetrics.managers.wgHandshakeNever")}
                        </span>
                        <span>
                          {fmtBytes(peer.rxBytes)} / {fmtBytes(peer.txBytes)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </ManagerCardShell>
  );
}
