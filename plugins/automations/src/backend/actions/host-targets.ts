import type { PluginSshHost } from "@termix/plugin-sdk/backend";
import type { HostSelector } from "../../types.js";
import type { StepExecutionContext, StepRuntime } from "./types.js";

/** A host the owner may act on, resolved through core's connect pipeline. */
export interface ResolvedTarget {
  id: number;
  name: string;
  host: PluginSshHost;
}

/**
 * Turns a selector into the hosts a step may actually act on.
 *
 * Access is checked at execution time rather than when the automation was
 * saved, so a permission revoked after the fact takes effect on the next run.
 * resolveHost runs as the automation's owner and answers null when they can
 * no longer reach the host.
 */
export async function resolveTargets(
  selector: HostSelector,
  context: StepExecutionContext,
  runtime: StepRuntime,
): Promise<{ targets: ResolvedTarget[]; skipped: number[] }> {
  const ids = await selectorHostIds(selector, context, runtime);
  const targets: ResolvedTarget[] = [];
  const skipped: number[] = [];

  for (const id of ids) {
    let host: PluginSshHost | null = null;
    try {
      host = await runtime.ctx.ssh.resolveHost(id);
    } catch {
      host = null;
    }
    if (!host) {
      skipped.push(id);
      continue;
    }
    const name =
      typeof host.name === "string" && host.name ? host.name : host.ip;
    targets.push({ id, name, host });
  }

  return { targets, skipped };
}

async function selectorHostIds(
  selector: HostSelector,
  context: StepExecutionContext,
  runtime: StepRuntime,
): Promise<number[]> {
  switch (selector.kind) {
    case "host":
      return [selector.hostId];
    case "hosts":
      return selector.hostIds;
    case "trigger":
      return context.triggerHostId ? [context.triggerHostId] : [];
    case "fleet": {
      const fleets = runtime.deps.fleets();
      if (typeof fleets.members !== "function") return [];
      try {
        const members = await fleets.members(selector.fleetId);
        return members.map((member) => member.id);
      } catch {
        return [];
      }
    }
    case "all": {
      try {
        const hosts = await runtime.ctx.hosts.list();
        // The owner's own hosts, as before: "all" never fans out onto hosts
        // someone else shared with them.
        return hosts
          .filter((host) => host.userId === context.userId)
          .map((host) => host.id);
      } catch {
        return [];
      }
    }
    default:
      return [];
  }
}
