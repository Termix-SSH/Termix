import { useEffect, useState } from "react";
import { Network } from "lucide-react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import { getTunnelStatuses } from "./api";

/** The dashboard's "active tunnels" counter; a click opens the tunnels tab. */
export function ActiveTunnelsCounter({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getTunnelStatuses()
      .then((statuses) => {
        if (cancelled) return;
        setCount(
          Object.values(statuses ?? {}).filter(
            (status) =>
              (status as { status?: string })?.status?.toUpperCase() ===
              "CONNECTED",
          ).length,
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <button
      onClick={onOpen}
      className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-muted transition-colors cursor-pointer text-left"
    >
      <Network className="size-3.5 text-muted-foreground shrink-0" />
      <span className="text-base font-bold">{count}</span>
      <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
        {t("tunnels.activeTunnels")}
      </span>
    </button>
  );
}
