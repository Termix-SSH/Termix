/**
 * Who may run what without a person saying yes.
 *
 * A plugin fills this through ctx.operations.approvals.provide. Core asks every
 * provider and the strictest answer wins. A provider that throws denies the
 * run, since skipping a safety rule is worse than a refused action.
 */

import type { OperationRisk } from "@termix-ssh/plugin-sdk/operations";
import { riskRank } from "@termix-ssh/plugin-sdk/operations";
import { hasCapability } from "../plugins/permissions.js";
import { pluginLogger } from "../utils/logger.js";
import type { ActorOrigin } from "../plugins/actor.js";
import type { PluginManifest } from "../plugins/manifest.js";

export interface ApprovalPolicyInput {
  actionId: string;
  pluginId: string;
  /** What the plugin declared. */
  risk: OperationRisk;
  /** What rules should use. Plugins not signed as official count as change. */
  effectiveRisk: OperationRisk;
  origin: ActorOrigin;
  userId: string;
  hostId?: number;
  hostTags?: string[];
  batchId?: string;
}

export interface ApprovalDecision {
  decision: "allow" | "approve" | "deny";
  reason?: string;
  /** The requester may approve their own run. */
  allowSelf?: boolean;
  expiresInMinutes?: number;
}

export type ApprovalPolicyProvider = (
  input: ApprovalPolicyInput,
) =>
  | ApprovalDecision
  | null
  | undefined
  | Promise<ApprovalDecision | null | undefined>;

interface Entry {
  pluginId: string;
  manifest: PluginManifest;
  provider: ApprovalPolicyProvider;
}

const providers = new Map<symbol, Entry>();

export function provideApprovalPolicy(
  pluginId: string,
  manifest: PluginManifest,
  provider: ApprovalPolicyProvider,
): () => void {
  const key = Symbol(pluginId);
  providers.set(key, { pluginId, manifest, provider });
  return () => {
    providers.delete(key);
  };
}

/** Test seam. */
export function clearApprovalPolicies(): void {
  providers.clear();
}

const RANK = { allow: 0, approve: 1, deny: 2 } as const;
// approved: a person approved this exact request in the plugin's own UI.
const TRUSTED_VIA = new Set(["automation", "rollout", "fleet", "approved"]);
const SELF_APPROVE_VIA = new Set(["assistant", "mcp", "automation"]);

/** A person is the check when the request came from something else. */
export function canSelfApprove(origin: ActorOrigin): boolean {
  return origin.kind === "plugin" && SELF_APPROVE_VIA.has(origin.via ?? "");
}

/**
 * Used when no provider has an opinion. People and their own keys go by RBAC,
 * and so do automations they set up. Anything else needs a rule that allows it.
 */
function builtIn(input: ApprovalPolicyInput): ApprovalDecision {
  if (riskRank(input.effectiveRisk) === 0) return { decision: "allow" };
  if (input.origin.kind !== "plugin") return { decision: "allow" };
  if (TRUSTED_VIA.has(input.origin.via ?? "")) return { decision: "allow" };
  return {
    decision: "deny",
    reason: "This needs an approval rule. Turn on approvals to allow it.",
  };
}

export async function evaluateApproval(
  input: ApprovalPolicyInput,
): Promise<ApprovalDecision> {
  let strictest: ApprovalDecision | null = null;
  for (const entry of providers.values()) {
    let decision: ApprovalDecision | null | undefined;
    try {
      // Rechecked at use, so a revoked grant stops the provider now.
      if (
        !(await hasCapability(
          entry.pluginId,
          "operations:approve",
          entry.manifest.capabilities,
        ))
      ) {
        continue;
      }
      decision = await entry.provider(input);
    } catch (error) {
      pluginLogger.warn("Approval rule failed, refusing the run", {
        operation: "operation_approval",
        pluginId: entry.pluginId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        decision: "deny",
        reason: "Approval rules are not available right now.",
      };
    }
    if (!decision) continue;
    if (!strictest || RANK[decision.decision] > RANK[strictest.decision]) {
      strictest = decision;
    }
  }
  return strictest ?? builtIn(input);
}
