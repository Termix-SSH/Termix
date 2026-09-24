import { Workflow } from "lucide-react";
import type {
  PanelProps,
  TabProps,
  TermixApp,
} from "@termix/plugin-sdk/frontend";
import { AutomationsPanel } from "./AutomationsPanel";
import { createAutomationsApi } from "./automations-api";

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
