import type { ComponentType } from "react";
import { Radar } from "lucide-react";
import type { PanelProps, TermixApp } from "@termix/plugin-sdk/frontend";
import type { PluginHostRecord as Host } from "@termix/plugin-sdk/frontend";
import { TailscaleDevicesPanel } from "./TailscaleDevicesPanel";
import { setTailscaleApi } from "./tailscale-api";
import { TailscaleDevicesStatus } from "./TailscaleDevicesStatus";
import { TailscaleAuthEditor } from "./TailscaleAuthEditor";
import { TailscaleCheckOverlay } from "./TailscaleCheckOverlay";
import { TailscaleManagerCard } from "./TailscaleManagerCard";

function Panel({ shell }: PanelProps) {
  return (
    <TailscaleDevicesPanel
      onConnect={(host: Host, type) =>
        shell.openTab(
          host as unknown as Parameters<typeof shell.openTab>[0],
          type,
        )
      }
      onAddHost={
        shell.openHostEditor
          ? (draft) => shell.openHostEditor!(draft)
          : undefined
      }
    />
  );
}

export function activate(app: TermixApp): void {
  setTailscaleApi(app.api);
  app.onDispose(() => setTailscaleApi(null));
  app.registerRailItem({
    id: "tailscale",
    icon: Radar,
    titleKey: "nav.tailscale",
    after: "macros",
    order: 20,
  });
  app.registerPanel("tailscale", Panel);

  app.registerSettingsComponent("devices", TailscaleDevicesStatus);

  // "tailscale" as a host's SSH auth method: pick a device from the tailnet.
  app.registerSshAuthEditor({
    authType: "tailscale",
    titleKey: "nav.tailscale",
    hintKey: "hosts.tailscaleUsernameHint",
    component: TailscaleAuthEditor,
  });

  // Approval prompts while Tailscale SSH holds a connection open.
  app.registerSlotContribution("terminal.overlay", {
    actionId: "tailscale.check",
    titleKey: "terminal.tailscaleCheckRequired",
    kind: "component",
    component: TailscaleCheckOverlay as unknown as ComponentType<
      Record<string, unknown>
    >,
  });

  // The Host Metrics manager card, present only when host-metrics is running.
  app.registerSlotContribution("host-metrics.managers", {
    actionId: "tailscale_manager",
    titleKey: "manager.title",
    kind: "component",
    component: TailscaleManagerCard as unknown as ComponentType<
      Record<string, unknown>
    >,
  });
}
