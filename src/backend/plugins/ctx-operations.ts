/**
 * ctx.operations: declaring what a plugin can do, and asking for another
 * plugin's action to run.
 *
 * invoke acts for the current user, so on its own it would let any plugin spend
 * that user's full authority. It needs the capability, the action named in the
 * manifest's invokes list, and the origin always names the calling plugin, set
 * here from the closure rather than from anything the plugin passes.
 */

import type {
  PluginOperations,
  PluginOperationInvokeOptions,
} from "@termix-ssh/plugin-sdk/backend";
import {
  invokeAllowed,
  type OperationAction,
} from "@termix-ssh/plugin-sdk/operations";
import type { PluginManifest } from "./manifest.js";
import { assertCapability, capabilityRefused } from "./permissions.js";
import { getActor, getActorTrail, type ActorOrigin } from "./actor.js";
import type { DisposableBag } from "./disposables.js";
import {
  registerAction,
  revokeAction,
  type OperationHandler,
} from "../operations/registry.js";
import { provideApprovalPolicy } from "../operations/approvals.js";
import {
  emitOperationEvent,
  subscribeOperationEvents,
} from "../operations/events.js";
import {
  decideOperationApproval,
  drainPlugin,
  OperationError,
  runOperation,
} from "../operations/gate.js";
import { buildCatalog } from "../operations/catalog.js";
import { cancelRunAs, undoRunAs } from "../operations/run-access.js";

interface Deps {
  manifest: PluginManifest;
  bag: DisposableBag;
}

