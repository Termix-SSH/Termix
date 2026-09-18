import { eq } from "drizzle-orm";
import { plugins } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";
import {
  deleteReturning,
  insertReturning,
  updateReturning,
} from "./returning.js";

export type PluginRecord = typeof plugins.$inferSelect;

export interface PluginCreateInput {
  id: string;
  name: string;
  version: string;
  tier?: string;
  source?: string;
  registryId?: string | null;
  state?: string;
  autoUpdate?: boolean;
  manifestJson: string;
}

export interface PluginUpdateInput {
  name?: string;
  version?: string;
  tier?: string;
  source?: string;
  registryId?: string | null;
  state?: string;
  autoUpdate?: boolean;
  manifestJson?: string;
}

export class PluginRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async listAll(): Promise<PluginRecord[]> {
    return this.context.drizzle.select().from(plugins);
  }

  async findById(pluginId: string): Promise<PluginRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(plugins)
      .where(eq(plugins.id, pluginId))
      .limit(1);
    return rows[0] ?? null;
  }

  async create(
    input: PluginCreateInput,
    now = new Date().toISOString(),
  ): Promise<PluginRecord> {
    const [created] = await insertReturning(this.context, plugins, {
      id: input.id,
      name: input.name,
      version: input.version,
      tier: input.tier ?? "available",
      source: input.source ?? "community",
      registryId: input.registryId ?? null,
      state: input.state ?? "disabled",
      autoUpdate: input.autoUpdate ?? false,
      manifestJson: input.manifestJson,
      installedAt: now,
      updatedAt: now,
    });

    await this.afterWrite();
    return created;
  }

  async update(
    pluginId: string,
    input: PluginUpdateInput,
    now = new Date().toISOString(),
  ): Promise<PluginRecord | null> {
    const existing = await this.findById(pluginId);
    if (!existing) return null;

    const [updated] = await updateReturning(
      this.context,
      plugins,
      {
        name: input.name ?? existing.name,
        version: input.version ?? existing.version,
        tier: input.tier ?? existing.tier,
        source: input.source ?? existing.source,
        registryId:
          input.registryId === undefined
            ? existing.registryId
            : input.registryId,
        state: input.state ?? existing.state,
        autoUpdate: input.autoUpdate ?? existing.autoUpdate,
        manifestJson: input.manifestJson ?? existing.manifestJson,
        updatedAt: now,
      },
      eq(plugins.id, pluginId),
    );

    await this.afterWrite();
    return updated ?? null;
  }

  async delete(pluginId: string): Promise<boolean> {
    const deleted = await deleteReturning(
      this.context,
      plugins,
      eq(plugins.id, pluginId),
    );

    if (deleted.length > 0) {
      await this.afterWrite();
      return true;
    }
    return false;
  }

  async deleteAll(): Promise<number> {
    const all = await this.listAll();
    const result = await this.context.drizzle.delete(plugins);

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }
    return all.length;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
