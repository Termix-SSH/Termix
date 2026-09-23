import { Network } from "lucide-react";
import type {
  DashboardCardProps,
  TabProps,
  TermixApp,
} from "@termix/plugin-sdk/frontend";
import { NetworkGraphCard } from "./NetworkGraphCard";

const VIEW_ID = "network_graph";

function GraphTab({ isVisible }: TabProps) {
  return <NetworkGraphCard embedded={false} isVisible={isVisible} />;
}

function GraphCard({ isVisible, shell }: DashboardCardProps) {
  return (
    <NetworkGraphCard
      embedded={true}
      isVisible={isVisible}
      onOpenInNewTab={() => shell.openSingletonTab(VIEW_ID)}
    />
  );
}

export function activate(app: TermixApp): void {
  app.registerTab(VIEW_ID, GraphTab, {
    icon: Network,
    titleKey: "nav.networkGraph",
    singleton: true,
    hostless: true,
  });

  app.registerRailItem({
    id: VIEW_ID,
    icon: Network,
    titleKey: "nav.networkGraph",
    kind: "tab",
    after: "local-terminal",
  });

  app.registerDashboardCard({
    id: VIEW_ID,
    titleKey: "dashboard.networkGraph",
    defaultHeight: 350,
    component: GraphCard,
  });
}
