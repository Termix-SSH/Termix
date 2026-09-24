import { LayoutGrid } from "lucide-react";
import type { ComponentType } from "react";
import type {
  StandaloneViewProps,
  TabProps,
  TermixApp,
} from "@termix/plugin-sdk/frontend";
import { HomepageCanvas } from "./HomepageCanvas.js";
import { HomepagePreviewCard } from "./HomepagePreviewCard.js";
import { ServiceLinksCard } from "./ServiceLinksCard.js";
import { DashboardHomepageView } from "./DashboardHomepageView.js";
import { setHomepageApi } from "./api.js";
import { drainQueuedWidgets } from "./widgets/WidgetRegistry.js";

// Side-effect imports so widgets register themselves.
import "./widgets/ServiceLinkWidget";
import "./widgets/ClockWidget";
import "./widgets/NotesWidget";
import "./widgets/BookmarkListWidget";
import "./widgets/HostStatusWidget";
import "./widgets/FolderWidget";
import "./widgets/WeatherWidget";
import "./widgets/IframeWidget";
import "./widgets/RssFeedWidget";
import "./widgets/HostGridWidget";
import "./widgets/PingStatusWidget";
import "./widgets/RecentActivityWidget";
import "./widgets/TermixUptimeWidget";
import "./widgets/SystemOverviewWidget";
import "./widgets/SshTerminalWidget";
import "./widgets/QuickConnectWidget";
import "./widgets/CalendarWidget";
import "./widgets/CountdownWidget";
import "./widgets/SearchBarWidget";
import "./widgets/TextBannerWidget";
import "./widgets/ImageWidget";
import "./widgets/MarkdownNotesWidget";
import "./widgets/CustomApiWidget";
import "./widgets/ServiceGridWidget";
import "./widgets/DashboardLinksWidget";
import "./widgets/SearchLinksWidget";
import "./widgets/LinkTreeWidget";

function HomepageTab(_props: TabProps) {
  return <HomepageCanvas />;
}

function HomepageStandalone(_props: StandaloneViewProps) {
  return <HomepageCanvas fitOnLoad={true} />;
}

export function activate(app: TermixApp): void {
  setHomepageApi(app.api);
  app.onDispose(() => setHomepageApi(null));

  for (const widget of drainQueuedWidgets()) {
    app.registerHomepageWidget(widget as never);
  }

  app.registerTab("homepage", HomepageTab as ComponentType<TabProps>, {
    icon: LayoutGrid,
    titleKey: "nav.homepage",
    singleton: true,
    hostless: true,
    standalone: HomepageStandalone,
  });

  app.registerPaletteEntry({
    id: "homepage.open",
    titleKey: "nav.homepage",
    icon: LayoutGrid,
    keywords: ["homepage", "widgets", "canvas"],
    scope: "global",
    run: (shell) => shell.openSingletonTab("homepage"),
  });

  app.registerDashboardCard({
    id: "service_links",
    titleKey: "dashboard.serviceLinks",
    defaultHeight: 200,
    defaultPanel: "side",
    component: ServiceLinksCard,
  });

  app.registerDashboardCard({
    id: "homepage_preview",
    titleKey: "dashboard.homepagePreview",
    defaultHeight: 320,
    component: HomepagePreviewCard,
  });

  app.declareActionSlot({
    id: "dashboard.secondaryView",
    accepts: ["component"],
  });
  app.registerSlotContribution("dashboard.secondaryView", {
    actionId: "homepage",
    titleKey: "nav.homepage",
    kind: "component",
    component: DashboardHomepageView as ComponentType<Record<string, unknown>>,
  });
}

export function deactivate(): void {
  // Everything above was registered through app and is disposed by core.
}
