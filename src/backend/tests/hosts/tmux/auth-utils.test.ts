import { describe, expect, it } from "vitest";
import { getTmuxAuthBehavior } from "../../../hosts/tmux/auth-utils.js";

describe("getTmuxAuthBehavior", () => {
  it("uses credentialless non-interactive authentication for Tailscale SSH", () => {
    expect(getTmuxAuthBehavior("tailscale")).toEqual({
      credentialless: true,
      tryKeyboard: false,
    });
  });

  it("preserves keyboard-interactive fallback for none authentication", () => {
    expect(getTmuxAuthBehavior("none")).toEqual({
      credentialless: true,
      tryKeyboard: true,
    });
  });

  it("does not treat password authentication as credentialless", () => {
    expect(getTmuxAuthBehavior("password")).toEqual({
      credentialless: false,
      tryKeyboard: true,
    });
  });
});
