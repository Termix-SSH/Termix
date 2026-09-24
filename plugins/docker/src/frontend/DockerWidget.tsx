import { Box } from "lucide-react";
import { useHost, useTranslation } from "@termix/plugin-sdk/frontend";
import { WidgetTitle } from "@termix/plugin-sdk/ui";
import { DockerWidgetEditForm } from "./DockerWidgetEditForm";
import { DockerManager } from "./DockerManager";
import {
  GRID_SIZE,
  type DockerWidgetConfig,
  type WidgetComponentProps,
  type WidgetDefinition,
} from "./homepage";
import { dockerEnabled, hostTitle, toDockerHost } from "./types";

function DockerWidget({
  widget,
  config,
}: WidgetComponentProps<DockerWidgetConfig>) {
  const { t } = useTranslation();
  const record = useHost(config.hostId || undefined);

  if (!config.hostId || !record || !dockerEnabled(record)) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-2 text-muted-foreground/60">
        <Box size={20} />
        <span className="text-xs">{t("common.noHostConfigured")}</span>
      </div>
    );
  }

  const host = toDockerHost(record as unknown as Record<string, unknown>);
  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      <WidgetTitle title={widget.title} icon={<Box size={11} />} />
      <div
        className="flex-1 overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <DockerManager
          host={host}
          title={hostTitle(host)}
          isVisible={true}
          isTopbarOpen={false}
          embedded={true}
        />
      </div>
    </div>
  );
}

/** Registered by the plugin while it runs. */
export const dockerWidget: WidgetDefinition<DockerWidgetConfig> = {
  id: "docker_widget",
  name: "Docker Manager",
  description: "Embedded Docker container manager for a configured host",
  category: "system",
  icon: <Box size={14} />,
  defaultConfig: { hostId: 0 },
  defaultSize: { w: GRID_SIZE * 20, h: GRID_SIZE * 14 },
  minSize: { w: GRID_SIZE * 10, h: GRID_SIZE * 8 },
  component: DockerWidget,
  editFormComponent: DockerWidgetEditForm,
};
