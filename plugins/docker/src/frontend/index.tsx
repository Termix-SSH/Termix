import type { ComponentType } from "react";
import { Box } from "lucide-react";
import type {
  HomepageWidgetContribution,
  StandaloneViewProps,
  TabProps,
  TermixApp,
} from "@termix/plugin-sdk/frontend";
import { DockerManager } from "./DockerManager";
import DockerApp from "./DockerApp";
import { dockerWidget } from "./DockerWidget";
import { dockerEnabled, toDockerHost } from "./types";

function DockerTab({ host, sshHost, label, isVisible }: TabProps) {
  const record = (host ?? sshHost) as Record<string, unknown> | undefined;
  return (
    <DockerManager
      host={record ? toDockerHost(record) : undefined}
      title={label}
      isVisible={isVisible}
      isTopbarOpen={false}
      embedded={true}
    />
  );
}

function DockerStandalone({ hostId }: StandaloneViewProps) {
  return <DockerApp hostId={hostId} />;
}

export function activate(app: TermixApp): void {
  // Host actions filter synchronously, so the permission is read once here.
  let canUse = true;
  void app.hasPermission("use").then((allowed) => {
    canUse = allowed;
  });

  app.registerTab("docker", DockerTab, {
    icon: Box,
    titleKey: "nav.docker",
    requiresHost: true,
    noHostMessageKey: "docker.noHostSelected",
    persistent: true,
    activityTypes: ["docker"],
    standalone: DockerStandalone,
    preload: () => import("./DockerManager"),
  });

  app.registerHostAction({
    id: "docker",
    titleKey: "nav.docker",
    icon: Box,
    kind: "open",
    order: 30,
    tabType: "docker",
    copyUrlView: "docker",
    when: (host) => canUse && !!host.enableSsh && dockerEnabled(host),
  });

  app.registerHomepageWidget(
    dockerWidget as unknown as HomepageWidgetContribution,
  );

  app.registerSlotContribution("onboarding.features", {
    actionId: "docker.feature",
    titleKey: "onboarding.feature_docker",
    descriptionKey: "onboarding.feature_docker_desc",
    icon: Box as ComponentType<{ className?: string }>,
  });
}
