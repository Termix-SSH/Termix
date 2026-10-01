import type { ComponentType } from "react";
import type { TermixApp } from "@termix/plugin-sdk/frontend";
import { VaultAuthEditor } from "./VaultAuthEditor";
import { VaultOverlay } from "./VaultOverlay";
import { RedirectUriSetting } from "./RedirectUriSetting";

export function activate(app: TermixApp): void {
  app.registerSshAuthEditor({
    authType: "vault",
    titleKey: "hosts.filterAuthVault",
    component: VaultAuthEditor,
  });

  // The Vault sign-in while a terminal connects to a Vault host.
  app.registerSlotContribution("terminal.overlay", {
    actionId: "vault.signIn",
    titleKey: "dialog.title",
    kind: "component",
    component: VaultOverlay as unknown as ComponentType<
      Record<string, unknown>
    >,
  });

  app.registerSettingsComponent("redirectUri", RedirectUriSetting);
}

export function deactivate(): void {
  // Registrations through app are disposed by core.
}
