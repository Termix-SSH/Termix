import type { Client } from "ssh2";
import type { PluginServices } from "@termix/plugin-sdk/backend";
import type { MetricsLogger } from "./log.js";

export const COLLECTORS_SERVICE = "host-metrics.collectors";

/**
 * The "host-metrics.collectors" service, version 1. Another plugin provides
 * it under its own provider name (manifest `provides[].names`) to add data
 * to every sample. It runs on the sample's SSH connection, as the host's
 * owner, and its result lands in the snapshot under `extra[<name>]`. A
 * collector that throws is skipped for that sample.
 */
export interface MetricsCollectorV1 {
  collect: (client: Client, hostId: number) => Promise<unknown>;
}

export class CollectorRegistry {
  constructor(
    private readonly services: PluginServices,
    private readonly log: MetricsLogger,
  ) {}

  async run(
    client: Client,
    hostId: number,
    ownerUserId: string,
  ): Promise<Record<string, unknown>> {
    const results: Record<string, unknown> = {};
    for (const provider of this.services.providers(COLLECTORS_SERVICE)) {
      if (!provider) continue;
      try {
        const collector = this.services.get<Partial<MetricsCollectorV1>>(
          COLLECTORS_SERVICE,
          { provider, userId: ownerUserId },
        );
        if (typeof collector.collect !== "function") continue;
        results[provider] = await collector.collect(client, hostId);
      } catch (error) {
        this.log.debug(`Metrics collector ${provider} failed`, {
          hostId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }
}
