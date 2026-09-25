import type { Client } from "ssh2";
import type { PluginSsh } from "@termix/plugin-sdk/backend";
import { detectHostPlatform } from "@termix/plugin-sdk/host-commands";
import { collectCpuMetrics } from "./widgets/cpu-collector.js";
import { collectMemoryMetrics } from "./widgets/memory-collector.js";
import { collectDiskMetrics } from "./widgets/disk-collector.js";
import { collectNetworkMetrics } from "./widgets/network-collector.js";
import { collectUptimeMetrics } from "./widgets/uptime-collector.js";
import { collectProcessesMetrics } from "./widgets/processes-collector.js";
import { collectSystemMetrics } from "./widgets/system-collector.js";
import { collectLoginStats } from "./widgets/login-stats-collector.js";
import { collectPortsMetrics } from "./widgets/ports-collector.js";
import { collectFirewallMetrics } from "./widgets/firewall-collector.js";
import { collectTemperatureMetrics } from "./widgets/temperature-collector.js";
import { collectGpuMetrics, type GpuMetrics } from "./widgets/gpu-collector.js";
import type { FirewallMetrics, PortsMetrics } from "../shared/stats-widgets.js";
import { supportsMetrics, type MetricsHost } from "./helpers.js";
import { sessionKey, type MetricsSessions } from "./sessions.js";
import type { MetricsState } from "./state.js";
import type { CollectorRegistry } from "./collectors.js";

export function isHostKeyVerificationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("Host denied (verification failed)") ||
      error.message.includes("Host key changed"))
  );
}

export type CollectedMetrics = {
  cpu: Awaited<ReturnType<typeof collectCpuMetrics>>;
  memory: Awaited<ReturnType<typeof collectMemoryMetrics>>;
  disk: Awaited<ReturnType<typeof collectDiskMetrics>>;
  network: Awaited<ReturnType<typeof collectNetworkMetrics>>;
  uptime: Awaited<ReturnType<typeof collectUptimeMetrics>>;
  processes: Awaited<ReturnType<typeof collectProcessesMetrics>>;
  system: Awaited<ReturnType<typeof collectSystemMetrics>>;
  login_stats: Awaited<ReturnType<typeof collectLoginStats>>;
  ports: PortsMetrics;
  firewall: FirewallMetrics;
  temperature: Awaited<ReturnType<typeof collectTemperatureMetrics>>;
  gpu: GpuMetrics;
  /** Results from other plugins' collectors, by collector id. */
  extra?: Record<string, unknown>;
};

export interface CollectDeps {
  ssh: PluginSsh;
  state: MetricsState;
  sessions: MetricsSessions;
  collectors: CollectorRegistry;
}

async function optional<T>(collect: () => Promise<T>, fallback: T) {
  try {
    return await collect();
  } catch {
    return fallback;
  }
}

/**
 * One sample. Reuses a connection the person opened from the tab when there
 * is one, otherwise borrows the "stats" pool, which answers password prompts
 * only and fails fast on anything that needs a person.
 */
export async function collectMetrics(
  deps: CollectDeps,
  host: MetricsHost,
  mounts: {
    excludedMounts: string[];
    monitoredMounts: Array<{ path: string; label?: string }>;
  },
  onAuthenticated?: () => void,
): Promise<CollectedMetrics> {
  const { ssh, state, sessions, collectors } = deps;
  if (!supportsMetrics(host, ssh)) {
    throw new Error("Metrics collection only supported for SSH hosts");
  }

  if (state.authFailures.shouldSkip(host.id)) {
    const reason = state.authFailures.getSkipReason(host.id);
    throw new Error(reason || "Authentication failed");
  }

  const cached = state.metricsCache.get(host.id) as CollectedMetrics | null;
  if (cached) {
    onAuthenticated?.();
    return cached;
  }

  return state.requestQueue.queueRequest(host.id, async () => {
    const key = sessionKey(host.id, host.userId);
    const existing = sessions.get(key);

    try {
      const collect = async (client: Client): Promise<CollectedMetrics> => {
        onAuthenticated?.();
        const platform = await detectHostPlatform(client);
        const result: CollectedMetrics = {
          cpu: await collectCpuMetrics(
            client,
            platform,
            host.id,
            state.rateSamples.cpu,
          ),
          memory: await collectMemoryMetrics(client, platform),
          disk: await collectDiskMetrics(
            client,
            mounts.excludedMounts,
            mounts.monitoredMounts,
            platform,
          ),
          network: await collectNetworkMetrics(
            client,
            platform,
            host.id,
            state.rateSamples.network,
          ),
          uptime: await collectUptimeMetrics(client, platform),
          processes: await collectProcessesMetrics(client),
          system: await collectSystemMetrics(client, platform),
          login_stats: await optional(() => collectLoginStats(client), {
            recentLogins: [],
            failedLogins: [],
            totalLogins: 0,
            uniqueIPs: 0,
          }),
          ports: await optional(() => collectPortsMetrics(client), {
            source: "none",
            ports: [],
          }),
          firewall: await optional(() => collectFirewallMetrics(client), {
            type: "none",
            status: "unknown",
            chains: [],
          }),
          temperature: await optional(() => collectTemperatureMetrics(client), {
            source: "none",
            highestCelsius: null,
            sensors: [],
          }),
          gpu: await optional(() => collectGpuMetrics(client), {
            source: "none",
            gpus: [],
            processes: [],
          }),
        };

        const extra = await collectors.run(client, host.id, host.userId);
        if (Object.keys(extra).length > 0) result.extra = extra;

        state.metricsCache.set(host.id, result);
        return result;
      };

      if (existing?.isConnected) {
        existing.activeOperations++;
        try {
          const result = await collect(existing.client);
          sessions.touch(key);
          return result;
        } finally {
          existing.activeOperations--;
        }
      }

      return await ssh.withConnection<CollectedMetrics, Client>(
        host,
        {
          pool: "stats",
          purpose: "metrics",
          overrides: { readyTimeout: 60000 },
        },
        collect,
      );
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("TOTP authentication required")) {
          throw error;
        } else if (
          error.message.includes("No password available") ||
          error.message.includes("Unsupported authentication type") ||
          error.message.includes("No SSH key available") ||
          error.message.includes("Invalid SSH key format")
        ) {
          state.authFailures.recordFailure(host.id, "AUTH", true);
        } else if (isHostKeyVerificationError(error)) {
          state.authFailures.recordFailure(host.id, "HOST_KEY", true);
        } else if (
          error.message.includes("authentication") ||
          error.message.includes("Permission denied") ||
          error.message.includes("All configured authentication methods failed")
        ) {
          state.authFailures.recordFailure(host.id, "AUTH");
        } else if (
          error.message.includes("timeout") ||
          error.message.includes("ETIMEDOUT")
        ) {
          state.authFailures.recordFailure(host.id, "TIMEOUT");
        }
      }
      throw error;
    }
  });
}
