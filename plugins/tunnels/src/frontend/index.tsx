import type { ComponentType } from "react";
import { Network, Plug } from "lucide-react";
import type {
  HomepageWidgetContribution,
  TabProps,
  TermixApp,
} from "@termix/plugin-sdk/frontend";
import { TunnelTab } from "./TunnelTab";
import { HostTunnelsSection } from "./HostTunnelsSection";
import {
  PortForwardingPanel,
  TunnelStandalone,
  TunnelWidget,
  TunnelWidgetEditForm,
} from "./views";
import { getTunnelStatuses, setTunnelsApi } from "./api";
import { hostTunnelSettings } from "./host-tunnels";

// Matches the homepage canvas grid.
const GRID_SIZE = 30;

function TunnelTabView({ host }: TabProps) {
  return <TunnelTab host={host} />;
}

export function activate(app: TermixApp): void {
  setTunnelsApi(app.api);
  app.onDispose(() => setTunnelsApi(null));

  // Keeps the "tunnel" tab type and ?view=tunnel links from before the
  // conversion, so saved layouts and recent activity still open here.
  app.registerTab("tunnel", TunnelTabView as ComponentType<TabProps>, {
    icon: Network,
    titleKey: "nav.tunnels",
    persistent: true,
    hostless: true,
    standalone: TunnelStandalone,
    activityTypes: ["tunnel"],
  });

  app.registerHostAction({
    id: "tunnel",
    titleKey: "nav.tunnels",
    icon: Network,
    kind: "open",
    order: 40,
    tabType: "tunnel",
    copyUrlView: "tunnel",
    when: (host) =>
      host.enableSsh !== false && hostTunnelSettings(host).enabled,
  });

  app.registerHostEditorSection({
    id: "tunnels",
    group: "ssh",
    titleKey: "hosts.tabTunnels",
    icon: Network,
    order: 20,
    component: HostTunnelsSection,
  });

  app.registerPanel("port-forwarding", PortForwardingPanel);
  app.registerRailItem({
    id: "port-forwarding",
    icon: Network,
    titleKey: "nav.portForwarding",
    kind: "panel",
    electronOnly: true,
    separatorAfter: true,
    after: "credentials",
    permission: "use",
  });

  app.registerSlotContribution("onboarding.features", {
    actionId: "tunnels.feature",
    titleKey: "onboarding.feature_tunnels",
    descriptionKey: "onboarding.feature_tunnels_desc",
    icon: Plug as ComponentType<{ className?: string }>,
  });

  app.registerHomepageWidget({
    id: "tunnel_widget",
    name: "Tunnel Manager",
    description: "Embedded SSH tunnel manager for a configured host",
    category: "system",
    icon: <Network size={14} />,
    defaultConfig: { hostId: 0 },
    defaultSize: { w: GRID_SIZE * 16, h: GRID_SIZE * 10 },
    minSize: { w: GRID_SIZE * 8, h: GRID_SIZE * 6 },
    component: TunnelWidget,
    editFormComponent: TunnelWidgetEditForm,
  } as HomepageWidgetContribution);

  // The dashboard's active tunnel counter reads and opens these, and gets
  // undefined back while the plugin is off.
  app.registerAction("tunnels.statuses", (() => getTunnelStatuses()) as never, {
    permission: "use",
  });
  app.registerAction(
    "tunnels.open",
    (() => app.tabs.openSingletonTab("tunnel")) as never,
    { permission: "use" },
  );
}
