import type { TermixApp } from "@termix/plugin-sdk/frontend";
import { TotpChallenge } from "./TotpChallenge";
import { TotpEnrollment } from "./TotpEnrollment";

export function activate(app: TermixApp): void {
  app.registerSecondFactorUI({
    id: "totp",
    titleKey: "title",
    component: TotpChallenge,
    enrollment: TotpEnrollment,
  });
}
