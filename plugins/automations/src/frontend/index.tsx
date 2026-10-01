import { Workflow, Wrench } from "lucide-react";
import type {
  PanelProps,
  TabProps,
  TermixApp,
} from "@termix/plugin-sdk/frontend";
import { AutomationsPanel } from "./AutomationsPanel";
import { createAutomationsApi } from "./automations-api";

import { createMaintenanceStore } from "./maintenance-store";
import { HostMaintenance, MaintenanceBadge } from "./HostMaintenance";

const VIEW_ID = "automations";

function Panel({ active, setEditing }: PanelProps) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <AutomationsPanel active={active} onEditingChange={setEditing} />
    </div>
  );
}

function AutomationsTab({ isVisible }: TabProps) {
  return <AutomationsPanel active={isVisible} />;
}

export function activate(app: TermixApp): void {
  const maintenance = createMaintenanceStore(app.api);
  app.onDispose(() => maintenance.dispose());
  app.registerTab(
    "host_maintenance",
    ({ host, isVisible }) =>
      host ? (
        <HostMaintenance host={host} store={maintenance} visible={isVisible} />
      ) : null,
    {
      icon: Wrench,
      titleKey: "maintenance.title",
    },
  );
  app.registerHostAction({
    id: "maintenance",
    titleKey: "maintenance.title",
    icon: Wrench,
    kind: "open",
    tabType: "host_maintenance",
    tray: false,
    when: (host) => Number(host.id) > 0,
  });
  app.registerHostBadge({
    id: "maintenance",
    when: (host) => Number(host.id) > 0,
    component: ({ host }) => (
      <MaintenanceBadge host={host} store={maintenance} />
    ),
  });
  app.registerRailItem({
    id: VIEW_ID,
    icon: Workflow,
    titleKey: "nav.automations",
    promotable: true,
    after: "macros",
    order: 30,
  });
  app.registerPanel(VIEW_ID, Panel);
  app.registerTab(VIEW_ID, AutomationsTab, {
    icon: Workflow,
    titleKey: "nav.automations",
    singleton: true,
    hostless: true,
    panelFrame: true,
  });

  // The assistant's @-mentions list automations through this.
  const api = createAutomationsApi(app.api);
  app.registerAction("automations.list", () => api.list());

  app.registerSlotContribution("onboarding.features", {
    actionId: "automations.feature",
    titleKey: "onboarding.feature_automations",
    descriptionKey: "onboarding.feature_automations_desc",
    icon: Workflow,
  });
}
