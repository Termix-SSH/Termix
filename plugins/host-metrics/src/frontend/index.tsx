import type { ComponentType } from "react";
import { Activity, Server } from "lucide-react";
import type {
  HomepageWidgetContribution,
  HostEditorSectionProps,
  PluginHostRecord,
  StandaloneViewProps,
  TabProps,
  TermixApp,
} from "@termix/plugin-sdk/frontend";
import { HostMetricsTab } from "./HostMetricsTab";
import HostMetricsApp from "./HostMetricsApp";
import { HostStatsTab } from "./HostEditorStatsTab";
import { metricsChartWidget } from "./MetricsChartWidget";
import { TerminalMetricsStatus } from "./TerminalMetricsStatus";
import { createHostMetricsApi } from "./host-metrics-api";
import { createMetricsSummaryStore } from "./summary-store";
import {
  createDashboardHostMetrics,
  createHomepageHostMetrics,
} from "./SummaryViews";

type HostMetricsTabConfig = Parameters<typeof HostMetricsTab>[0]["hostConfig"];

/** This plugin's metricsEnabled host setting; on unless turned off. */
function metricsEnabledFor(host: unknown): boolean {
  const bag = (
    host as { pluginSettings?: Record<string, Record<string, unknown>> }
  )?.pluginSettings;
  return bag?.["host-metrics"]?.metricsEnabled !== false;
}

function MetricsTab({ sshHost, label, isVisible }: TabProps) {
  return (
    <HostMetricsTab
      hostConfig={sshHost as unknown as HostMetricsTabConfig}
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

function MetricsHostSection(props: HostEditorSectionProps) {
  return <HostStatsTab {...props} />;
}

export async function activate(app: TermixApp): Promise<void> {
  const allowed = await app.hasPermission("use");
  const metricsApi = createHostMetricsApi(app.api);
  const summaries = createMetricsSummaryStore(metricsApi);
  app.onDispose(() => summaries.dispose());

  // The latest disk sample, for the file manager's usage bar.
  app.registerAction(
    "host-metrics.disk",
    (async (hostId: number) =>
      (await metricsApi.getMetrics(hostId).catch(() => null))?.disk ??
      null) as never,
    { permission: "use" },
  );

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
    when: (host: PluginHostRecord) =>
      allowed && !!host.enableSsh && metricsEnabledFor(host),
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

  // Live CPU, memory and disk bars in the terminal toolbar's expanded view.
  app.registerSlotContribution("terminal.toolbarStatus", {
    actionId: "host-metrics.terminalStatus",
    titleKey: "nav.hostMetrics",
    kind: "component",
    component: TerminalMetricsStatus,
    when: (context) => allowed && metricsEnabledFor(context.host),
  });

  // The usage bars in the dashboard's host status card.
  app.registerSlotContribution("dashboard.hostMetrics", {
    actionId: "host-metrics.dashboardHost",
    titleKey: "nav.hostMetrics",
    kind: "component",
    component: createDashboardHostMetrics(summaries),
  });

  // The numbers in the homepage's host status widget.
  app.registerSlotContribution("homepage.hostMetrics", {
    actionId: "host-metrics.homepageHost",
    titleKey: "nav.hostMetrics",
    kind: "component",
    component: createHomepageHostMetrics(summaries),
  });

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
