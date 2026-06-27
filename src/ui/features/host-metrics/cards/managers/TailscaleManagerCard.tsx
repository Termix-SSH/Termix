import { useState } from "react";
import { Power } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useManagerData, useManagerAction } from "./useManagerData";
import { ManagerCardShell } from "./ManagerCardShell";
import { ManagerSearch } from "./ManagerToolbar";

interface TailscalePeer {
  hostname: string;
  tailscaleIPs: string[];
  online: boolean;
  isExitNode: boolean;
}

interface TailscaleData {
  installed: boolean;
  running: boolean;
  tailscaleIPs: string[];
  hostname: string | null;
  peers: TailscalePeer[];
  exitNodeInUse: boolean;
}

export function TailscaleManagerCard({ hostId }: { hostId: number | null }) {
  const { t } = useTranslation();
  const { data, loading, error, refresh } = useManagerData<TailscaleData>(
    hostId,
    "tailscale",
  );
  const { busy, run } = useManagerAction(hostId);
  const [query, setQuery] = useState("");

  const handleToggle = async () => {
    if (!data) return;
    const action = data.running ? "down" : "up";
    await run(
      "tailscale",
      { action },
      {
        action: "action",
        loadingMsg: data.running
          ? t("hostMetrics.managers.tsDisabling")
          : t("hostMetrics.managers.tsEnabling"),
        successMsg: data.running
          ? t("hostMetrics.managers.tsDisabled")
          : t("hostMetrics.managers.tsEnabled"),
        onDone: refresh,
      },
    );
  };

  const filteredPeers = (data?.peers ?? []).filter(
    (p) =>
      !query ||
      p.hostname.toLowerCase().includes(query.toLowerCase()) ||
      p.tailscaleIPs.some((ip) => ip.includes(query)),
  );

  const isNotInstalled = data && !data.installed;

  return (
    <ManagerCardShell
      title={t("hostMetrics.managers.tailscale")}
      icon={<Power className="size-3.5" />}
      loading={loading}
      error={error}
      onRefresh={refresh}
      empty={!!isNotInstalled}
      emptyMessage={t("hostMetrics.managers.tsNotInstalled")}
    >
      {data && (
        <div className="flex flex-col">
          {/* Status + toggle row */}
          <div className="flex items-center justify-between border-b border-border/50 py-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`size-1.5 shrink-0 rounded-full ${data.running ? "bg-accent-brand" : "bg-muted-foreground/40"}`}
              />
              <div className="flex min-w-0 flex-col">
                <span className="text-xs font-semibold">
                  {data.running
                    ? t("hostMetrics.managers.tsRunning")
                    : t("hostMetrics.managers.tsStopped")}
                </span>
                {data.hostname && (
                  <span className="truncate font-mono text-[10px] text-muted-foreground">
                    {data.hostname}
                  </span>
                )}
                {data.tailscaleIPs.map((ip) => (
                  <span
                    key={ip}
                    className="truncate font-mono text-[10px] text-muted-foreground/60"
                  >
                    {ip}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 items-center">
              <button
                onClick={handleToggle}
                disabled={busy || !data.installed}
                title={
                  data.running
                    ? t("hostMetrics.managers.tsDisable")
                    : t("hostMetrics.managers.tsEnable")
                }
                className={`flex size-6 items-center justify-center transition-colors disabled:opacity-40 ${
                  data.running
                    ? "text-accent-brand hover:bg-muted hover:text-destructive"
                    : "text-muted-foreground hover:bg-muted hover:text-accent-brand"
                }`}
              >
                <Power className="size-3.5" />
              </button>
            </div>
          </div>

          {/* Exit node badge */}
          {data.exitNodeInUse && (
            <div className="border-b border-border/50 px-0 py-1.5">
              <span className="text-[10px] text-blue-500">
                {t("hostMetrics.managers.tsExitNodeActive")}
              </span>
            </div>
          )}

          {/* Peers */}
          {(data.peers?.length ?? 0) > 5 && (
            <ManagerSearch
              value={query}
              onChange={setQuery}
              count={filteredPeers.length}
            />
          )}
          {filteredPeers.map((peer) => (
            <div
              key={peer.hostname}
              className="flex items-center justify-between gap-2 border-b border-border/50 py-1.5 last:border-0"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={`size-1.5 shrink-0 rounded-full ${peer.online ? "bg-accent-brand" : "bg-muted-foreground/40"}`}
                />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-xs font-semibold">
                    {peer.hostname}
                  </span>
                  {peer.tailscaleIPs.map((ip) => (
                    <span
                      key={ip}
                      className="truncate font-mono text-[10px] text-muted-foreground"
                    >
                      {ip}
                    </span>
                  ))}
                </div>
              </div>
              {peer.isExitNode && (
                <span className="shrink-0 text-[10px] text-blue-500">
                  {t("hostMetrics.managers.tsExitNode")}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </ManagerCardShell>
  );
}
