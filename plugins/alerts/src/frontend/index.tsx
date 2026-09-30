import type { ComponentType } from "react";
import { Bell } from "lucide-react";
import type {
  PanelProps,
  TabProps,
  TermixApp,
} from "@termix/plugin-sdk/frontend";
import { AlertToaster } from "./AlertToaster";
import { AlertsView } from "./AlertsView";
import { createSectionRequests } from "./sections";
import { InboxView } from "./InboxView";
import { createAlertsStore, useUnreadCount } from "./store";
import { createAlertsApi } from "./api";
import {
  AlertFeedEditForm,
  AlertFeedLabel,
  DEFAULT_ALERT_FEED_CONFIG,
  createAlertFeedWidget,
} from "./AlertFeedWidget";

// The homepage grid step, in pixels.
const GRID_SIZE = 30;

const VIEW_ID = "alerts";

export function activate(app: TermixApp): void {
  const store = createAlertsStore({
    connect: (init) => app.fetch("/stream", init),
    loadUnread: async () =>
      (await app.api.get<{ count: number }>("/unread")).data.count,
  });
  const sections = createSectionRequests();

  if (!app.guest) {
    void app.hasPermission("use").then((allowed) => {
      if (allowed) store.start();
    });
  }
  app.onDispose(() => store.stop());

  const openTab = () => app.tabs.openSingletonTab(VIEW_ID);

  function Panel({ active }: PanelProps) {
    if (!active) return null;
    return <InboxView store={store} compact onOpenAll={openTab} />;
  }

  function AlertsTab() {
    return <AlertsView store={store} sections={sections} />;
  }

  function Toaster() {
    return <AlertToaster store={store} viewId={VIEW_ID} />;
  }

  app.registerRailItem({
    id: VIEW_ID,
    icon: Bell,
    titleKey: "nav.alerts",
    placement: "footer",
    simplePreset: true,
    promotable: true,
    rightDockable: true,
    separatorAfter: false,
    permission: "use",
    useBadge: () => useUnreadCount(store),
  });
  app.registerPanel(VIEW_ID, Panel);
  app.registerTab(VIEW_ID, AlertsTab as ComponentType<TabProps>, {
    icon: Bell,
    titleKey: "nav.alerts",
    singleton: true,
    hostless: true,
    panelFrame: true,
  });

  app.registerSlotContribution("shell.overlay", {
    actionId: "alerts.toaster",
    titleKey: "nav.alerts",
    kind: "component",
    component: Toaster as ComponentType<Record<string, unknown>>,
  });

  app.registerExtension("homepage.widgets", {
    id: "alert_feed",
    name: "Alert Feed",
    description: "Your latest alerts",
    category: "monitoring",
    icon: <Bell size={14} />,
    defaultConfig: DEFAULT_ALERT_FEED_CONFIG,
    defaultSize: { w: GRID_SIZE * 10, h: GRID_SIZE * 10 },
    minSize: { w: GRID_SIZE * 6, h: GRID_SIZE * 5 },
    components: {
      view: createAlertFeedWidget(createAlertsApi(app.api), store) as never,
      editForm: AlertFeedEditForm as never,
      label: AlertFeedLabel as never,
    },
  });

  app.registerAction("alerts.open", () => openTab());
  app.registerAction("alerts.openChannels", () => {
    sections.request("channels");
    openTab();
  });

  app.registerSlotContribution("onboarding.features", {
    actionId: "alerts.feature",
    titleKey: "onboarding.feature",
    descriptionKey: "onboarding.featureDesc",
    icon: Bell as ComponentType<{ className?: string }>,
  });
}
