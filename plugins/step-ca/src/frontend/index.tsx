import type { ComponentType } from "react";
import type { TermixApp } from "@termix/plugin-sdk/frontend";
import { StepCaAuthEditor } from "./StepCaAuthEditor";
import { StepCaOverlay } from "./StepCaOverlay";
import { RedirectUriSetting } from "./RedirectUriSetting";

export function activate(app: TermixApp): void {
  app.registerSshAuthEditor({
    authType: "stepca",
    titleKey: "hosts.filterAuthStepca",
    component: StepCaAuthEditor,
  });

  // The browser sign-in while a terminal connects to a Step CA host.
  app.registerSlotContribution("terminal.overlay", {
    actionId: "step-ca.signIn",
    titleKey: "dialog.title",
    kind: "component",
    component: StepCaOverlay as unknown as ComponentType<
      Record<string, unknown>
    >,
  });

  app.registerSettingsComponent("redirectUri", RedirectUriSetting);
}

export function deactivate(): void {
  // Registrations through app are disposed by core.
}
