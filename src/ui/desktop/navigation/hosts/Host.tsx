import React, { useEffect, useState, useMemo } from "react";
import { Status, StatusIndicator } from "@/components/ui/shadcn-io/status";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  EllipsisVertical,
  Terminal,
  Server,
  FolderOpen,
  Pencil,
  ArrowDownUp,
  Container,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useTabs } from "@/ui/desktop/navigation/tabs/TabContext";
import { getServerStatusById } from "@/ui/main-axios";
import type { HostProps } from "../../../../types";
import { DEFAULT_STATS_CONFIG } from "@/types/stats-widgets";
import { useTranslation } from "react-i18next";

export function Host({ host: initialHost }: HostProps): React.ReactElement {
  const { addTab } = useTabs();
  const [host, setHost] = useState(initialHost);
  const { t } = useTranslation();
  const [serverStatus, setServerStatus] = useState<
    "online" | "offline" | "degraded"
  >("degraded");
  const [showTags, setShowTags] = useState<boolean>(() => {
    const saved = localStorage.getItem("showHostTags");
    return saved !== null ? saved === "true" : true;
  });
  const tags = Array.isArray(host.tags) ? host.tags : [];
  const hasTags = tags.length > 0;

  const title = host.name?.trim()
    ? host.name
    : `${host.username}@${host.ip}:${host.port}`;

  useEffect(() => {
    setHost(initialHost);
  }, [initialHost]);

  useEffect(() => {
    const handleHostsChanged = async () => {
      const { getSSHHosts } = await import("@/ui/main-axios.ts");
      const hosts = await getSSHHosts();
      const updatedHost = hosts.find((h) => h.id === host.id);
      if (updatedHost) {
        setHost(updatedHost);
      }
    };

    window.addEventListener("ssh-hosts:changed", handleHostsChanged);
    return () =>
      window.removeEventListener("ssh-hosts:changed", handleHostsChanged);
  }, [host.id]);

  useEffect(() => {
    const handleShowTagsChanged = () => {
      const saved = localStorage.getItem("showHostTags");
      setShowTags(saved !== null ? saved === "true" : true);
    };

    window.addEventListener("showHostTagsChanged", handleShowTagsChanged);
    return () =>
      window.removeEventListener("showHostTagsChanged", handleShowTagsChanged);
  }, []);

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
  const shouldShowMetrics = statsConfig.metricsEnabled !== false;

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
              className="w-56 bg-dark-bg border-dark-border text-white"
            >
              {shouldShowMetrics && (
                <DropdownMenuItem
                  onClick={() =>
                    addTab({ type: "server", title, hostConfig: host })
                  }
                  className="flex items-center gap-2 cursor-pointer px-3 py-2 hover:bg-dark-hover text-gray-300"
                >
                  <Server className="h-4 w-4" />
                  <span className="flex-1">{t('hosts.openServerStats')}</span>
                </DropdownMenuItem>
              )}
              {host.enableFileManager && (
                <DropdownMenuItem
                  onClick={() =>
                    addTab({ type: "file_manager", title, hostConfig: host })
                  }
                  className="flex items-center gap-2 cursor-pointer px-3 py-2 hover:bg-dark-hover text-gray-300"
                >
                  <FolderOpen className="h-4 w-4" />
                  <span className="flex-1">{t('hosts.openFileManager')}</span>
                </DropdownMenuItem>
              )}
              {host.enableTunnel && (
                <DropdownMenuItem
                  onClick={() =>
                    addTab({ type: "tunnel", title, hostConfig: host })
                  }
                  className="flex items-center gap-2 cursor-pointer px-3 py-2 hover:bg-dark-hover text-gray-300"
                >
                  <ArrowDownUp className="h-4 w-4" />
                  <span className="flex-1">{t('hosts.openTunnels')}</span>
                </DropdownMenuItem>
              )}
              {host.enableDocker && (
                <DropdownMenuItem
                  onClick={() =>
                    addTab({ type: "docker", title, hostConfig: host })
                  }
                  className="flex items-center gap-2 cursor-pointer px-3 py-2 hover:bg-dark-hover text-gray-300"
                >
                  <Container className="h-4 w-4" />
                  <span className="flex-1">{t('hosts.openDocker')}</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() =>
                  addTab({
                    type: "ssh_manager",
                    title: t('nav.hostManager'),
                    hostConfig: host,
                    initialTab: "add_host",
                  })
                }
                className="flex items-center gap-2 cursor-pointer px-3 py-2 hover:bg-dark-hover text-gray-300"
              >
                <Pencil className="h-4 w-4" />
                <span className="flex-1">{t('common.edit')}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ButtonGroup>
      </div>
      {showTags && hasTags && (
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
