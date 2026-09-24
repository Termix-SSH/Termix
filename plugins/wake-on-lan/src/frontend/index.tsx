import { Zap } from "lucide-react";
import type { TermixApp } from "@termix/plugin-sdk/frontend";
import { hasMacAddress, wakeHost } from "./host-action.js";

export function activate(app: TermixApp): void {
  app.registerHostAction({
    id: "wake-on-lan",
    titleKey: "hostAction.title",
    icon: Zap,
    kind: "open",
    order: 50,
    when: (host) => hasMacAddress(host as Record<string, unknown>),
    run: (host) => wakeHost(app.api, app.t, String(host.id)),
  });
}
