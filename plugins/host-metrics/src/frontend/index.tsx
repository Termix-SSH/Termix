import type { ComponentType } from "react";
import { Activity, HardDrive, Server } from "lucide-react";
import type {
  HomepageWidgetContribution,
  HostEditorSectionProps,
  StandaloneViewProps,
  TabProps,
  TermixApp,
} from "@termix/plugin-sdk/frontend";
import type { SSHHost } from "@/types";
import { HostMetricsTab } from "./HostMetricsTab";
import HostMetricsApp from "./HostMetricsApp";
import { HostStatsTab } from "./HostEditorStatsTab";
import { metricsChartWidget } from "./MetricsChartWidget";
import { MetricsRetentionSetting } from "./MetricsRetentionSetting";
import { ProxmoxStatsTab } from "./proxmox-stats/ProxmoxStatsTab";
import ProxmoxStatsApp from "./proxmox-stats/ProxmoxStatsApp";
import { HostProxmoxStatsTab } from "./proxmox-stats/HostProxmoxStatsTab";

type SectionSetField = Parameters<typeof HostStatsTab>[0]["setField"];

function MetricsTab({ sshHost, label, isVisible }: TabProps) {
  return (
    <HostMetricsTab
      hostConfig={sshHost as unknown as SSHHost}
      title={label}
      isVisible={isVisible}
      isTopbarOpen={false}
      embedded={true}
    />
  );
}

function ProxmoxTab({ sshHost, label, isVisible }: TabProps) {
  return (
    <ProxmoxStatsTab
      hostConfig={sshHost as unknown as SSHHost}
      title={label}
      isVisible={isVisible}
      isTopbarOpen={false}
      embedded={true}
    />
  );
}

function MetricsStandalone({ hostId }: StandaloneViewProps) {
  return <HostMetricsApp hostId={hostId} />;
}

function ProxmoxStandalone({ hostId }: StandaloneViewProps) {
  return <ProxmoxStatsApp hostId={hostId} />;
}

function MetricsHostSection({
  form,
  setField,
  snippets,
}: HostEditorSectionProps) {
  return (
    <HostStatsTab
      form={form}
      setField={setField as SectionSetField}
      snippets={(snippets ?? []) as { id: number; name: string }[]}
    />
  );
}

/** Drawn inside the proxmox plugin's host editor tab, when it runs. */
function ProxmoxStatsHostSection({
  form,
  setField,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any;
  setField: (key: string, value: unknown) => void;
}) {
  return (
    <HostProxmoxStatsTab form={form} setField={setField as SectionSetField} />
  );
}

export function activate(app: TermixApp): void {
  app.registerTab("host-metrics", MetricsTab, {
    icon: Server,
    titleKey: "nav.hostMetrics",
    requiresHost: true,
    noHostMessageKey: "hostMetrics.noHostSelected",
    persistent: true,
    activityTypes: ["server_stats"],
    standalone: MetricsStandalone,
    // Links copied before the rename still open.
    standaloneViews: ["server-stats"],
    preload: () => import("./HostMetricsTab"),
  });

  app.registerTab("proxmox-stats", ProxmoxTab, {
    icon: HardDrive,
    titleKey: "nav.proxmoxStats",
    requiresHost: true,
    noHostMessageKey: "proxmoxStats.noHostSelected",
    standalone: ProxmoxStandalone,
    preload: () => import("./proxmox-stats/ProxmoxStatsTab"),
  });

  app.registerHostAction({
    id: "host-metrics",
    titleKey: "nav.hostMetrics",
    icon: Server,
    kind: "open",
    order: 50,
    tabType: "host-metrics",
    copyUrlView: "host-metrics",
    overview: true,
    when: (host) =>
      !!host.enableSsh &&
      (host.statsConfig as { metricsEnabled?: boolean } | undefined)
        ?.metricsEnabled !== false,
  });

  app.registerHostAction({
    id: "proxmox-stats",
    titleKey: "nav.proxmoxStats",
    icon: HardDrive,
    kind: "open",
    order: 60,
    tabType: "proxmox-stats",
    copyUrlView: "proxmox-stats",
    when: (host) => host.enableProxmoxStats === true,
  });

  app.registerHostEditorSection({
    id: "host-metrics",
    group: "ssh",
    titleKey: "hosts.tabHostMetrics",
    icon: Activity,
    order: 70,
    component: MetricsHostSection,
  });

  app.registerSlotContribution("proxmox.hostEditor", {
    actionId: "host-metrics.proxmoxStats",
    titleKey: "nav.proxmoxStats",
    kind: "component",
    component: ProxmoxStatsHostSection as unknown as ComponentType<
      Record<string, unknown>
    >,
  });

  app.registerHomepageWidget(
    metricsChartWidget as unknown as HomepageWidgetContribution,
  );

  app.registerSettingsComponent("retention", MetricsRetentionSetting);

  app.registerSlotContribution("onboarding.features", {
    actionId: "host-metrics.feature",
    titleKey: "onboarding.feature_metrics",
    descriptionKey: "onboarding.feature_metrics_desc",
    icon: Activity as ComponentType<{ className?: string }>,
  });
}
