import {
  createCurrentAlertRepository,
  createCurrentAutomationRepository,
  createCurrentFleetRepository,
  createCurrentHostRepository,
  createCurrentSnippetRepository,
} from "../../database/repositories/factory.js";
import { validateDefinition } from "../../database/routes/automations.js";
import { resolveHostById } from "../../hosts/host-resolver.js";
import { execCommand } from "../../hosts/metrics/widgets/common-utils.js";
import {
  createFleetSshFactory,
  getFleetPoolKey,
} from "../../hosts/ssh-client-factory.js";
import { withConnection } from "../../hosts/ssh-connection-pool.js";
import { getTool } from "./catalog.js";

/** Approved commands get a bounded window rather than hanging the request. */
const COMMAND_TIMEOUT_MS = 60_000;

/**
 * Applies an approved proposal.
 *
 * The stored payload is treated as untrusted input even though the server wrote
 * it: the proposal could have sat in the table across a release, and defending
 * the apply path rather than the create path means one place to get right.
 * Everything goes through the same repositories a human action uses, scoped to
 * the approving user.
 */

export interface ApplyResult {
  ok: boolean;
  summary: string;
}

function requireNumber(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return parsed;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export async function applyProposal(
  kind: string,
  payload: Record<string, unknown>,
  userId: string,
): Promise<ApplyResult> {
  // A payload whose tool no longer exists is refused rather than guessed at.
  if (!getTool(kind)) {
    throw new Error(`Unknown proposal kind: ${kind}`);
  }

  switch (kind) {
    case "propose_create_host": {
      const created = await createCurrentHostRepository().create({
        userId,
        name: requireString(payload.name, "name"),
        ip: requireString(payload.ip, "ip"),
        port: Number(payload.port) || 22,
        username: optionalString(payload.username) ?? "",
        folder: optionalString(payload.folder) ?? "",
        tags: JSON.stringify(Array.isArray(payload.tags) ? payload.tags : []),
      } as any);
      return {
        ok: true,
        summary: `Created host ${(created as any).name ?? ""}`.trim(),
      };
    }

    case "propose_update_host": {
      const hostId = requireNumber(payload.hostId, "hostId");
      const changes = (payload.changes ?? {}) as Record<string, unknown>;

      const existing = await createCurrentHostRepository().findByIdForUser(
        userId,
        hostId,
      );
      if (!existing) throw new Error("Host not found");

      const updates: Record<string, unknown> = {};
      if (changes.name !== undefined)
        updates.name = requireString(changes.name, "name");
      if (changes.ip !== undefined)
        updates.ip = requireString(changes.ip, "ip");
      if (changes.port !== undefined) updates.port = Number(changes.port);
      if (changes.username !== undefined)
        updates.username = optionalString(changes.username) ?? "";
      if (changes.folder !== undefined)
        updates.folder = optionalString(changes.folder) ?? "";
      if (changes.tags !== undefined) {
        updates.tags = JSON.stringify(
          Array.isArray(changes.tags) ? changes.tags : [],
        );
      }

      if (!Object.keys(updates).length) {
        return { ok: false, summary: "Nothing to change" };
      }

      await createCurrentHostRepository().updateForUser(
        userId,
        hostId,
        updates as any,
      );
      return { ok: true, summary: `Updated host ${hostId}` };
    }

    case "propose_delete_host": {
      const hostId = requireNumber(payload.hostId, "hostId");
      const deleted = await createCurrentHostRepository().deleteForUser(
        userId,
        hostId,
      );
      if (!deleted) throw new Error("Host not found");
      return { ok: true, summary: `Deleted host ${hostId}` };
    }

    case "propose_create_snippet": {
      const created = await createCurrentSnippetRepository().createSnippet(
        userId,
        {
          name: requireString(payload.name, "name"),
          content: requireString(payload.content, "content"),
          description: optionalString(payload.description),
          folder: optionalString(payload.folder),
        } as any,
      );
      return {
        ok: true,
        summary: `Created snippet ${(created as any)?.name ?? ""}`.trim(),
      };
    }

    case "propose_update_snippet": {
      const snippetId = requireNumber(payload.snippetId, "snippetId");
      const changes = (payload.changes ?? {}) as Record<string, unknown>;

      const existing = await createCurrentSnippetRepository().findOwnedById(
        userId,
        snippetId,
      );
      if (!existing) throw new Error("Snippet not found");

      const updates: Record<string, unknown> = {};
      if (changes.name !== undefined)
        updates.name = requireString(changes.name, "name");
      if (changes.content !== undefined)
        updates.content = requireString(changes.content, "content");
      if (changes.description !== undefined)
        updates.description = optionalString(changes.description);
      if (changes.folder !== undefined)
        updates.folder = optionalString(changes.folder);

      if (!Object.keys(updates).length) {
        return { ok: false, summary: "Nothing to change" };
      }

      await createCurrentSnippetRepository().updateSnippet(
        userId,
        snippetId,
        updates as any,
      );
      return { ok: true, summary: `Updated snippet ${snippetId}` };
    }

    case "propose_delete_snippet": {
      const snippetId = requireNumber(payload.snippetId, "snippetId");
      const deleted = await createCurrentSnippetRepository().deleteSnippet(
        userId,
        snippetId,
      );
      if (!deleted) throw new Error("Snippet not found");
      return { ok: true, summary: `Deleted snippet ${snippetId}` };
    }

    case "propose_create_fleet": {
      const fleet = await createCurrentFleetRepository().create(userId, {
        name: requireString(payload.name, "name"),
        description: optionalString(payload.description),
      } as any);

      const hostIds = Array.isArray(payload.hostIds) ? payload.hostIds : [];
      let added = 0;
      for (const raw of hostIds) {
        const hostId = Number(raw);
        if (!Number.isInteger(hostId) || hostId <= 0) continue;
        // Only hosts the approving user owns can join their fleet.
        const host = await createCurrentHostRepository().findByIdForUser(
          userId,
          hostId,
        );
        if (!host) continue;
        await createCurrentFleetRepository().addMember(
          (fleet as any).id,
          hostId,
        );
        added += 1;
      }

      return {
        ok: true,
        summary: `Created fleet ${(fleet as any).name} with ${added} host${added === 1 ? "" : "s"}`,
      };
    }

    case "propose_create_alert_rule": {
      const created = await createCurrentAlertRepository().createAlertRule({
        userId,
        name: requireString(payload.name, "name"),
        hostId:
          payload.hostId === null || payload.hostId === undefined
            ? null
            : requireNumber(payload.hostId, "hostId"),
        enabled: true,
        triggerType: requireString(payload.triggerType, "triggerType"),
        thresholdValue:
          payload.thresholdValue === null ||
          payload.thresholdValue === undefined
            ? null
            : Number(payload.thresholdValue),
        thresholdDurationSeconds:
          payload.thresholdDurationSeconds === null ||
          payload.thresholdDurationSeconds === undefined
            ? null
            : Number(payload.thresholdDurationSeconds),
        cooldownMinutes: Number(payload.cooldownMinutes) || 15,
        channelIds: [],
      } as any);
      return {
        ok: true,
        summary: `Created alert rule ${(created as any)?.name ?? ""}`.trim(),
      };
    }

    case "propose_create_automation": {
      // Reuses the same validator the automations route runs, so an
      // LLM-authored definition is held to exactly the human standard.
      const validation = validateDefinition(payload.definition);
      if (!validation.ok || !validation.definition) {
        throw new Error(
          validation.error ?? "The automation definition is invalid",
        );
      }

      const created = await createCurrentAutomationRepository().create({
        userId,
        name: requireString(payload.name, "name"),
        description: optionalString(payload.description),
        definition: JSON.stringify(validation.definition),
        // Starts disabled: an automation the user has not watched run once
        // should not begin firing against their servers on approval.
        enabled: false,
      });

      return {
        ok: true,
        summary: `Created automation ${(created as any).name} (disabled until you enable it)`,
      };
    }

    case "propose_run_command": {
      const hostId = requireNumber(payload.hostId, "hostId");
      const command = requireString(payload.command, "command");

      // resolveHostById, not the raw repository row: it runs the connect-level
      // permission check, decrypts auth under the owner's key, and resolves the
      // jump host chain. A plain row has none of that, so the SSH factory saw
      // an unresolved jumpHosts field and failed the connection.
      const host = await resolveHostById(hostId, userId);
      if (!host) throw new Error("Host not found");

      const result = await runCommandOnHost(host, command);
      if (result.error) {
        throw new Error(result.error);
      }
      return {
        ok: true,
        summary: result.output?.slice(0, 2000) ?? "(no output)",
      };
    }

    default:
      throw new Error(`Proposal kind ${kind} cannot be applied automatically`);
  }
}

/**
 * Runs one approved command over the shared SSH pool, mirroring how an
 * automation run_command step executes.
 */
async function runCommandOnHost(
  host: Record<string, any>,
  command: string,
): Promise<{ output?: string; error?: string }> {
  try {
    const result = await withConnection(
      getFleetPoolKey(host as any),
      createFleetSshFactory(host as any),
      async (client) => execCommand(client, command, COMMAND_TIMEOUT_MS),
    );

    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    if (result.code === 0 || result.code === null) {
      return { output: output || "(no output)" };
    }
    return { error: `Exited with code ${result.code}: ${output}`.trim() };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Kinds the route handles itself rather than through applyProposal.
 * Empty: everything the assistant can propose can now be applied.
 */
export const ROUTE_APPLIED_KINDS = new Set<string>();
