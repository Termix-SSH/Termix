import React, { useEffect, useState } from "react";
import { Status, StatusIndicator } from "@/components/ui/shadcn-io/status";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { EllipsisVertical, Terminal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useTabs } from "@/ui/Desktop/Navigation/Tabs/TabContext";
import { getServerStatusById } from "@/ui/main-axios";
import type { HostProps } from "../../../../types";

export function Host({ host }: HostProps): React.ReactElement {
  const { addTab } = useTabs();
  const [serverStatus, setServerStatus] = useState<
    "online" | "offline" | "degraded"
  >("degraded");
  const tags = Array.isArray(host.tags) ? host.tags : [];
  const hasTags = tags.length > 0;

  const title = host.name?.trim()
    ? host.name
    : `${host.username}@${host.ip}:${host.port}`;

  useEffect(() => {
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
          } else {
            setServerStatus("offline");
          }
        }
      }
    };

    fetchStatus();
    const intervalId = window.setInterval(fetchStatus, 30000);

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [host.id]);

  const handleTerminalClick = () => {
    addTab({ type: "terminal", title, hostConfig: host });
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <Status
          status={serverStatus}
          className="!bg-transparent !p-0.75 flex-shrink-0"
        >
          <StatusIndicator />
        </Status>

        <p className="font-semibold flex-1 min-w-0 break-words text-sm">
          {host.name || host.ip}
        </p>

        <ButtonGroup className="flex-shrink-0">
          {host.enableTerminal && (
            <Button
              variant="outline"
              className="!px-2 border-1 border-dark-border"
              onClick={handleTerminalClick}
            >
              <Terminal />
            </Button>
          )}

          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className={`!px-2 border-1 border-dark-border ${
                  host.enableTerminal ? "rounded-tl-none rounded-bl-none" : ""
                }`}
              >
                <EllipsisVertical />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              align="start"
              side="right"
              className="min-w-[160px]"
            >
              <DropdownMenuItem
                onClick={() =>
                  addTab({ type: "server", title, hostConfig: host })
                }
              >
                Open Server Details
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  addTab({ type: "file_manager", title, hostConfig: host })
                }
              >
                Open File Manager
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => alert("Settings clicked")}>
                Edit
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ButtonGroup>
      </div>

      {hasTags && (
        <div className="flex flex-wrap items-center gap-2 mt-1">
          {tags.map((tag: string) => (
            <div
              key={tag}
              className="bg-dark-bg border-1 border-dark-border pl-2 pr-2 rounded-[10px]"
            >
              <p className="text-sm">{tag}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
