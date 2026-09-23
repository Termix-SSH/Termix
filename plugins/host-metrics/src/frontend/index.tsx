import type { ComponentType } from "react";
import { Activity, Server } from "lucide-react";
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

function MetricsStandalone({ hostId }: StandaloneViewProps) {
  return <HostMetricsApp hostId={hostId} />;
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

  app.registerHostEditorSection({
    id: "host-metrics",
    group: "ssh",
    titleKey: "hosts.tabHostMetrics",
    icon: Activity,
    order: 70,
    component: MetricsHostSection,
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

  app.declareActionSlot({
    id: "host-metrics.managers",
    accepts: ["component"],
  });
}
