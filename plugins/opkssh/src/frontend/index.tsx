import type { ComponentType } from "react";
import type { TermixApp } from "@termix/plugin-sdk/frontend";
import { OpksshAuthEditor } from "./OpksshAuthEditor";
import { OpksshOverlay } from "./OpksshOverlay";
import { RedirectUriSetting } from "./RedirectUriSetting";

export function activate(app: TermixApp): void {
  app.registerSshAuthEditor({
    authType: "opkssh",
    titleKey: "hosts.filterAuthOpkssh",
    component: OpksshAuthEditor,
  });

  // The browser sign-in while a terminal connects to an OPKSSH host.
  app.registerSlotContribution("terminal.overlay", {
    actionId: "opkssh.signIn",
    titleKey: "dialog.title",
    kind: "component",
    component: OpksshOverlay as unknown as ComponentType<
      Record<string, unknown>
    >,
  });

  app.registerSettingsComponent("redirectUri", RedirectUriSetting);
}
