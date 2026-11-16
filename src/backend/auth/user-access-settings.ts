import { getCurrentSettingValue } from "../database/repositories/factory.js";

/** Admin setting: "false" stops admins from opening other users' hosts. */
export const ADMIN_HOST_BYPASS_SETTING = "admin_host_bypass";

/** Admin setting: "true" makes new external accounts wait for approval. */
export const EXTERNAL_SIGNUP_APPROVAL_SETTING = "external_signup_approval";

/** Why an account is turned off. */
export const DISABLED_REASON_ADMIN = "admin";
export const DISABLED_REASON_PENDING = "pending_approval";

function readSetting(key: string): string | null {
  try {
    return getCurrentSettingValue(key);
  } catch {
    return null;
  }
}

export function adminHostBypassEnabled(): boolean {
  return readSetting(ADMIN_HOST_BYPASS_SETTING) !== "false";
}

export function externalSignupApprovalRequired(): boolean {
  return readSetting(EXTERNAL_SIGNUP_APPROVAL_SETTING) === "true";
}
