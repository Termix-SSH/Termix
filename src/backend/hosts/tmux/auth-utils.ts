import type { SSHHost } from "../../../types/index.js";

export function getTmuxAuthBehavior(authType: SSHHost["authType"]): {
  credentialless: boolean;
  tryKeyboard: boolean;
} {
  return {
    credentialless: authType === "none" || authType === "tailscale",
    tryKeyboard: authType !== "tailscale",
  };
}
