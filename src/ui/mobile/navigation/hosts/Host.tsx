import React, { useEffect, useState, useMemo } from "react";
import { Status, StatusIndicator } from "@/components/ui/shadcn-io/status";
import { Button } from "@/components/ui/button.tsx";
import { ButtonGroup } from "@/components/ui/button-group.tsx";
import { Terminal } from "lucide-react";
import { getServerStatusById } from "@/ui/main-axios.ts";
import { useTabs } from "@/ui/mobile/navigation/tabs/TabContext.tsx";
import type { HostProps } from "../../../../types/index.js";
import { DEFAULT_STATS_CONFIG } from "@/types/stats-widgets";

export function Host({ host, onHostConnect }: HostProps): React.ReactElement {
  const { addTab } = useTabs();
  const [serverStatus, setServerStatus] = useState<
    "online" | "offline" | "degraded"
  >("degraded");
  const tags = Array.isArray(host.tags) ? host.tags : [];
  const hasTags = tags.length > 0;

  const title = host.name?.trim()
    ? host.name
    : `${host.username}@${host.ip}:${host.port}`;

  const statsConfig = useMemo(() => {
    try {
      return host.statsConfig
        ? JSON.parse(host.statsConfig)
        : DEFAULT_STATS_CONFIG;
    } catch {
      return DEFAULT_STATS_CONFIG;
    }
  }, [host.statsConfig]);

  const shouldShowStatus = statsConfig.statusCheckEnabled !== false;

  useEffect(() => {
    if (!shouldShowStatus) {
      setServerStatus("offline");
      return;
    }

    let cancelled = false;

    const fetchStatus = async () => {
      try {
        const res = await getServerStatusById(host.id);
        if (!cancelled) {
          setServerStatus(res?.status === "online" ? "online" : "offline");
        }
      } catch (error: unknown) {
        if (!cancelled) {
          const err = error as { response?: { status?: number } };
          if (err?.response?.status === 503) {
            setServerStatus("offline");
          } else if (err?.response?.status === 504) {
            setServerStatus("degraded");
          } else if (err?.response?.status === 404) {
            setServerStatus("offline");
          } else {
            setServerStatus("offline");
          }
        }
      }
    };

    fetchStatus();

    const intervalId = window.setInterval(fetchStatus, 10000);

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [host.id, shouldShowStatus]);

  const handleTerminalClick = () => {
    addTab({ type: "terminal", title, hostConfig: host });
    onHostConnect();
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        {shouldShowStatus && (
          <Status
            status={serverStatus}
            className="!bg-transparent !p-0.75 flex-shrink-0"
          >
            <StatusIndicator />
          </Status>
        )}
        <p className="font-semibold flex-1 min-w-0 break-words text-sm">
          {host.name || host.ip}
        </p>
        <ButtonGroup className="flex-shrink-0">
          {host.enableTerminal && (
            <Button
              variant="outline"
              className="!px-2 border-1 w-[60px] border-edge"
              onClick={handleTerminalClick}
            >
              <Terminal />
            </Button>
          )}
        </ButtonGroup>
      </div>
      {hasTags && (
        <div className="flex flex-wrap items-center gap-2 mt-1">
          {tags.map((tag: string) => (
            <div
              key={tag}
              className="bg-canvas border-1 border-edge pl-2 pr-2 rounded-[10px]"
            >
              <p className="text-sm">{tag}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
