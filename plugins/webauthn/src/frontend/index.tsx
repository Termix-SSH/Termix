import type { TermixApp } from "@termix/plugin-sdk/frontend";
import { PasskeyLoginButton } from "./PasskeyLoginButton";
import { PasskeyEnrollment } from "./PasskeyEnrollment";

export function activate(app: TermixApp): void {
  app.registerLoginMethod({
    id: "passkey",
    titleKey: "title",
    placement: "inline",
    component: PasskeyLoginButton,
    enrollment: PasskeyEnrollment,
  });
}
