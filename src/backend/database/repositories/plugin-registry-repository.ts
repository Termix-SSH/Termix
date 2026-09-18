import { eq } from "drizzle-orm";
import { pluginRegistries } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";
import {
  deleteReturning,
  insertReturning,
  updateReturning,
} from "./returning.js";

export type PluginRegistryRecord = typeof pluginRegistries.$inferSelect;

export interface PluginRegistryCreateInput {
  id: string;
  name: string;
  url: string;
  kind?: string;
  enabled?: boolean;
  signingKey?: string | null;
}

export interface PluginRegistryUpdateInput {
  name?: string;
  url?: string;
  kind?: string;
  enabled?: boolean;
  signingKey?: string | null;
  lastCheckedAt?: string | null;
  lastIndexHash?: string | null;
}

export class PluginRegistryRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async listAll(): Promise<PluginRegistryRecord[]> {
    return this.context.drizzle.select().from(pluginRegistries);
  }

  async findById(registryId: string): Promise<PluginRegistryRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(pluginRegistries)
      .where(eq(pluginRegistries.id, registryId))
      .limit(1);
    return rows[0] ?? null;
  }

  async create(
    input: PluginRegistryCreateInput,
  ): Promise<PluginRegistryRecord> {
    const [created] = await insertReturning(this.context, pluginRegistries, {
      id: input.id,
      name: input.name,
      url: input.url,
      kind: input.kind ?? "community",
      enabled: input.enabled ?? true,
      signingKey: input.signingKey ?? null,
    });

    await this.afterWrite();
    return created;
  }

  async update(
    registryId: string,
    input: PluginRegistryUpdateInput,
  ): Promise<PluginRegistryRecord | null> {
    const existing = await this.findById(registryId);
    if (!existing) return null;

    const [updated] = await updateReturning(
      this.context,
      pluginRegistries,
      {
        name: input.name ?? existing.name,
        url: input.url ?? existing.url,
        kind: input.kind ?? existing.kind,
        enabled: input.enabled ?? existing.enabled,
        signingKey:
          input.signingKey === undefined
            ? existing.signingKey
            : input.signingKey,
        lastCheckedAt:
          input.lastCheckedAt === undefined
            ? existing.lastCheckedAt
            : input.lastCheckedAt,
        lastIndexHash:
          input.lastIndexHash === undefined
            ? existing.lastIndexHash
            : input.lastIndexHash,
      },
      eq(pluginRegistries.id, registryId),
    );

    await this.afterWrite();
    return updated ?? null;
  }

  async delete(registryId: string): Promise<boolean> {
    const deleted = await deleteReturning(
      this.context,
      pluginRegistries,
      eq(pluginRegistries.id, registryId),
    );

    if (deleted.length > 0) {
      await this.afterWrite();
      return true;
    }
    return false;
  }

  async deleteAll(): Promise<number> {
    const all = await this.listAll();
    const result = await this.context.drizzle.delete(pluginRegistries);

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }
    return all.length;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
