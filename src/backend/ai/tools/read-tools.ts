import {
  createCurrentAlertRepository,
  createCurrentAutomationRepository,
  createCurrentCommandHistoryRepository,
  createCurrentFleetRepository,
  createCurrentHomepageItemRepository,
  createCurrentHostRepository,
  createCurrentNetworkTopologyRepository,
  createCurrentSnippetRepository,
  createCurrentWorkspaceRepository,
} from "../../database/repositories/factory.js";
import { num, objectSchema, type AiTool } from "./types.js";

/**
 * Read tools project explicit fields rather than spreading rows. Redaction runs
 * afterwards as a second line of defense, but the projection here is the
 * primary control: a field that is never selected cannot leak.
 */

interface HostSummary {
  id: number;
  name: string | null;
  ip: string | null;
  port: number | null;
  username: string | null;
  folder: string | null;
  tags: unknown;
  protocol: string | null;
  enableTerminal: boolean | null;
  enableFileManager: boolean | null;
  enableTunnel: boolean | null;
  enableDocker: boolean | null;
}

function toHostSummary(host: Record<string, any>): HostSummary {
  return {
    id: host.id,
    name: host.name ?? null,
    ip: host.ip ?? null,
    port: host.port ?? null,
    username: host.username ?? null,
    folder: host.folder ?? null,
    tags: host.tags ?? null,
    protocol: host.protocol ?? null,
    enableTerminal: host.enableTerminal ?? null,
    enableFileManager: host.enableFileManager ?? null,
    enableTunnel: host.enableTunnel ?? null,
    enableDocker: host.enableDocker ?? null,
  };
}

