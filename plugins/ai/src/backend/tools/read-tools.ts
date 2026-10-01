import type { PluginHostSummary } from "@termix/plugin-sdk/backend";
import { num, objectSchema, str, type AiTool } from "./types.js";
import { readService, SERVICE } from "../services.js";
import { isReadOnlyCommand } from "./command-allowlist.js";
import { runCommandOnHost } from "./executor.js";

/** Output handed back to the model is capped; a log can be huge. */
const MAX_COMMAND_OUTPUT = 8000;

/**
 * Read tools project explicit fields rather than spreading rows. Redaction runs
 * afterwards as a second line of defense, but the projection here is the
 * primary control: a field that is never selected cannot leak.
 */

function splitTags(tags: string | null): string[] {
  if (!tags) return [];
  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function toHostSummary(host: PluginHostSummary) {
  return {
    id: host.id,
    name: host.name ?? null,
    ip: host.ip,
    port: host.port,
    username: host.username,
    folder: host.folder ?? null,
    tags: splitTags(host.tags),
    authType: host.authType,
  };
}

export const readTools: AiTool[] = [
  {
    name: "run_readonly_command",
    description:
      "Run a read-only diagnostic command on a host and get its output, for example df -h, uptime, free -m or systemctl status nginx. Only commands on a fixed read-only allowlist run; anything else must be proposed with propose_run_command.",
    category: "read",
    requiresReadOnlyCommands: true,
    parameters: objectSchema(
      {
        hostId: num("The host id, as returned by list_hosts"),
        command: str("The command to run"),
      },
      ["hostId", "command"],
    ),
    handler: async (args, context) => {
      if (!context.allowReadOnlyCommands) {
        return { error: "The user has not allowed read-only commands" };
      }
      const hostId = Number(args.hostId);
      const command = typeof args.command === "string" ? args.command : "";
      const check = isReadOnlyCommand(command);
      if (!check.allowed) {
        return { error: check.reason ?? "Command is not read-only" };
      }
      const access = await context.deps.hosts.checkAccess(hostId, "connect");
      if (!access.hasAccess) return { error: "Host not found" };

      const result = await runCommandOnHost(context.deps, hostId, command);
      await context.deps.audit
        .record({
          action: "ai_readonly_command",
          resourceType: "host",
          resourceId: String(hostId),
          details: JSON.stringify({ command }),
          success: !result.error,
          errorMessage: result.error,
        })
        .catch(() => undefined);
      if (result.error) return { error: result.error };
      return { output: (result.output ?? "").slice(0, MAX_COMMAND_OUTPUT) };
    },
  },
  {
    name: "list_hosts",
    description:
      "List the user's SSH hosts with their names, addresses, folders and tags. Never returns passwords or keys. Call this before proposing anything that references a host.",
    category: "read",
    parameters: objectSchema({}),
    handler: async (_args, context) => {
      const hosts = await context.deps.hosts.list();
      return { hosts: hosts.map(toHostSummary) };
    },
  },
  {
    name: "get_host",
    description:
      "Get one host's non-secret configuration by id. Use it to inspect settings before proposing an update.",
    category: "read",
    parameters: objectSchema(
      { hostId: num("The host id, as returned by list_hosts") },
      ["hostId"],
    ),
    handler: async (args, context) => {
      const host = await context.deps.hosts.get(Number(args.hostId));
      if (!host) return { error: "Host not found" };
      return { host: toHostSummary(host) };
    },
  },
  {
    name: "list_fleets",
    description:
      "List the user's fleets. Fleets group hosts for bulk operations and inventory.",
    category: "read",
    service: SERVICE.fleets,
    parameters: objectSchema({}),
    handler: async (_args, context) => {
      const fleets = await readService(
        context.deps.services,
        SERVICE.fleets,
        (fleetsAccess) => fleetsAccess.list(),
      );
      if (fleets === null) return { unavailable: true, fleets: [] };
      return {
        fleets: fleets.map((fleet) => ({ id: fleet.id, name: fleet.name })),
      };
    },
  },
  {
    name: "list_snippets",
    description:
      "List the user's saved command snippets, including their folder and the command text.",
    category: "read",
    service: SERVICE.snippets,
    parameters: objectSchema({}),
    handler: async (_args, context) => {
      const snippets = await readService(
        context.deps.services,
        SERVICE.snippets,
        (snippetsAccess) => snippetsAccess.list(),
      );
      if (!snippets) return { unavailable: true, snippets: [] };
      return {
        snippets: snippets.map((snippet) => ({
          id: snippet.id,
          name: snippet.name,
          content: snippet.content,
          folder: snippet.folder ?? null,
          description: snippet.description ?? null,
        })),
      };
    },
  },
  {
    name: "list_automations",
    description:
      "List the user's automations with their trigger kind and enabled state. Read this before proposing a change to an existing automation.",
    category: "read",
    service: SERVICE.automations,
    parameters: objectSchema({}),
    handler: async (_args, context) => {
      const automations = await readService(
        context.deps.services,
        SERVICE.automations,
        (automationsAccess) => automationsAccess.list(),
      );
      if (!automations) return { automations: [], unavailable: true };
      return {
        automations: automations.map((automation) => ({
          id: automation.id,
          name: automation.name,
          description: automation.description,
          enabled: automation.enabled,
          triggerKind: automation.triggerKind,
          lastRunAt: automation.lastRunAt,
          lastRunStatus: automation.lastRunStatus,
          needsPlugins: automation.missingPlugins,
        })),
      };
    },
  },
  {
    name: "get_automation",
    description:
      "Get one automation's full definition (trigger and steps) by id.",
    category: "read",
    service: SERVICE.automations,
    parameters: objectSchema(
      {
        automationId: num("The automation id, as returned by list_automations"),
      },
      ["automationId"],
    ),
    handler: async (args, context) => {
      const result = await readService(
        context.deps.services,
        SERVICE.automations,
        async (automationsAccess) => ({
          automation: await automationsAccess.get(Number(args.automationId)),
        }),
      );
      if (result === null) return { unavailable: true };
      const { automation } = result;
      if (!automation) return { error: "Automation not found" };
      return {
        automation: {
          id: automation.id,
          name: automation.name,
          enabled: automation.enabled,
          definition: automation.definition,
        },
      };
    },
  },
  {
    name: "list_workspaces",
    description:
      "List the user's saved workspace layouts (named sets of open tabs and splits).",
    category: "read",
    service: SERVICE.workspaces,
    parameters: objectSchema({}),
    handler: async (_args, context) => {
      const workspaces = await readService(
        context.deps.services,
        SERVICE.workspaces,
        (saved) => saved.list(),
      );
      if (workspaces === null) return { workspaces: [], unavailable: true };
      return { workspaces };
    },
  },
  {
    name: "list_notification_channels",
    description:
      "List the user's notification channels by id, name and type. Channel configuration is never returned because it holds tokens.",
    category: "read",
    parameters: objectSchema({}),
    handler: async (_args, context) => {
      const channels = await context.deps.notify.channels();
      return {
        channels: channels.map((channel) => ({
          id: channel.id,
          name: channel.name,
          type: channel.type,
          enabled: channel.enabled,
        })),
      };
    },
  },
  {
    name: "list_homepage_items",
    description: "List the user's homepage service-link tiles.",
    category: "read",
    service: SERVICE.homepage,
    parameters: objectSchema({}),
    handler: async (_args, context) => {
      const items = await readService(
        context.deps.services,
        SERVICE.homepage,
        (homepage) => homepage.list(),
      );
      if (items === null) return { items: [], unavailable: true };
      return {
        items: items.map((item) => ({
          id: item.id,
          typeId: item.typeId,
          title: item.title ?? null,
        })),
      };
    },
  },
  {
    name: "get_command_history",
    description:
      "Recent commands the user has run on one host, newest first. Useful for understanding what they have been working on.",
    category: "read",
    service: SERVICE.history,
    parameters: objectSchema(
      {
        hostId: num("The host id, as returned by list_hosts"),
        limit: num("How many entries to return (default 25, max 100)"),
      },
      ["hostId"],
    ),
    handler: async (args, context) => {
      const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 100);
      const hostId = Number(args.hostId);

      // Access is checked here rather than trusted from the model.
      const host = await context.deps.hosts.get(hostId);
      if (!host) return { error: "Host not found" };

      const history = await readService(
        context.deps.services,
        SERVICE.history,
        (terminalHistory) => terminalHistory.list(hostId, limit),
      );
      if (history === null) return { commands: [], unavailable: true };
      return { commands: history.map((entry) => entry.command) };
    },
  },
  {
    name: "get_network_topology",
    description: "The user's saved network topology graph, if they have one.",
    category: "read",
    service: SERVICE.topology,
    parameters: objectSchema({}),
    handler: async (_args, context) => {
      const result = await readService(
        context.deps.services,
        SERVICE.topology,
        async (graph) => ({ topology: await graph.get() }),
      );
      if (result === null) return { topology: null, unavailable: true };
      return { topology: result.topology };
    },
  },
];
