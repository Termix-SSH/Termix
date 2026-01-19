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
import { getSSHHosts } from "@/ui/main-axios";
import type { HostProps } from "../../../../types";
import { DEFAULT_STATS_CONFIG } from "@/types/stats-widgets";
import { useTranslation } from "react-i18next";
import { useHostStatus } from "@/ui/contexts/ServerStatusContext";

export function Host({ host: initialHost }: HostProps): React.ReactElement {
  const { addTab } = useTabs();
  const [host, setHost] = useState(initialHost);
  const { t } = useTranslation();
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

  // Use shared status context instead of individual polling
  const serverStatus = useHostStatus(host.id, shouldShowStatus);

  const hasTunnelConnections = useMemo(() => {
    if (!host.tunnelConnections) return false;
    try {
      const tunnelConnections = Array.isArray(host.tunnelConnections)
        ? host.tunnelConnections
        : JSON.parse(host.tunnelConnections);
      return Array.isArray(tunnelConnections) && tunnelConnections.length > 0;
    } catch {
      return false;
    }
  }, [host.tunnelConnections]);

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
          {host.enableTerminal && (host.showTerminalInSidebar ?? true) && (
            <Button
              variant="outline"
              className="!px-2 border-1 border-edge"
              onClick={handleTerminalClick}
            >
              <Terminal />
            </Button>
          )}

          {host.enableFileManager &&
            (host.showFileManagerInSidebar ?? false) && (
              <Button
                variant="outline"
                className="!px-2 border-1 border-edge"
                onClick={() =>
                  addTab({ type: "file_manager", title, hostConfig: host })
                }
              >
                <FolderOpen />
              </Button>
            )}

          {host.enableTunnel &&
            hasTunnelConnections &&
            (host.showTunnelInSidebar ?? false) && (
              <Button
                variant="outline"
                className="!px-2 border-1 border-edge"
                onClick={() =>
                  addTab({ type: "tunnel", title, hostConfig: host })
                }
              >
                <ArrowDownUp />
              </Button>
            )}

          {host.enableDocker && (host.showDockerInSidebar ?? false) && (
            <Button
              variant="outline"
              className="!px-2 border-1 border-edge"
              onClick={() =>
                addTab({ type: "docker", title, hostConfig: host })
              }
            >
              <Container />
            </Button>
          )}

          {shouldShowMetrics && (host.showServerStatsInSidebar ?? false) && (
            <Button
              variant="outline"
              className="!px-2 border-1 border-edge"
              onClick={() =>
                addTab({ type: "server_stats", title, hostConfig: host })
              }
            >
              <Server />
            </Button>
          )}

          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="!px-2 border-1 border-edge rounded-l-none border-l-0"
              >
                <EllipsisVertical />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              align="start"
              side="right"
              className="w-56 bg-canvas border-edge text-foreground"
            >
              {host.enableTerminal && !(host.showTerminalInSidebar ?? true) && (
                <DropdownMenuItem
                  onClick={handleTerminalClick}
                  className="flex items-center gap-2 cursor-pointer px-3 py-2 hover:bg-hover text-foreground-secondary"
                >
                  <Terminal className="h-4 w-4" />
                  <span className="flex-1">{t("hosts.openTerminal")}</span>
                </DropdownMenuItem>
              )}
              {shouldShowMetrics &&
                !(host.showServerStatsInSidebar ?? false) && (
                  <DropdownMenuItem
                    onClick={() =>
                      addTab({ type: "server_stats", title, hostConfig: host })
                    }
                    className="flex items-center gap-2 cursor-pointer px-3 py-2 hover:bg-hover text-foreground-secondary"
                  >
                    <Server className="h-4 w-4" />
                    <span className="flex-1">{t("hosts.openServerStats")}</span>
                  </DropdownMenuItem>
                )}
              {host.enableFileManager &&
                !(host.showFileManagerInSidebar ?? false) && (
                  <DropdownMenuItem
                    onClick={() =>
                      addTab({ type: "file_manager", title, hostConfig: host })
                    }
                    className="flex items-center gap-2 cursor-pointer px-3 py-2 hover:bg-hover text-foreground-secondary"
                  >
                    <FolderOpen className="h-4 w-4" />
                    <span className="flex-1">{t("hosts.openFileManager")}</span>
                  </DropdownMenuItem>
                )}
              {host.enableTunnel &&
                hasTunnelConnections &&
                !(host.showTunnelInSidebar ?? false) && (
                  <DropdownMenuItem
                    onClick={() =>
                      addTab({ type: "tunnel", title, hostConfig: host })
                    }
                    className="flex items-center gap-2 cursor-pointer px-3 py-2 hover:bg-hover text-foreground-secondary"
                  >
                    <ArrowDownUp className="h-4 w-4" />
                    <span className="flex-1">{t("hosts.openTunnels")}</span>
                  </DropdownMenuItem>
                )}
              {host.enableDocker && !(host.showDockerInSidebar ?? false) && (
                <DropdownMenuItem
                  onClick={() =>
                    addTab({ type: "docker", title, hostConfig: host })
                  }
                  className="flex items-center gap-2 cursor-pointer px-3 py-2 hover:bg-hover text-foreground-secondary"
                >
                  <Container className="h-4 w-4" />
                  <span className="flex-1">{t("hosts.openDocker")}</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() =>
                  addTab({
                    type: "ssh_manager",
                    title: t("nav.hostManager"),
                    hostConfig: host,
                    initialTab: "add_host",
                  })
                }
                className="flex items-center gap-2 cursor-pointer px-3 py-2 hover:bg-hover text-foreground-secondary"
              >
                <Pencil className="h-4 w-4" />
                <span className="flex-1">{t("common.edit")}</span>
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