export const readTools: AiTool[] = [
  {
    name: "list_hosts",
    description:
      "List the user's SSH hosts with their names, addresses, folders and tags. Never returns passwords or keys. Call this before proposing anything that references a host.",
    category: "read",
    parameters: objectSchema({}),
    handler: async (_args, context) => {
      const hosts = await createCurrentHostRepository().listByUserId(
        context.userId,
      );
      return { hosts: hosts.map((host) => toHostSummary(host as any)) };
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
      const hostId = Number(args.hostId);
      const host = await createCurrentHostRepository().findByIdForUser(
        context.userId,
        hostId,
      );
      if (!host) return { error: "Host not found" };
      return { host: toHostSummary(host as any) };
    },
  },
  {
    name: "list_fleets",
    description:
      "List the user's fleets. Fleets group hosts for bulk operations and inventory.",
    category: "read",
    parameters: objectSchema({}),
    handler: async (_args, context) => {
      const fleets = await createCurrentFleetRepository().listByUser(
        context.userId,
      );
      return {
        fleets: fleets.map((fleet: any) => ({
          id: fleet.id,
          name: fleet.name,
          description: fleet.description ?? null,
        })),
      };
    },
  },
  {
    name: "list_snippets",
    description:
      "List the user's saved command snippets, including their folder and the command text.",
    category: "read",
    parameters: objectSchema({}),
    handler: async (_args, context) => {
      const snippets = await createCurrentSnippetRepository().listOwnedSnippets(
        context.userId,
      );
      return {
        snippets: snippets.map((snippet: any) => ({
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
    parameters: objectSchema({}),
    handler: async (_args, context) => {
      const automations = await createCurrentAutomationRepository().list(
        context.userId,
      );
      return {
        automations: automations.map((automation: any) => ({
          id: automation.id,
          name: automation.name,
          description: automation.description ?? null,
          enabled: automation.enabled,
          lastRunAt: automation.lastRunAt ?? null,
          lastRunStatus: automation.lastRunStatus ?? null,
        })),
      };
    },
  },
  {
    name: "get_automation",
    description:
      "Get one automation's full definition (trigger and steps) by id.",
    category: "read",
    parameters: objectSchema(
      {
        automationId: num("The automation id, as returned by list_automations"),
      },
      ["automationId"],
    ),
    handler: async (args, context) => {
      const automation = await createCurrentAutomationRepository().findForUser(
        Number(args.automationId),
        context.userId,
      );
      if (!automation) return { error: "Automation not found" };
      return {
        automation: {
          id: (automation as any).id,
          name: (automation as any).name,
          enabled: (automation as any).enabled,
          definition: (automation as any).definition,
        },
      };
    },
  },
  {
    name: "list_workspaces",
    description:
      "List the user's saved workspace layouts (named sets of open tabs and splits).",
    category: "read",
    parameters: objectSchema({}),
    handler: async (_args, context) => {
      const workspaces = await createCurrentWorkspaceRepository().listByUser(
        context.userId,
      );
      return {
        workspaces: workspaces.map((workspace: any) => ({
          id: workspace.id,
          name: workspace.name,
          isDefault: workspace.isDefault ?? false,
        })),
      };
    },
  },
  {
    name: "list_alert_rules",
    description:
      "List the user's alert rules with their thresholds and enabled state.",
    category: "read",
    parameters: objectSchema({}),
    handler: async (_args, context) => {
      const rules = await createCurrentAlertRepository().listAlertRules(
        context.userId,
      );
      return {
        rules: rules.map((rule) => ({
          id: rule.id,
          name: rule.name,
          hostId: rule.host_id,
          enabled: rule.enabled === 1,
          triggerType: rule.trigger_type,
          thresholdValue: rule.threshold_value,
          thresholdDurationSeconds: rule.threshold_duration_seconds,
          cooldownMinutes: rule.cooldown_minutes,
        })),
      };
    },
  },
  {
    name: "list_notification_channels",
    description:
      "List the user's notification channels by id, name and type. Channel configuration is never returned because it holds tokens.",
    category: "read",
    parameters: objectSchema({}),
    handler: async (_args, context) => {
      const channels =
        await createCurrentAlertRepository().listNotificationChannels(
          context.userId,
        );
      return {
        channels: channels.map((channel) => ({
          id: channel.id,
          name: channel.name,
          type: channel.type,
          enabled: channel.enabled === 1,
        })),
      };
    },
  },
  {
    name: "get_alert_firings",
    description:
      "Recent alert firings, newest first. Use this to answer questions about what has been alerting.",
    category: "read",
    parameters: objectSchema({
      limit: num("How many firings to return (default 25, max 100)"),
    }),
    handler: async (args, context) => {
      const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 100);
      const result = await createCurrentAlertRepository().listAlertFirings({
        userId: context.userId,
        limit,
        offset: 0,
      });
      return {
        firings: (result.firings ?? []).map((firing) => ({
          id: firing.id,
          ruleName: firing.rule_name,
          hostName: firing.host_name,
          firedAt: firing.fired_at,
          resolvedAt: firing.resolved_at,
          severity: firing.severity,
          message: firing.message,
          acknowledged: firing.acknowledged === 1,
        })),
      };
    },
  },
  {
    name: "list_homepage_items",
    description: "List the user's homepage service-link tiles.",
    category: "read",
    parameters: objectSchema({}),
    handler: async (_args, context) => {
      const items = await createCurrentHomepageItemRepository().listByUserId(
        context.userId,
      );
      return {
        items: (items as any[]).map((item) => ({
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

      // Ownership is enforced here rather than trusted from the model.
      const host = await createCurrentHostRepository().findByIdForUser(
        context.userId,
        hostId,
      );
      if (!host) return { error: "Host not found" };

      const commands =
        await createCurrentCommandHistoryRepository().listCommandsForHost(
          context.userId,
          hostId,
          limit,
        );
      return { commands };
    },
  },
  {
    name: "get_network_topology",
    description: "The user's saved network topology graph, if they have one.",
    category: "read",
    parameters: objectSchema({}),
    handler: async (_args, context) => {
      const topology =
        await createCurrentNetworkTopologyRepository().findByUserId(
          context.userId,
        );
      if (!topology) return { topology: null };
      return { topology: (topology as any).data ?? null };
    },
  },
];
