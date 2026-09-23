import { Boxes } from "lucide-react";
import type {
  PanelProps,
  TabProps,
  TermixApp,
} from "@termix/plugin-sdk/frontend";
import { FleetsPanel } from "./FleetsPanel";
import { FleetInventoryTab } from "./FleetInventoryTab";
import { listFleets } from "./fleets-api";

const INVENTORY_TAB = "fleet-inventory";

function Panel({ active, shell }: PanelProps) {
  return (
    <FleetsPanel
      active={active}
      onOpenFleetInventory={(fleetId) =>
        shell.openSingletonTab(INVENTORY_TAB, { data: { fleetId } })
      }
    />
  );
}

function InventoryTab({ tab, isVisible }: TabProps) {
  const fleetId = tab.data?.fleetId;
  return (
    <FleetInventoryTab
      fleetId={typeof fleetId === "number" ? fleetId : undefined}
      isVisible={isVisible}
    />
  );
}

export function activate(app: TermixApp): void {
  app.registerRailItem({
    id: "fleets",
    icon: Boxes,
    titleKey: "nav.fleets",
    after: "macros",
    order: 10,
  });

  // Kept mounted so a fleet being edited survives switching panels.
  app.registerPanel("fleets", Panel, { keepMounted: true });

  app.registerTab(INVENTORY_TAB, InventoryTab, {
    icon: Boxes,
    titleKey: "nav.fleets",
    singleton: true,
    hostless: true,
  });

  // Other plugins (automations' host picker) list fleets through this.
  app.registerAction("fleets.list", () => listFleets());
}
