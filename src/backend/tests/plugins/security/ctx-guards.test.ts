/**
 * Every privileged ctx method checks its capability and leaves an audit line.
 *
 * This walks the whole ctx object rather than listing methods by hand, so a
 * member added later without a guard fails here until it is either guarded
 * or added to UNGATED with a reason.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const auditEntries: Array<Record<string, unknown>> = [];

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentPluginPermissionGrantRepository: () => ({
    listByPlugin: async () => [],
  }),
}));

vi.mock("../../../utils/audit-logger.js", () => ({
  logAudit: async (entry: Record<string, unknown>) => {
    auditEntries.push(entry);
  },
}));

const { createPluginContext, createPluginHandle } =
  await import("../../../plugins/ctx.js");
const { invalidatePluginPermissionCache } =
  await import("../../../plugins/permissions.js");
const { runAsActor } = await import("../../../plugins/actor.js");
const { PluginCapabilityError } = await import("@termix/plugin-sdk/backend");

const PLUGIN_ID = "walker";
const ACTOR = "user-walker";

/**
 * Members that need no capability, and why. Anything not listed here must
 * refuse a plugin that declared and was granted nothing.
 */
const UNGATED: Record<string, string> = {
  "log.debug": "writes to core's log under the plugin's own tag",
  "log.info": "writes to core's log under the plugin's own tag",
  "log.warn": "writes to core's log under the plugin's own tag",
  "log.error": "writes to core's log under the plugin's own tag",
  "events.emit": "namespace check: plugin.<id>.* only without events:core",
  "events.on": "namespace check: plugin.* only without events:core",
  "sync.registerEntity": "adds the plugin's own table to remote sync",
  "registry.provide": "the plugin's own registry key",
  "registry.consume": "reads what another plugin chose to publish",
  "registry.revoke": "removes the plugin's own registry key",
  "services.provide": "only services declared in manifest provides",
  "services.get": "each call is checked against the service's permission",
  "services.providers": "names only",
  "secrets.offer": "only secrets declared in manifest providesSecret",
  "secrets.withdraw": "the plugin's own offer",
  "secrets.getShared": "each read is checked against the secret's permission",
  "settings.get": "the plugin's own admin settings",
  "settings.set": "the plugin's own admin settings",
  "settings.getUser": "the plugin's own user settings",
  "settings.setUser": "the plugin's own user settings",
  "settings.getHost": "the plugin's own host settings",
  "settings.setHost": "the plugin's own host settings",
  "settings.getAll": "the plugin's own settings",
  "settings.onChange": "the plugin's own settings",
  "settings.onValidate": "the plugin's own settings",
  "rbac.has": "answers for the actor only",
  "rbac.hasFor": "a yes/no about a role permission, grants nothing",
  "rbac.require": "route middleware for the plugin's own permissions",
  "capabilities.has": "a yes/no about the plugin's own grants",
  "disposables.add": "the plugin's own cleanup",
  "schedule.every": "the plugin's own timers",
  "schedule.after": "the plugin's own timers",
  "audit.record": "writes under the runtime's actor, never a plugin value",
  asUser: "always audited as plugin_as_user",
  currentActor: "reads the actor, cannot set it",
  "desktop.available": "a yes/no about the environment",
  "http.baseUrl": "reads the request's public origin",
  "ssh.poolKey": "a string built from a host the plugin already holds",
  "ssh.dropPooled": "closes only this plugin's own pooled connections",
  "ssh.classifyKeyboardInteractive": "pure classification of a prompt",
  "ssh.autoResponses": "pure mapping of prompts to answers",
  "ssh.requiresSecret": "a yes/no about an auth type",
  "ssh.supportsBackground": "a yes/no about an auth type",
};

function walk(
  value: unknown,
  path: string[] = [],
  out: Array<{ path: string; fn: (...args: unknown[]) => unknown }> = [],
) {
  if (!value || typeof value !== "object") return out;
  for (const [key, member] of Object.entries(value)) {
    if (path.length === 0 && (key === "manifest" || key === "pluginId")) {
      continue;
    }
    const at = [...path, key];
    if (typeof member === "function") {
      out.push({ path: at.join("."), fn: member as never });
    }
    if (member && typeof member === "object") walk(member, at, out);
  }
  return out;
}

/** Args that get a call past argument checks and into the guard. */
const PLACEHOLDER_ARGS = [
  1,
  { id: 1, ip: "10.0.0.1", port: 22, username: "u", type: "x" },
  { purpose: "background", pool: "p" },
  () => undefined,
];

function contextWithNothing() {
  const handle = createPluginHandle(PLUGIN_ID, { activate: () => {} });
  return createPluginContext(
    {
      id: PLUGIN_ID,
      name: "Walker",
      version: "1.0.0",
      description: "",
      author: { name: "test" },
      license: "MIT",
      category: "Productivity",
      engine: { termix: ">=2.9.0", api: "1" },
      capabilities: [],
    } as never,
    handle,
  );
}

beforeEach(() => {
  auditEntries.length = 0;
  invalidatePluginPermissionCache();
});

describe("every privileged ctx member is guarded", () => {
  const members = walk(contextWithNothing());

  it("finds the members it walks", () => {
    expect(members.length).toBeGreaterThan(60);
    for (const name of Object.keys(UNGATED)) {
      expect(
        members.some((member) => member.path === name),
        `UNGATED lists ${name}, which ctx no longer has`,
      ).toBe(true);
    }
  });

  const gated = members.filter((member) => !(member.path in UNGATED));

  it.each(gated.map((member) => [member.path]))(
    "%s refuses a plugin with no grants and audits it",
    async (path) => {
      const ctx = contextWithNothing();
      const member = walk(ctx).find((entry) => entry.path === path)!;

      let caught: unknown;
      await runAsActor(ACTOR, "request", async () => {
        try {
          await member.fn(...PLACEHOLDER_ARGS);
        } catch (error) {
          caught = error;
        }
      });
      // Sync refusals write their audit line in the background.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(
        caught,
        `${path} ran without a capability. Guard it, or add it to UNGATED with a reason.`,
      ).toBeInstanceOf(PluginCapabilityError);
      expect(
        auditEntries.some(
          (entry) =>
            entry.resourceId === PLUGIN_ID &&
            entry.userId === ACTOR &&
            entry.success === false,
        ),
        `${path} refused without an audit line naming the plugin and actor`,
      ).toBe(true);
    },
  );
});
