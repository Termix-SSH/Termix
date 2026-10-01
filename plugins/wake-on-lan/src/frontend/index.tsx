import { Zap } from "lucide-react";
import type { TermixApp } from "@termix/plugin-sdk/frontend";
import { hasMacAddress, macAddressOf, wakeHost } from "./host-action.js";

export function activate(app: TermixApp): void {
  app.registerHostAction({
    id: "wake-on-lan",
    titleKey: "hostAction.title",
    icon: Zap,
    kind: "open",
    order: 50,
    when: (host) => hasMacAddress(host),
    run: (host) => wakeHost(app.api, app.t, String(host.id)),
  });

  // A saved host's MAC address, for plugins that send their own wake packet.
  app.registerAction("wakeOnLan.macAddress", ((hostId: string | number) =>
    macAddressOf(app.getHost(hostId))) as never);
}
