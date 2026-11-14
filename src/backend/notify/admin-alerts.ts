/**
 * Tells every admin about changes that matter if an admin account is taken
 * over: new admins, role and plugin changes, sign-in settings, API keys.
 * Built on the audit log, so anything audited this way alerts, and lives in
 * core so turning a plugin off can't silence it.
 */

import { onAuditEntry, type AuditHookEntry } from "../utils/audit-hooks.js";
import { sendCoreAlert } from "./core-notify.js";

const BATCH_MS = 3000;
const MAX_LINES = 20;

const SIGN_IN_CAPABILITIES = ["auth:provide", "auth:policy"];

type Describe = (entry: AuditHookEntry) => string | null;

function detail<T = unknown>(entry: AuditHookEntry, key: string): T | null {
  if (!entry.details) return null;
  try {
    const parsed = JSON.parse(entry.details) as Record<string, unknown>;
    return (parsed?.[key] as T) ?? null;
  } catch {
    return null;
  }
}

function target(entry: AuditHookEntry): string {
  return entry.resourceName || entry.resourceId || "unknown";
}

/** Whether a running or installed plugin can change how people sign in. */
async function isSignInPlugin(pluginId: string): Promise<boolean> {
  try {
    const { getPluginRuntime } = await import("../plugins/index.js");
    const plugin = getPluginRuntime()
      .loader.list()
      .find((item) => item.id === pluginId);
    return !!plugin?.manifest.capabilities.some((capability) =>
      SIGN_IN_CAPABILITIES.includes(capability),
    );
  } catch {
    return false;
  }
}

const DESCRIBE: Record<string, Describe> = {
  make_admin: (e) => `${e.username} made ${target(e)} an admin`,
  remove_admin: (e) => `${e.username} removed admin from ${target(e)}`,
  admin_reset_password: (e) =>
    `${e.username} reset the password of ${target(e)}`,
  admin_reset_second_factors: (e) =>
    `${e.username} removed the second factors of ${target(e)}`,
  create_role: (e) => `${e.username} created the role ${target(e)}`,
  update_role: (e) =>
    detail(e, "permissions")
      ? `${e.username} changed the permissions of the role ${target(e)}`
      : `${e.username} changed the role ${target(e)}`,
  delete_role: (e) => `${e.username} deleted the role ${target(e)}`,
  assign_role: (e) =>
    `${e.username} gave the role ${target(e)} to a user (${detail(e, "targetUserId")})`,
  remove_role: (e) =>
    `${e.username} took the role ${target(e)} from a user (${detail(e, "targetUserId")})`,
  install_plugin: (e) => `${e.username} installed the plugin ${target(e)}`,
  install_plugin_from_file: (e) =>
    `${e.username} installed the plugin ${target(e)} from a file`,
  update_plugin: (e) => `${e.username} updated the plugin ${target(e)}`,
  restore_bundled_plugin: (e) =>
    `${e.username} restored the bundled plugin ${target(e)}`,
  enable_plugin: (e) => `${e.username} turned on the plugin ${target(e)}`,
  grant_plugin_capability: (e) =>
    `${e.username} gave the plugin ${target(e)} the capability ${detail(e, "capability")}`,
  add_plugin_registry: (e) =>
    `${e.username} added the plugin registry ${target(e)}`,
  enable_plugin_registry: (e) =>
    `${e.username} turned on the plugin registry ${target(e)}`,
  plugin_developer_mode: (e) =>
    detail(e, "enabled") === true
      ? `${e.username} turned on plugin developer mode`
      : null,
  update_auth_setting: (e) =>
    `${e.username} set ${target(e)} to ${detail(e, "value")}`,
  create_api_key: (e) =>
    `${e.username} created the API key ${target(e)} for ${detail(e, "targetUsername") ?? "a user"}`,
  revoke_everyone_sessions: (e) => `${e.username} signed everyone out`,
  admin_hold_failed: (e) =>
    `A waiting admin change could not be applied: ${detail(e, "summary")}`,
  revocation_check_failed: () =>
    "The plugin revocation list could not be checked. Revoked plugins may keep running until it works again",
  recovery_reset_second_factor: (e) =>
    `Someone on the server removed the second factors of ${target(e)}`,
  recovery_revoke_sessions: (e) =>
    `Someone on the server signed out ${target(e)}`,
};

/** Lines that only matter when the plugin changes how people sign in. */
const SIGN_IN_PLUGIN_ACTIONS: Record<string, Describe> = {
  disable_plugin: (e) =>
    `${e.username} turned off the sign-in plugin ${target(e)}`,
  uninstall_plugin: (e) =>
    `${e.username} removed the sign-in plugin ${target(e)}`,
  update_plugin_settings: (e) =>
    `${e.username} changed the settings of the sign-in plugin ${target(e)}`,
};

/** What an admin alert says about this line, or null for none. */
export async function describeAuditEntry(
  entry: AuditHookEntry,
): Promise<string | null> {
  const failureAllowed =
    entry.action === "revocation_check_failed" ||
    entry.action === "admin_hold_failed";
  if (!entry.success && !failureAllowed) return null;
  const direct = DESCRIBE[entry.action];
  if (direct) return direct(entry);
  const signIn = SIGN_IN_PLUGIN_ACTIONS[entry.action];
  if (signIn && entry.resourceId && (await isSignInPlugin(entry.resourceId))) {
    return signIn(entry);
  }
  return null;
}

let pending: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let stop: (() => void) | null = null;

async function flush(): Promise<void> {
  flushTimer = null;
  const lines = pending;
  pending = [];
  if (lines.length === 0) return;
  const shown = lines.slice(0, MAX_LINES);
  const more = lines.length - shown.length;
  await sendCoreAlert({
    title:
      lines.length === 1
        ? "Security change on this server"
        : `${lines.length} security changes on this server`,
    body:
      shown.join("\n") +
      (more > 0 ? `\nand ${more} more. See the audit log.` : ""),
    severity: "warning",
    category: "termix.admin-change",
    audience: "admins",
  });
}

async function handle(entry: AuditHookEntry): Promise<void> {
  const line = await describeAuditEntry(entry);
  if (!line) return;
  pending.push(line);
  // Changes made together (update all) arrive as one alert.
  if (!flushTimer) {
    flushTimer = setTimeout(() => void flush(), BATCH_MS);
    flushTimer.unref?.();
  }
}

export function startAdminAlerts(): void {
  if (stop) return;
  stop = onAuditEntry((entry) => {
    void handle(entry).catch(() => undefined);
  });
}

/** Test seam: sends what is waiting right away. */
export async function flushAdminAlertsForTests(): Promise<void> {
  if (flushTimer) clearTimeout(flushTimer);
  await flush();
}

export function stopAdminAlerts(): void {
  stop?.();
  stop = null;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  pending = [];
}