export function createPluginOperations({
  manifest,
  bag,
}: Deps): PluginOperations {
  const pluginId = manifest.id;
  const declared = manifest.capabilities;
  const contribution = manifest.contributes?.operations;
  let drainRegistered = false;

  const declaredAction = (id: string): OperationAction => {
    const action = contribution?.actions?.find((entry) => entry.id === id);
    if (!action) {
      throw new Error(
        `Plugin ${pluginId} cannot register action "${id}": it is not declared in contributes.operations`,
      );
    }
    return action;
  };

  // Core hands in the plugin's live request; a plugin can't pass one. A key
  // could be handed to a script, so these need a person on a session.
  const liveUser = (request: unknown, call: string): string => {
    const req = request as
      | { userId?: string; apiKeyId?: string; apiKeyScopes?: string[] | null }
      | undefined;
    if (!req) {
      throw new OperationError(
        "UNAVAILABLE",
        `ctx.operations.${call} works only inside one of the plugin's own requests`,
      );
    }
    if (!req.userId) {
      throw new OperationError("FORBIDDEN", "Authentication required");
    }
    if (req.apiKeyId || req.apiKeyScopes) {
      throw new OperationError("FORBIDDEN", "API keys can't do this");
    }
    return req.userId;
  };

  const runId = (input: { runId?: unknown } | undefined): string => {
    const id = typeof input?.runId === "string" ? input.runId : "";
    if (!id) throw new OperationError("INVALID_INPUT", "runId is required");
    return id;
  };

  const actingUser = (): string => {
    const userId = getActor();
    if (!userId) {
      throw new Error(
        "ctx.operations needs an acting user: call it inside a request or ctx.asUser",
      );
    }
    return userId;
  };

  return {
    register: (id, handler) => {
      if (!declared.includes("operations:provide")) {
        throw capabilityRefused(pluginId, "operations:provide");
      }
      const registration = registerAction(
        pluginId,
        declaredAction(id),
        handler as OperationHandler,
      );
      bag.add(() => void revokeAction(registration), `action "${id}"`);
      // Added once and after the actions, so disposal, which runs newest
      // first, drains before anything the handlers use is torn down.
      if (!drainRegistered) {
        drainRegistered = true;
        bag.add(() => drainPlugin(pluginId), "operations drain");
      }
    },

    // A plugin's own route running its own action, so a button press lands in
    // the same history. The caller stays the origin, not this plugin.
    run: async (actionId, options = {}) => {
      if (!declared.includes("operations:provide")) {
        throw capabilityRefused(pluginId, "operations:provide");
      }
      declaredAction(actionId);
      const trail = getActorTrail();
      return runOperation({
        actionId,
        hostId: options.hostId,
        resourceKey: options.resourceKey,
        input: options.input,
        dryRun: options.dryRun,
        confirmed: options.confirmed,
        idempotencyKey: options.idempotencyKey,
        batchId: options.batchId,
        userId: actingUser(),
        origin: trail.origin ?? { kind: "plugin", pluginId },
        apiKeyScopes: trail.apiKeyScopes,
        depth: trail.depth,
      });
    },

    invoke: async (actionId, options = {}) => {
      await assertCapability(pluginId, "operations:invoke", declared);
      if (!invokeAllowed(contribution?.invokes, actionId)) {
        throw new OperationError(
          "FORBIDDEN",
          `${pluginId} did not declare that it runs ${actionId}`,
        );
      }
      const trail = getActorTrail();
      const origin: ActorOrigin = {
        kind: "plugin",
        pluginId,
        via: (options as PluginOperationInvokeOptions).via,
      };
      return runOperation({
        actionId,
        hostId: options.hostId,
        resourceKey: options.resourceKey,
        input: options.input,
        dryRun: options.dryRun,
        confirmed: options.confirmed,
        idempotencyKey: options.idempotencyKey,
        batchId: options.batchId,
        userId: actingUser(),
        origin,
        apiKeyScopes: trail.apiKeyScopes,
        depth: trail.depth,
      });
    },

    list: async (options) => {
      await assertCapability(pluginId, "operations:invoke", declared);
      return buildCatalog({
        userId: actingUser(),
        lang: options?.lang,
        surface: options?.surface,
      });
    },

    emit: async (eventId, payload, options) => {
      if (!declared.includes("operations:provide")) {
        throw capabilityRefused(pluginId, "operations:provide");
      }
      const event = contribution?.events?.find((entry) => entry.id === eventId);
      if (!event) {
        throw new Error(
          `Plugin ${pluginId} cannot emit "${eventId}": it is not declared in contributes.operations`,
        );
      }
      await emitOperationEvent({
        eventId,
        pluginId,
        hostId: options?.hostId,
        severity: event.severity,
        payload,
      });
    },

    onEvent: (subscription) => {
      if (!declared.includes("operations:invoke")) {
        throw capabilityRefused(pluginId, "operations:invoke");
      }
      const remove = subscribeOperationEvents(pluginId, subscription);
      bag.add(remove, `events "${subscription.pattern}"`);
      return remove;
    },

    runs: {
      cancel: async (input, request?: unknown) => {
        await assertCapability(pluginId, "operations:invoke", declared);
        const userId = liveUser(request, "runs.cancel");
        const cancelled = await cancelRunAs(runId(input), userId);
        if (cancelled === null) {
          throw new OperationError("NOT_FOUND", "Run not found");
        }
        return { cancelled };
      },

      undo: async (input, request?: unknown) => {
        await assertCapability(pluginId, "operations:invoke", declared);
        const userId = liveUser(request, "runs.undo");
        const outcome = await undoRunAs({
          runId: runId(input),
          userId,
          origin: { kind: "ui" },
          confirmed: input?.confirmed === true,
        });
        if (!outcome) throw new OperationError("NOT_FOUND", "Nothing to undo");
        return outcome;
      },
    },

    approvals: {
      provide: (provider) => {
        if (!declared.includes("operations:approve")) {
          throw capabilityRefused(pluginId, "operations:approve");
        }
        const remove = provideApprovalPolicy(pluginId, manifest, provider);
        bag.add(remove, "approval rules");
        return remove;
      },

      // Core hands in the plugin's live request; a plugin can't pass one.
      decide: async (input, request?: unknown) => {
        if (!declared.includes("operations:approve")) {
          throw capabilityRefused(pluginId, "operations:approve");
        }
        const req = request as
          | {
              userId?: string;
              apiKeyId?: string;
              apiKeyScopes?: string[] | null;
              actingAdminUserId?: string;
            }
          | undefined;
        if (!req) {
          throw new OperationError(
            "UNAVAILABLE",
            "ctx.operations.approvals.decide works only inside one of the plugin's own requests",
          );
        }
        if (!req.userId) {
          throw new OperationError("FORBIDDEN", "Authentication required");
        }
        // A key could be handed to a script, so a person decides from a session.
        if (req.apiKeyId || req.apiKeyScopes) {
          throw new OperationError("FORBIDDEN", "This API key may not approve");
        }
        const approvalId = String(input?.approvalId ?? "");
        if (!approvalId || typeof input?.approve !== "boolean") {
          throw new OperationError(
            "INVALID_INPUT",
            "approvalId and approve are required",
          );
        }
        return decideOperationApproval({
          approvalId,
          approverId: req.userId,
          approve: input.approve,
          comment:
            typeof input.comment === "string" ? input.comment : undefined,
          impersonated: !!req.actingAdminUserId,
        });
      },
    },
  };
}
