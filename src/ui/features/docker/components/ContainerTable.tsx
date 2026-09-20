import { getErrorMessage } from "../../../lib/error-message.js";
import React from "react";
import { Box, List, Play, RefreshCw, Square, Terminal } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button.tsx";
import type { DockerContainer } from "@/types";
import { startDockerContainer, stopDockerContainer } from "@/main-axios.ts";
import { DockerBadge } from "./ContainerCard.tsx";

type DetailTab = "logs" | "stats" | "console";

interface ContainerTableProps {
  containers: DockerContainer[];
  sessionId: string;
  onSelectContainer: (containerId: string, tab?: DetailTab) => void;
  selectedContainerId?: string | null;
  onRefresh?: () => void;
  search?: string;
  statusFilter?: string;
}

export function ContainerTable({
  containers,
  sessionId,
  onSelectContainer,
  selectedContainerId = null,
  onRefresh,
  search = "",
  statusFilter = "all",
}: ContainerTableProps): React.ReactElement {
  const { t } = useTranslation();
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  const filtered = React.useMemo(() => {
    return containers.filter((c) => {
      const name = c.name.startsWith("/") ? c.name.slice(1) : c.name;
      const matchesSearch =
        name.toLowerCase().includes(search.toLowerCase()) ||
        c.image.toLowerCase().includes(search.toLowerCase()) ||
        c.id.toLowerCase().includes(search.toLowerCase());
      return (
        matchesSearch && (statusFilter === "all" || c.state === statusFilter)
      );
    });
  }, [containers, search, statusFilter]);

  const handleToggleRun = async (
    e: React.MouseEvent,
    container: DockerContainer,
  ) => {
    e.stopPropagation();
    const containerName = container.name.startsWith("/")
      ? container.name.slice(1)
      : container.name;
    setPendingId(container.id);
    try {
      if (container.state === "running") {
        await stopDockerContainer(sessionId, container.id);
        toast.success(t("docker.containerStopped", { name: containerName }));
      } else {
        await startDockerContainer(sessionId, container.id);
        toast.success(t("docker.containerStarted", { name: containerName }));
      }
      onRefresh?.();
    } catch (err) {
      toast.error(
        container.state === "running"
          ? t("docker.failedToStopContainer", { error: getErrorMessage(err) })
          : t("docker.failedToStartContainer", {
              error: getErrorMessage(err),
            }),
      );
    } finally {
      setPendingId(null);
    }
  };

  if (containers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full opacity-20 py-20">
        <Box className="size-16 mb-4" />
        <span className="text-xl font-bold uppercase tracking-widest">
          {t("docker.noContainersFound")}
        </span>
        <span className="text-xs font-semibold">
          {t("docker.noContainersFoundHint")}
        </span>
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full opacity-20 py-20">
        <Box className="size-16 mb-4" />
        <span className="text-xl font-bold uppercase tracking-widest">
          {t("docker.noContainersMatchFilters")}
        </span>
        <span className="text-xs font-semibold">
          {t("docker.noContainersMatchFiltersHint")}
        </span>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-border bg-card">
      <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 text-left font-semibold">
                {t("docker.name")}
              </th>
              <th className="px-3 py-2 text-left font-semibold">
                {t("docker.image")}
              </th>
              <th className="px-3 py-2 text-left font-semibold">
                {t("docker.state")}
              </th>
              <th className="px-3 py-2 text-left font-semibold">
                {t("docker.ports")}
              </th>
              <th className="px-3 py-2 text-left font-semibold">
                {t("docker.status")}
              </th>
              <th className="px-3 py-2 text-right font-semibold">
                {t("docker.actions")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((container) => {
              const containerName = container.name.startsWith("/")
                ? container.name.slice(1)
                : container.name;
              const portsList = (container.ports ?? "")
                .split(",")
                .map((p) => p.trim())
                .filter(Boolean);
              const isSelected = selectedContainerId === container.id;
              const isPending = pendingId === container.id;

              return (
                <tr
                  key={container.id}
                  onClick={() => onSelectContainer(container.id, "logs")}
                  className={`cursor-pointer transition-colors hover:bg-muted/40 ${
                    isSelected ? "bg-accent-brand/5" : ""
                  }`}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Box
                        className={`size-3.5 shrink-0 ${container.state === "running" ? "text-accent-brand" : "text-muted-foreground"}`}
                      />
                      <span className="min-w-0 truncate font-semibold">
                        {containerName}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 max-w-[220px]">
                    <span className="block truncate font-mono text-muted-foreground">
                      {container.image}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <DockerBadge state={container.state} />
                  </td>
                  <td className="px-3 py-2 max-w-[200px]">
                    {portsList.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {portsList.slice(0, 2).map((p) => (
                          <span
                            key={p}
                            className="text-[10px] font-mono px-1 border border-border bg-muted/30"
                          >
                            {p}
                          </span>
                        ))}
                        {portsList.length > 2 && (
                          <span className="text-[10px] text-muted-foreground">
                            +{portsList.length - 2}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-[10px] text-muted-foreground italic">
                        {t("docker.noPorts")}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {container.status}
                  </td>
                  <td className="px-3 py-2">
                    <div
                      className="flex items-center justify-end gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title={t("docker.logs")}
                        onClick={() => onSelectContainer(container.id, "logs")}
                      >
                        <List className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title={t("docker.stats")}
                        onClick={() => onSelectContainer(container.id, "stats")}
                      >
                        <Box className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title={t("docker.consoleTab")}
                        disabled={container.state !== "running"}
                        onClick={() =>
                          onSelectContainer(container.id, "console")
                        }
                      >
                        <Terminal className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className={
                          container.state === "running"
                            ? "text-destructive"
                            : "text-accent-brand"
                        }
                        disabled={isPending}
                        title={
                          container.state === "running"
                            ? t("docker.stop")
                            : t("docker.start")
                        }
                        onClick={(e) => handleToggleRun(e, container)}
                      >
                        {isPending ? (
                          <RefreshCw className="size-3 animate-spin" />
                        ) : container.state === "running" ? (
                          <Square className="size-3" />
                        ) : (
                          <Play className="size-3" />
                        )}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
