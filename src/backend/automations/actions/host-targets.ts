import type { HostSelector } from "../../../types/automations.js";
import { resolveHostById } from "../../hosts/host-resolver.js";
import { createCurrentFleetRepository } from "../../database/repositories/factory.js";
import { PermissionManager } from "../../utils/permission-manager.js";
import type { StepExecutionContext } from "./types.js";

/** A host the caller is allowed to act on. `host` is always resolved. */
export interface ResolvedTarget {
  id: number;
  name: string;
  host: NonNullable<Awaited<ReturnType<typeof resolveHostById>>>;
}

/**
 * Turns a selector into the hosts a step may actually act on.
 *
 * Access is checked here, at execution time rather than when the automation
 * was saved, so a permission revoked after the fact takes effect on the next
 * run. resolveHostById performs its own connect-level check and returns null
 * when the owner can no longer reach the host.
 */
export async function resolveTargets(
  selector: HostSelector,
  context: StepExecutionContext,
): Promise<{ targets: ResolvedTarget[]; skipped: number[] }> {
  const ids = await selectorHostIds(selector, context);
  const targets: ResolvedTarget[] = [];
  const skipped: number[] = [];

  for (const id of ids) {
    const host = await resolveHostById(id, context.userId);
    if (!host) {
      skipped.push(id);
      continue;
    }
    targets.push({ id, name: host.name || host.ip, host });
  }

  return { targets, skipped };
}

async function selectorHostIds(
  selector: HostSelector,
  context: StepExecutionContext,
): Promise<number[]> {
  switch (selector.kind) {
    case "host":
      return [selector.hostId];
    case "hosts":
      return selector.hostIds;
    case "trigger":
      return context.triggerHostId ? [context.triggerHostId] : [];
    case "fleet":
      return fleetHostIds(selector.fleetId, context.userId);
    case "all":
      return allAccessibleHostIds(context.userId);
    default:
      return [];
  }
}

async function fleetHostIds(
  fleetId: number,
  userId: string,
): Promise<number[]> {
  try {
    const repository = createCurrentFleetRepository();
    const members = await repository.listEffectiveMembers(userId, fleetId);
    return members.map((member) => member.id);
  } catch {
    return [];
  }
}

async function allAccessibleHostIds(userId: string): Promise<number[]> {
  try {
    const { createCurrentHostRepository } =
      await import("../../database/repositories/factory.js");
    const hosts = await createCurrentHostRepository().listByUserId(userId);
    const ids = hosts.map((host) => host.id);
    const allowed =
      await PermissionManager.getInstance().filterAccessibleHostIds(
        userId,
        ids,
      );
    return ids.filter((id) => allowed.has(id));
  } catch {
    return [];
  }
}
