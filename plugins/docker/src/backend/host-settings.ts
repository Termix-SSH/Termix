import type { PluginContext } from "@termix/plugin-sdk/backend";
import {
  normalizeContainerRuntime,
  type ContainerRuntime,
} from "./container-runtime.js";

export const PLUGIN_ID = "docker";

export interface DockerHostSettings {
  enabled: boolean;
  runtime: ContainerRuntime;
}

export async function readDockerHostSettings(
  ctx: PluginContext,
  hostId: number,
): Promise<DockerHostSettings> {
  const values = await ctx.settings.getAll("host", hostId);
  return {
    enabled: values.enableDocker === true,
    runtime: normalizeContainerRuntime(values.containerRuntime),
  };
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : undefined;
}

function asBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return undefined;
}

/**
 * The docker host settings in an imported or created host row: the nested
 * `pluginSettings.docker` of a Termix export first, then the flat
 * `enableDocker` and `dockerConfig.runtime` hosts had before 2.9.0 (older
 * exports, proxmox guests marked as Docker hosts).
 */
export function normalizeImportedHost(
  raw: Record<string, unknown>,
): Record<string, unknown> | null {
  const nested = asObject(asObject(raw.pluginSettings)?.[PLUGIN_ID]) ?? {};
  const out: Record<string, unknown> = {};

  const enabled = asBool(
    nested.enableDocker !== undefined ? nested.enableDocker : raw.enableDocker,
  );
  if (enabled !== undefined) out.enableDocker = enabled;

  const runtime =
    nested.containerRuntime ?? asObject(raw.dockerConfig)?.runtime;
  if (runtime === "docker" || runtime === "podman") {
    out.containerRuntime = runtime;
  }

  return Object.keys(out).length > 0 ? out : null;
}
