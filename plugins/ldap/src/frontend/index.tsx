import type { TermixApp } from "@termix/plugin-sdk/frontend";
import { LdapLoginForms } from "./LdapLoginForms";
import { ProvidersSetting } from "./ProvidersSetting";

export function activate(app: TermixApp): void {
  app.registerLoginMethod({
    id: "ldap",
    titleKey: "loginWithLdap",
    component: LdapLoginForms,
  });
  app.registerSettingsComponent("providers", ProvidersSetting);
}
