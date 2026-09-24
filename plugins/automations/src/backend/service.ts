import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { AutomationDefinition, RunStatus } from "../types.js";
import type { Deps } from "./deps.js";
import type { AutomationEngine } from "./engine.js";
import type { AutomationRepository } from "./repository.js";
import { missingPlugins, parseDefinition } from "./requirements.js";
import { syncSchedule } from "./routes.js";
import { validateDefinition } from "./validate.js";

export interface AutomationSummary {
  id: number;
  name: string;
  description: string | null;
  enabled: boolean;
  triggerKind: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  missingPlugins: string[];
}

/**
 * The "automations.access" service, version 1. Runs as the caller's user,
 * gated on automations.view; create and run also need automations.create and
 * automations.run.
 */
export interface AutomationsAccessV1 {
  list: () => Promise<AutomationSummary[]>;
  get: (
    id: number,
  ) => Promise<
    (AutomationSummary & { definition: AutomationDefinition | null }) | null
  >;
  /**
   * Validates the definition the same way the create route does. Starts
   * disabled unless `enabled` is set, so an automation nobody watched run
   * does not start firing on its own.
   */
  create: (input: {
    name: string;
    description?: string | null;
    definition: unknown;
    enabled?: boolean;
  }) => Promise<{ id: number; name: string }>;
  run: (
    id: number,
    options?: { dryRun?: boolean },
  ) => Promise<{ runId: number | null; status: RunStatus; error?: string }>;
}

export function createAutomationsService(
  ctx: PluginContext,
  repository: AutomationRepository,
  engine: Pick<AutomationEngine, "run">,
  deps: Deps,
): AutomationsAccessV1 {
  const actor = (method: string) => {
    const userId = ctx.currentActor();
    if (!userId) throw new Error(`automations.access.${method} needs an actor`);
    return userId;
  };
  const summarize = (
    row: Awaited<ReturnType<AutomationRepository["list"]>>[number],
  ) => {
    const definition = parseDefinition(row.definition);
    if (definition?.trigger?.kind === "webhook") {
      definition.trigger = { ...definition.trigger, tokenHash: "" };
    }
    return {
      summary: {
        id: row.id,
        name: row.name,
        description: row.description,
        enabled: !!row.enabled,
        triggerKind: definition?.trigger?.kind ?? null,
        lastRunAt: row.last_run_at,
        lastRunStatus: row.last_run_status,
        missingPlugins: missingPlugins(definition, deps),
      },
      definition,
    };
  };

  return {
    list: async () => {
      const rows = await repository.list(actor("list"));
      return rows.map((row) => summarize(row).summary);
    },

    get: async (id) => {
      const row = await repository.findForUser(id, actor("get"));
      if (!row) return null;
      const { summary, definition } = summarize(row);
      return { ...summary, definition };
    },

    create: async (input) => {
      const userId = actor("create");
      if (!(await ctx.rbac.has("create"))) {
        throw new Error('Creating automations needs "automations.create"');
      }
      const name = typeof input.name === "string" ? input.name.trim() : "";
      if (!name) throw new Error("Name is required");
      const validated = validateDefinition(input.definition);
      if (!validated.ok || !validated.definition) {
        throw new Error(
          validated.error ?? "The automation definition is invalid",
        );
      }
      if (validated.definition.trigger.kind === "webhook") {
        // A webhook's token is only ever shown by the create route.
        throw new Error("Webhook automations are created from the editor");
      }
      const created = await repository.create({
        userId,
        name,
        description: input.description ?? null,
        definition: JSON.stringify(validated.definition),
        enabled: input.enabled ?? false,
      });
      await syncSchedule(repository, created.id, validated.definition);
      return { id: created.id, name: created.name };
    },

    run: async (id, options = {}) => {
      const userId = actor("run");
      if (!(await ctx.rbac.has("run"))) {
        throw new Error('Running automations needs "automations.run"');
      }
      const existing = await repository.findForUser(id, userId);
      if (!existing) throw new Error("Automation not found");
      return engine.run({
        automationId: id,
        triggerType: "manual",
        triggerContext: { manual: true, requestedBy: userId },
        dryRun: options.dryRun === true,
      });
    },
  };
}
