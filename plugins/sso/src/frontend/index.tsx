import type { TermixApp } from "@termix/plugin-sdk/frontend";
import { OidcLoginButtons } from "./OidcLoginButtons";
import { ProvidersSetting } from "./ProvidersSetting";

export function activate(app: TermixApp): void {
  app.registerLoginMethod({
    id: "oidc",
    titleKey: "loginWithSso",
    component: OidcLoginButtons,
  });
  app.registerSettingsComponent("providers", ProvidersSetting);
}
