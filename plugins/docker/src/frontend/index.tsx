import type { ComponentType } from "react";
import { Box } from "lucide-react";
import type {
  HomepageWidgetContribution,
  HostEditorSectionProps,
  StandaloneViewProps,
  TabProps,
  TermixApp,
} from "@termix/plugin-sdk/frontend";
import type { SSHHost } from "@/types";
import { DockerManager } from "./DockerManager";
import DockerApp from "./DockerApp";
import { HostDockerTab } from "./HostDockerTab";
import { dockerWidget } from "./DockerWidget";

function DockerTab({ sshHost, label, isVisible }: TabProps) {
  return (
    <DockerManager
      hostConfig={sshHost as unknown as SSHHost}
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

function DockerHostSection({ form, setField }: HostEditorSectionProps) {
  return (
    <HostDockerTab
      form={form}
      setField={setField as Parameters<typeof HostDockerTab>[0]["setField"]}
    />
  );
}

export function activate(app: TermixApp): void {
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
    when: (host) => !!host.enableSsh && !!host.enableDocker,
  });

  app.registerHostEditorSection({
    id: "docker",
    group: "ssh",
    titleKey: "hosts.tabDocker",
    icon: Box,
    order: 30,
    component: DockerHostSection,
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
