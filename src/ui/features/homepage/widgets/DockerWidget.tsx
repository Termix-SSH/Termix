import { useState, useEffect } from "react";
import { Box } from "lucide-react";
import { useTranslation } from "react-i18next";
import { registerWidget } from "./WidgetRegistry";
import type {
  DockerWidgetConfig,
  WidgetComponentProps,
} from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";
import { getSSHHosts } from "@/api/ssh-host-management-api";
import type { SSHHostWithStatus } from "@/main-axios";
import { DockerManager } from "@/features/docker/DockerManager";
import type { SSHHost } from "@/types/index";
import { WidgetTitle } from "./WidgetTitle";

function DockerWidget({
  widget,
  config,
}: WidgetComponentProps<DockerWidgetConfig>) {
  const { t } = useTranslation();
  const [host, setHost] = useState<SSHHostWithStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!config.hostId) {
      setLoading(false);
      return;
    }
    getSSHHosts()
      .then((hosts) => {
        const found = hosts.find(
          (h) => h.id === config.hostId && h.enableDocker,
        );
        setHost(found ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [config.hostId]);

  if (!config.hostId) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-2 text-muted-foreground/60">
        <Box size={20} />
        <span className="text-xs">{t("homepage.widgetNoHostSelected")}</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground/60">
        {t("homepage.loading")}
      </div>
    );
  }

  if (!host) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground/60">
        {t("homepage.widgetNoHostSelected")}
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      <WidgetTitle title={widget.title} icon={<Box size={11} />} />
      <div
        className="flex-1 overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <DockerManager
          hostConfig={host as unknown as SSHHost}
          title={host.name || host.ip}
          isVisible={true}
          isTopbarOpen={false}
          embedded={true}
        />
      </div>
    </div>
  );
}

registerWidget<DockerWidgetConfig>({
  id: "docker_widget",
  name: "Docker Manager",
  description: "Embedded Docker container manager for a configured host",
  category: "system",
  icon: <Box size={14} />,
  defaultConfig: { hostId: 0 },
  defaultSize: { w: GRID_SIZE * 20, h: GRID_SIZE * 14 },
  minSize: { w: GRID_SIZE * 10, h: GRID_SIZE * 8 },
  component: DockerWidget,
});
