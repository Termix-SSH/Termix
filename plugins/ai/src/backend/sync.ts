import type { PluginContext, SyncRow } from "@termix/plugin-sdk/backend";
import {
  apiKeyPrefix,
  providerSecretKey,
  type AiRepository,
} from "./repository.js";
import { providers } from "./tables.js";

function keyFromWire(row: SyncRow): string | null {
  if (typeof row.apiKey === "string") return row.apiKey || null;
  if (row.apiKey === null) return null;
  throw new Error("Invalid synced provider key");
}

export async function registerProviderSync(
  ctx: PluginContext,
  repo: AiRepository,
) {
  ctx.sync.registerEntity({
    type: "aiProviders",
    table: await ctx.db.define(providers),
    permissions: {
      create: "ai.manage_providers",
      update: "ai.manage_providers",
      delete: "ai.manage_providers",
    },
    serialize: async (row) => {
      const apiKey = await ctx.asUser(String(row.userId), () =>
        ctx.secrets.get(providerSecretKey(Number(row.id))),
      );
      return { ...row, apiKey, apiKeyPrefix: apiKeyPrefix(apiKey) };
    },
    deserialize: async (row) => {
      const apiKey = keyFromWire(row);
      const { apiKey: _key, ...fields } = row;
      return { ...fields, apiKeyPrefix: apiKeyPrefix(apiKey) };
    },
    afterWrite: async ({ id, userId, wire }) => {
      if (id === null) throw new Error("Synced provider has no local id");
      await ctx.asUser(userId, () =>
        ctx.secrets.set(providerSecretKey(id), keyFromWire(wire)),
      );
    },
    remove: async (row, userId) => {
      await ctx.asUser(userId, () =>
        repo.deleteProvider(Number(row.id), userId),
      );
    },
  });
}
