import { describe, expect, it } from "vitest";
import {
  ENROLLMENT_SLOT,
  registerLoginMethod,
  registerSecondFactor,
} from "@/plugin-host/auth-registry";
import { getSlotContributions } from "@/shell/action-registry";

function Screen() {
  return null;
}

describe("enrolment screens", () => {
  it("are offered in the enrolment slot while registered", () => {
    const dropKey = registerSecondFactor({
      id: "totp",
      pluginId: "totp",
      titleKey: "totp:title",
      enrollment: Screen,
    });
    const dropPasskey = registerLoginMethod({
      id: "passkey",
      pluginId: "webauthn",
      titleKey: "webauthn:title",
      enrollment: Screen,
    });
    const dropSso = registerLoginMethod({
      id: "oidc",
      pluginId: "sso",
      titleKey: "sso:title",
    });
    expect(
      getSlotContributions(ENROLLMENT_SLOT).map((entry) => entry.actionId),
    ).toEqual([
      "webauthn.enrollment.method.passkey",
      "totp.enrollment.factor.totp",
    ]);
    expect(getSlotContributions(ENROLLMENT_SLOT)[1]).toMatchObject({
      kind: "component",
      component: Screen,
      pluginId: "totp",
      titleKey: "totp:title",
    });
    dropKey();
    dropPasskey();
    dropSso();
    expect(getSlotContributions(ENROLLMENT_SLOT)).toEqual([]);
  });
});
