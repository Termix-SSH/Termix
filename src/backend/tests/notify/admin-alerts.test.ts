import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendCoreAlert = vi.fn();
const plugins: Array<{ id: string; manifest: { capabilities: string[] } }> = [];

vi.mock("../../notify/core-notify.js", () => ({
  sendCoreAlert: (...args: unknown[]) => sendCoreAlert(...args),
}));
vi.mock("../../plugins/index.js", () => ({
  getPluginRuntime: () => ({ loader: { list: () => plugins } }),
}));

import {
  describeAuditEntry,
  flushAdminAlertsForTests,
  startAdminAlerts,
  stopAdminAlerts,
} from "../../notify/admin-alerts.js";
import { emitAuditEntry } from "../../utils/audit-hooks.js";
import type { AuditHookEntry } from "../../utils/audit-hooks.js";

function entry(over: Partial<AuditHookEntry>): AuditHookEntry {
  return {
    userId: "u1",
    username: "alice",
    action: "x",
    resourceType: "x",
    success: true,
    timestamp: new Date(),
    ...over,
  };
}

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("admin alerts", () => {
  beforeEach(() => {
    sendCoreAlert.mockReset();
    plugins.length = 0;
  });
  afterEach(() => stopAdminAlerts());

  it.each([
    ["make_admin", "alice made bob an admin"],
    ["create_role", "alice created the role bob"],
    ["update_role", "alice changed the role bob"],
    ["assign_role", "alice gave the role bob to a user (null)"],
    ["install_plugin", "alice installed the plugin bob"],
    ["update_plugin", "alice updated the plugin bob"],
    ["enable_plugin", "alice turned on the plugin bob"],
    ["plugin_unisolated_on", "alice let the plugin bob run without isolation"],
    ["create_api_key", "alice created the API key bob for a user"],
  ])("describes %s", async (action, text) => {
    expect(
      await describeAuditEntry(entry({ action, resourceName: "bob" })),
    ).toBe(text);
  });

  it("names the capability a plugin was given", async () => {
    expect(
      await describeAuditEntry(
        entry({
          action: "grant_plugin_capability",
          resourceName: "docker",
          details: JSON.stringify({ capability: "process:spawn" }),
        }),
      ),
    ).toBe("alice gave the plugin docker the capability process:spawn");
  });

  it("says when role permissions change", async () => {
    expect(
      await describeAuditEntry(
        entry({
          action: "update_role",
          resourceName: "ops",
          details: JSON.stringify({ permissions: ["admin.users.manage"] }),
        }),
      ),
    ).toBe("alice changed the permissions of the role ops");
  });

  it("reports sign-in settings and a failed revocation check", async () => {
    expect(
      await describeAuditEntry(
        entry({
          action: "update_auth_setting",
          resourceName: "allow_password_login",
          details: JSON.stringify({ value: false }),
        }),
      ),
    ).toBe("alice set allow_password_login to false");
    expect(
      await describeAuditEntry(
        entry({ action: "revocation_check_failed", success: false }),
      ),
    ).toMatch(/revocation list could not be checked/);
  });

  it("only reports plugin settings and disables for sign-in plugins", async () => {
    plugins.push(
      { id: "sso", manifest: { capabilities: ["auth:provide"] } },
      { id: "notes", manifest: { capabilities: ["db:own"] } },
    );
    expect(
      await describeAuditEntry(
        entry({ action: "update_plugin_settings", resourceId: "sso" }),
      ),
    ).toMatch(/settings of the sign-in plugin/);
    expect(
      await describeAuditEntry(
        entry({ action: "disable_plugin", resourceId: "sso" }),
      ),
    ).toMatch(/turned off the sign-in plugin/);
    expect(
      await describeAuditEntry(
        entry({ action: "update_plugin_settings", resourceId: "notes" }),
      ),
    ).toBeNull();
  });

  it("skips failures and lines nobody needs to hear about", async () => {
    expect(
      await describeAuditEntry(entry({ action: "make_admin", success: false })),
    ).toBeNull();
    expect(await describeAuditEntry(entry({ action: "login" }))).toBeNull();
    expect(
      await describeAuditEntry(
        entry({
          action: "plugin_developer_mode",
          details: JSON.stringify({ enabled: false }),
        }),
      ),
    ).toBeNull();
  });

  it("sends changes made together as one alert to every admin", async () => {
    startAdminAlerts();
    emitAuditEntry({
      ...entry({ action: "update_plugin", resourceName: "a" }),
    });
    emitAuditEntry({
      ...entry({ action: "update_plugin", resourceName: "b" }),
    });
    emitAuditEntry({ ...entry({ action: "login" }) });
    await flushMicrotasks();
    await flushAdminAlertsForTests();
    expect(sendCoreAlert).toHaveBeenCalledTimes(1);
    expect(sendCoreAlert.mock.calls[0][0]).toMatchObject({
      audience: "admins",
      title: "2 security changes on this server",
      body: "alice updated the plugin a\nalice updated the plugin b",
    });
  });
});
